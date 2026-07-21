import AppKit
import Foundation

enum BrowserDownloadState: Equatable {
    case idle
    case confirming
    case downloading(String)
    case failed(String)
}

@MainActor
final class AppModel: ObservableObject {
    @Published var phase: CapturePhase = .setup
    @Published var configuration: CaptureConfiguration
    @Published var rows: [WaterfallRow] = []
    @Published var pages = 0
    @Published var assets = 0
    @Published var bytes: Int64 = 0
    @Published var queued = 0
    @Published var elapsedMs = 0
    @Published var engineState = "ready"
    @Published var stackName: String?
    @Published var result: String?
    @Published var summary: CaptureSummary?
    @Published var haulPath: String?
    @Published var errorMessage: String?
    @Published var logLines: [String] = []
    @Published var filter = ""
    @Published var actionMessage: String?
    @Published var hauls: [HaulRecord] = []
    @Published var sidebarSelection: SidebarSelection? = .newCapture
    @Published var unreadableManifestCount = 0
    @Published var browserDownload: BrowserDownloadState = .idle

    private let engine = EngineClient()
    private let haulLibrary = HaulLibrary()
    private var receivedDone = false
    private static let outputDirectoryDefaultsKey = "captureOutputDirectory"

    init() {
        let savedOutputDirectory = UserDefaults.standard.string(forKey: Self.outputDirectoryDefaultsKey)
        configuration = CaptureConfiguration(
            outputDirectory: savedOutputDirectory ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Gnaw", isDirectory: true).path
        )
        reloadLibrary()
    }

    var visibleRows: [WaterfallRow] {
        guard !filter.isEmpty else { return rows }
        return rows.filter {
            $0.url.localizedCaseInsensitiveContains(filter) ||
            $0.kind.localizedCaseInsensitiveContains(filter)
        }
    }

    var canStart: Bool {
        !configuration.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canOpenHaul: Bool {
        phase == .result && haulPath != nil
    }

    var canCopyStudyContext: Bool {
        canOpenHaul && configuration.output.includesStudy
    }

    func showNewCapture() {
        guard !engine.isRunning else { return }
        configuration.url = ""
        phase = .setup
        sidebarSelection = .newCapture
        filter = ""
        errorMessage = nil
        actionMessage = nil
    }

    func selectSidebar(_ selection: SidebarSelection?) {
        guard let selection else { return }
        if engine.isRunning, selection != .currentCapture {
            sidebarSelection = .currentCapture
            return
        }

        switch selection {
        case .newCapture:
            showNewCapture()
        case .currentCapture:
            sidebarSelection = .currentCapture
        case .haul(let id):
            guard let haul = hauls.first(where: { $0.id == id }) else { return }
            loadHaul(haul)
        }
    }

    func reloadLibrary(selectingPath: String? = nil) {
        let scan = haulLibrary.scan(outputDirectory: configuration.outputDirectory)
        hauls = scan.hauls
        unreadableManifestCount = scan.unreadableManifestCount

        if let selectingPath,
           let haul = hauls.first(where: { $0.path == selectingPath }) {
            loadHaul(haul)
        }
    }

    func setOutputDirectory(_ directoryURL: URL) {
        let standardized = directoryURL.standardizedFileURL.path
        configuration.outputDirectory = standardized
        UserDefaults.standard.set(standardized, forKey: Self.outputDirectoryDefaultsKey)
        reloadLibrary()
    }

    func commitOutputDirectory() {
        let expanded = (configuration.outputDirectory as NSString).expandingTildeInPath
        setOutputDirectory(URL(fileURLWithPath: expanded, isDirectory: true))
    }

    func prepareRegnaw(_ haul: HaulRecord) {
        guard !engine.isRunning else { return }
        configuration = haul.configuration
        UserDefaults.standard.set(configuration.outputDirectory, forKey: Self.outputDirectoryDefaultsKey)
        phase = .setup
        sidebarSelection = .newCapture
        errorMessage = nil
        actionMessage = "Loaded settings from \(haul.host)"
    }

    func revealHaul(_ haul: HaulRecord) {
        openFolder(at: haul.path)
    }

    func consumeBrowserEvent(_ event: GnawEvent) {
        switch event.statusText {
        case "downloading":
            browserDownload = .downloading(event.detail ?? "Downloading browser engine…")
        case "found":
            browserDownload = .idle
        default:
            break
        }
    }

    func startCapture() {
        guard canStart else {
            errorMessage = "Enter the website address you want to capture."
            return
        }
        configuration.url = normalizedURL(configuration.url)
        commitOutputDirectory()
        resetJob()
        engine.checkBrowser { [weak self] hasBrowser in
            DispatchQueue.main.async {
                guard let self else { return }
                if hasBrowser {
                    self.beginEngineCapture()
                } else {
                    self.browserDownload = .confirming
                }
            }
        }
    }

    func confirmBrowserDownload() {
        browserDownload = .downloading("Preparing…")
        engine.ensureBrowser(
            onEvent: { [weak self] event in
                DispatchQueue.main.async { self?.consumeBrowserEvent(event) }
            },
            onExit: { [weak self] status in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if status == 0 {
                        self.browserDownload = .idle
                        self.beginEngineCapture()
                    } else {
                        self.browserDownload = .failed(
                            "Couldn't download the browser engine. Check your internet connection and try again.")
                    }
                }
            }
        )
    }

