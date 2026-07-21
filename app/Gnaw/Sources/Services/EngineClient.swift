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

final class EngineClient {
    private var process: Process?
    private var inputPipe: Pipe?
    private var stdoutReader: NDJSONLineReader?
    private var stderrReader: NDJSONLineReader?

    var isRunning: Bool { process?.isRunning == true }

    func start(
        configuration: CaptureConfiguration,
        onEvent: @escaping (GnawEvent) -> Void,
        onLog: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        let root = try resolveProjectRoot()
        let engine = root.appendingPathComponent("dist/engine/src/cli.js")
        guard FileManager.default.fileExists(atPath: engine.path) else {
            throw EngineClientError.engineNotBuilt(engine.path)
        }
        let node = try resolveNode()

        try FileManager.default.createDirectory(
            atPath: configuration.outputDirectory,
            withIntermediateDirectories: true
        )

        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        let stdin = Pipe()
        process.executableURL = node
        process.currentDirectoryURL = root
        process.arguments = [
            engine.path,
            "capture",
            configuration.url,
            "--mode", configuration.modes,
            "--depth", String(configuration.preset.depth),
            "--max-pages", String(configuration.maxPages),
            "--out", configuration.outputDirectory
        ]
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = stdin

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
