import Foundation

enum EngineClientError: LocalizedError {
    case projectRootNotFound
    case nodeNotFound
    case engineNotBuilt(String)

    var errorDescription: String? {
        switch self {
        case .projectRootNotFound:
            return "Could not find the Gnaw project root."
        case .nodeNotFound:
            return "Node.js was not found. Install Node 20+ or launch through the Gnaw run script."
        case .engineNotBuilt(let path):
            return "The Gnaw engine is not built at \(path). Run npm run build first."
        }
    }
}

struct ResolvedEngine {
    let node: URL
    let cli: URL
    let engineRoot: URL
}

final class EngineClient {
    private var process: Process?
    private var inputPipe: Pipe?
    private var stdoutReader: NDJSONLineReader?
    private var stderrReader: NDJSONLineReader?
    private var ensureReader: NDJSONLineReader?

    var isRunning: Bool { process?.isRunning == true }

    func start(
        configuration: CaptureConfiguration,
        onEvent: @escaping (GnawEvent) -> Void,
        onLog: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        let (process, stdout, stderr, stdin) = try makeProcess(arguments: [
            "capture",
            configuration.url,
            "--mode", configuration.modes,
            "--depth", String(configuration.preset.depth),
            "--max-pages", String(configuration.maxPages),
            "--out", configuration.outputDirectory
        ])
        try FileManager.default.createDirectory(
            atPath: configuration.outputDirectory, withIntermediateDirectories: true)

        let decoder = JSONDecoder()
        let stdoutReader = NDJSONLineReader(handle: stdout.fileHandleForReading) { line in
            guard let data = line.data(using: .utf8) else { return }
            do {
                onEvent(try decoder.decode(GnawEvent.self, from: data))
            } catch {
                onLog("Ignored invalid engine event: \(line)")
            }
        }
        let stderrReader = NDJSONLineReader(handle: stderr.fileHandleForReading, onLine: onLog)

        process.terminationHandler = { [weak self] process in
            self?.stdoutReader?.finish()
            self?.stderrReader?.finish()
            onExit(process.terminationStatus)
        }

        self.process = process
        self.inputPipe = stdin
        self.stdoutReader = stdoutReader
        self.stderrReader = stderrReader
        stdoutReader.start()
        stderrReader.start()
        try process.run()
    }

    func send(_ command: String) {
        guard let data = "{\"cmd\":\"\(command)\"}\n".data(using: .utf8) else { return }
        inputPipe?.fileHandleForWriting.write(data)
    }

    private func resolveProjectRoot() throws -> URL {
        let environment = ProcessInfo.processInfo.environment
        if let configured = environment["GNAW_PROJECT_ROOT"] {
            let expanded = (configured as NSString).expandingTildeInPath
            let url = URL(fileURLWithPath: expanded).standardizedFileURL
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("package.json").path) {
                return url
            }
        }
        if let bundledRoot = Bundle.main.object(forInfoDictionaryKey: "GnawProjectRoot") as? String {
            let url = URL(fileURLWithPath: bundledRoot).standardizedFileURL
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("package.json").path) {
                return url
            }
        }

        var candidates = [URL(fileURLWithPath: FileManager.default.currentDirectoryPath)]
        candidates.append(Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
        for start in candidates {
            var cursor = start.standardizedFileURL
            for _ in 0..<8 {
                if FileManager.default.fileExists(atPath: cursor.appendingPathComponent("package.json").path),
                   FileManager.default.fileExists(atPath: cursor.appendingPathComponent("engine").path) {
                    return cursor
                }
                cursor.deleteLastPathComponent()
            }
        }
        throw EngineClientError.projectRootNotFound
    }

    private func resolveNode() throws -> URL {
        let candidates = [
            ProcessInfo.processInfo.environment["GNAW_NODE"],
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ].compactMap { $0 }
        guard let path = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            throw EngineClientError.nodeNotFound
        }
        return URL(fileURLWithPath: path)
    }
}