    func cancelBrowserDownload() {
        browserDownload = .idle
    }

    func togglePause() {
        if engineState == "paused" {
            engine.send("resume")
        } else {
            engine.send("pause")
        }
    }

    func cancel() {
        engine.send("cancel")
    }

    func openCaptureFolder() {
        guard let haulPath else { return }
        openFolder(at: haulPath)
    }

    func openOfflineWebsite() {
        guard let haulPath else { return }
        let haulURL = URL(fileURLWithPath: haulPath)
        let navigableIndex = haulURL.appendingPathComponent("navigable/index.html")
        guard FileManager.default.fileExists(atPath: navigableIndex.path) else {
            errorMessage = "This capture does not contain an offline website. Open the capture folder to view its study files."
            return
        }
        NSWorkspace.shared.open(navigableIndex)
    }

    func copyStudyContext() {
        guard let haulPath else { return }
        let contextURL = URL(fileURLWithPath: haulPath).appendingPathComponent("context.md")
        guard let context = try? String(contentsOf: contextURL, encoding: .utf8) else {
            errorMessage = "context.md is not available for this capture."
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(context, forType: .string)
        actionMessage = "Study context copied"
    }

    private func beginEngineCapture() {
        phase = .capturing
        sidebarSelection = .currentCapture
        engineState = "starting"
        do {
            try engine.start(
                configuration: configuration,
                onEvent: { [weak self] event in DispatchQueue.main.async { self?.consume(event) } },
                onLog: { [weak self] line in DispatchQueue.main.async { self?.appendLog(line) } },
                onExit: { [weak self] status in DispatchQueue.main.async { self?.engineExited(status) } }
            )
        } catch {
            errorMessage = error.localizedDescription
            phase = .setup
            engineState = "failed"
        }
    }

    private func resetJob() {
        rows = []
        pages = 0
        assets = 0
        bytes = 0
        queued = 0
        elapsedMs = 0
        stackName = nil
        result = nil
        summary = nil
        haulPath = nil
        errorMessage = nil
        actionMessage = nil
        logLines = []
        receivedDone = false
    }

    private func loadHaul(_ haul: HaulRecord) {
        configuration = haul.configuration
        rows = haulLibrary.loadWaterfall(for: haul)
        pages = haul.summary.pages
        assets = haul.summary.assets
        bytes = haul.summary.bytes
        queued = 0
        elapsedMs = haul.summary.durationMs ?? 0
        stackName = haul.stackName
        result = haul.result
        summary = haul.summary
        haulPath = haul.path
        engineState = "done"
        filter = ""
        errorMessage = nil
        actionMessage = nil
        phase = .result
        sidebarSelection = .haul(haul.id)
    }

    private func openFolder(at path: String) {
        let folderURL = URL(fileURLWithPath: path, isDirectory: true)
        guard FileManager.default.fileExists(atPath: folderURL.path) else {
            errorMessage = "The capture folder could not be found. Refresh the library if it was moved or deleted."
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([folderURL])
    }

    private func consume(_ event: GnawEvent) {
        switch event.type {
        case "start":
            engineState = "running"
            haulPath = event.haulPath
        case "request":
            guard let id = event.id, let url = event.url else { return }
            rows.append(WaterfallRow(id: id, url: url))
        case "asset":
            guard let id = event.id else { return }
            if let index = rows.firstIndex(where: { $0.id == id }) {
                rows[index].kind = event.kind ?? "OTHER"
                rows[index].bytes = event.bytes
                rows[index].status = event.status
                if let haulPath, let rawPath = event.rawPath {
                    rows[index].localFilePath = haulLibrary.resolvedAssetPath(
                        in: haulPath,
                        relativePath: rawPath
                    )
                }
                rows[index].isInFlight = false
            }
        case "progress":
            pages = event.pages ?? pages
            assets = event.assets ?? assets
            bytes = event.bytes ?? bytes
            queued = event.queued ?? queued
            elapsedMs = event.elapsedMs ?? elapsedMs
        case "stack":
            stackName = event.primary
        case "state":
            engineState = event.state ?? engineState
        case "warning", "error":
            appendLog([event.code, event.message].compactMap { $0 }.joined(separator: ": "))
        case "done":
            receivedDone = true
            result = event.result
            summary = event.summary
            haulPath = event.haulPath ?? haulPath
            engineState = "done"
            phase = .result
            if let haulPath {
                reloadLibrary(selectingPath: haulPath)
            }
        default:
            break
        }
    }

    private func appendLog(_ line: String) {
        guard !line.isEmpty else { return }
        logLines.append(line)
        if logLines.count > 200 { logLines.removeFirst(logLines.count - 200) }
    }

    private func engineExited(_ status: Int32) {
        guard !receivedDone else { return }
        engineState = "failed"
        errorMessage = status == 0
            ? "The engine stopped before reporting a completed haul."
            : "The engine exited with status \(status). \(logLines.last ?? "")"
    }

    private func normalizedURL(_ input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("://") ? trimmed : "https://\(trimmed)"
    }
}