extension EngineClient {
    static var browserCachePath: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Gnaw/browsers", isDirectory: true)
    }

    func resolveEngine() throws -> ResolvedEngine {
        // 1. Bundled resources (packaged app).
        if let resources = Bundle.main.resourceURL {
            let engineRoot = resources.appendingPathComponent("engine", isDirectory: true)
            let cli = engineRoot.appendingPathComponent("dist/engine/src/cli.js")
            let node = resources.appendingPathComponent("node/bin/node")
            if FileManager.default.fileExists(atPath: cli.path),
               FileManager.default.isExecutableFile(atPath: node.path) {
                return ResolvedEngine(node: node, cli: cli, engineRoot: engineRoot)
            }
        }
        // 2. Dev fallback: repo root + system node (keeps build_and_run.sh working).
        let root = try resolveProjectRoot()
        let cli = root.appendingPathComponent("dist/engine/src/cli.js")
        guard FileManager.default.fileExists(atPath: cli.path) else {
            throw EngineClientError.engineNotBuilt(cli.path)
        }
        let node = try resolveNode()
        return ResolvedEngine(node: node, cli: cli, engineRoot: root)
    }

    func makeProcess(arguments: [String]) throws -> (Process, Pipe, Pipe, Pipe) {
        let resolved = try resolveEngine()
        try FileManager.default.createDirectory(
            at: Self.browserCachePath, withIntermediateDirectories: true)

        let process = Process()
        let stdout = Pipe(), stderr = Pipe(), stdin = Pipe()
        process.executableURL = resolved.node
        process.arguments = [resolved.cli.path] + arguments
        process.currentDirectoryURL = FileManager.default.temporaryDirectory
        var env = ProcessInfo.processInfo.environment
        env["PLAYWRIGHT_BROWSERS_PATH"] = Self.browserCachePath.path
        process.environment = env
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = stdin
        return (process, stdout, stderr, stdin)
    }

    /// Runs `gnaw browser check`. Calls back with true if a browser is available.
    func checkBrowser(completion: @escaping (Bool) -> Void) {
        do {
            let (process, _, _, _) = try makeProcess(arguments: ["browser", "check"])
            process.terminationHandler = { proc in completion(proc.terminationStatus == 0) }
            try process.run()
        } catch {
            completion(false)
        }
    }

    /// Runs `gnaw browser ensure`, streaming `browser` events via onEvent.
    func ensureBrowser(
        onEvent: @escaping (GnawEvent) -> Void,
        onExit: @escaping (Int32) -> Void
    ) {
        do {
            let (process, stdout, _, _) = try makeProcess(arguments: ["browser", "ensure"])
            let decoder = JSONDecoder()
            let reader = NDJSONLineReader(handle: stdout.fileHandleForReading) { line in
                guard let data = line.data(using: .utf8),
                      let event = try? decoder.decode(GnawEvent.self, from: data) else { return }
                onEvent(event)
            }
            process.terminationHandler = { proc in reader.finish(); onExit(proc.terminationStatus) }
            self.ensureReader = reader
            reader.start()
            try process.run()
        } catch {
            onExit(-1)
        }
    }
}

private final class NDJSONLineReader {
    private let handle: FileHandle
    private let onLine: (String) -> Void
    private let lock = NSLock()
    private var buffer = Data()

    init(handle: FileHandle, onLine: @escaping (String) -> Void) {
        self.handle = handle
        self.onLine = onLine
    }

    func start() {
        handle.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                self?.finish()
            } else {
                self?.append(data)
            }
        }
    }

    func finish() {
        handle.readabilityHandler = nil
        lock.lock()
        defer { lock.unlock() }
        if !buffer.isEmpty, let line = String(data: buffer, encoding: .utf8) {
            onLine(line.trimmingCharacters(in: .whitespacesAndNewlines))
            buffer.removeAll()
        }
    }

    private func append(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[..<newline]
            buffer.removeSubrange(...newline)
            if let line = String(data: lineData, encoding: .utf8), !line.isEmpty {
                onLine(line)
            }
        }
    }
}
