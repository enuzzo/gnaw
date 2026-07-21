import Foundation

enum CapturePreset: String, CaseIterable, Identifiable {
    case page
    case skim
    case site

    var id: Self { self }
    var title: String {
        switch self {
        case .page: "This page"
        case .skim: "Quick scan"
        case .site: "Full website"
        }
    }
    var detail: String {
        switch self {
        case .page: "Capture only the URL you enter."
        case .skim: "Include pages linked directly from it."
        case .site: "Follow the site up to three levels deep."
        }
    }
    var icon: String {
        switch self {
        case .page: "doc"
        case .skim: "point.3.connected.trianglepath.dotted"
        case .site: "globe"
        }
    }
    var isRecommended: Bool { self == .skim }
    var depth: Int {
        switch self {
        case .page: 0
        case .skim: 1
        case .site: 3
        }
    }

    static func closest(to depth: Int) -> CapturePreset {
        switch depth {
        case ...0: .page
        case 1: .skim
        default: .site
        }
    }
}

enum CaptureOutput: String, CaseIterable, Identifiable {
    case complete
    case offline
    case study

    var id: Self { self }
    var title: String {
        switch self {
        case .complete: "Offline website + study package"
        case .offline: "Offline website"
        case .study: "Study package"
        }
    }
    var detail: String {
        switch self {
        case .complete: "Browse the site locally and keep its source material for analysis."
        case .offline: "Create a local copy you can open and click through in your browser."
        case .study: "Save rendered pages, assets, readable code, and context for AI or technical analysis."
        }
    }
    var icon: String {
        switch self {
        case .complete: "shippingbox.and.arrow.backward.fill"
        case .offline: "safari.fill"
        case .study: "doc.text.magnifyingglass"
        }
    }
    var isRecommended: Bool { self == .complete }
    var includesStudy: Bool { self != .offline }
    var includesNavigable: Bool { self != .study }
    var modes: String {
        switch self {
        case .complete: "study,navigable"
        case .offline: "navigable"
        case .study: "study"
        }
    }

    static func from(modes: [String]) -> CaptureOutput {
        let modes = Set(modes)
        if modes.contains("study") && modes.contains("navigable") { return .complete }
        if modes.contains("navigable") { return .offline }
        return .study
    }
}

struct CaptureConfiguration {
    var url = ""
    var preset: CapturePreset = .skim
    var output: CaptureOutput = .complete
    var maxPages = 200
    var outputDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Gnaw", isDirectory: true).path

    init(
        url: String = "",
        preset: CapturePreset = .skim,
        output: CaptureOutput = .complete,
        maxPages: Int = 200,
        outputDirectory: String = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Gnaw", isDirectory: true).path
    ) {
        self.url = url
        self.preset = preset
        self.output = output
        self.maxPages = maxPages
        self.outputDirectory = outputDirectory
    }

    var modes: String {
        output.modes
    }
}

struct CaptureSummary: Codable, Equatable {
    let pages: Int
    let assets: Int
    let bytes: Int64
    let durationMs: Int?
}

struct GnawEvent: Decodable {
    let v: Int
    let type: String
    let id: String?
    let url: String?
    let method: String?
    let kind: String?
    let bytes: Int64?
    let status: Int?
    let rawPath: String?
    let pages: Int?
    let assets: Int?
    let queued: Int?
    let elapsedMs: Int?
    let state: String?
    let result: String?
    let summary: CaptureSummary?
    let haulPath: String?
    let primary: String?
    let code: String?
    let message: String?
    let reason: String?
    let entrypoint: String?

    private enum CodingKeys: String, CodingKey {
        case v, type, id, url, method, kind, bytes, status, rawPath
        case pages, assets, queued, elapsedMs, state, result, summary
        case haulPath, primary, code, message, reason, entrypoint
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        v = try container.decode(Int.self, forKey: .v)
        type = try container.decode(String.self, forKey: .type)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        method = try container.decodeIfPresent(String.self, forKey: .method)
        kind = try container.decodeIfPresent(String.self, forKey: .kind)
        bytes = try container.decodeIfPresent(Int64.self, forKey: .bytes)
        // `status` is an integer for asset events and a string for browser events.
        status = try? container.decode(Int.self, forKey: .status)
        rawPath = try container.decodeIfPresent(String.self, forKey: .rawPath)
        pages = try container.decodeIfPresent(Int.self, forKey: .pages)
        assets = try container.decodeIfPresent(Int.self, forKey: .assets)
        queued = try container.decodeIfPresent(Int.self, forKey: .queued)
        elapsedMs = try container.decodeIfPresent(Int.self, forKey: .elapsedMs)
        state = try container.decodeIfPresent(String.self, forKey: .state)
        result = try container.decodeIfPresent(String.self, forKey: .result)
        summary = try container.decodeIfPresent(CaptureSummary.self, forKey: .summary)
        haulPath = try container.decodeIfPresent(String.self, forKey: .haulPath)
        primary = try container.decodeIfPresent(String.self, forKey: .primary)
        code = try container.decodeIfPresent(String.self, forKey: .code)
        message = try container.decodeIfPresent(String.self, forKey: .message)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        entrypoint = try container.decodeIfPresent(String.self, forKey: .entrypoint)
    }
}

struct WaterfallRow: Identifiable, Equatable {
    let id: String
    var url: String
    var kind = "…"
    var bytes: Int64?
    var status: Int?
    var durationMs: Int?
    var contentType: String?
    var localFilePath: String?
    var isInFlight = true

    var displayPath: String {
        guard let components = URLComponents(string: url) else { return url }
        let path = components.path.isEmpty ? "/" : components.path
        return components.query.map { "\(path)?\($0)" } ?? path
    }

    var localFileURL: URL? {
        localFilePath.map { URL(fileURLWithPath: $0) }
    }
}

enum CapturePhase: Equatable {
    case setup
    case capturing
    case result
}

enum SidebarSelection: Hashable {
    case newCapture
    case currentCapture
    case haul(String)
}

struct HaulRecord: Identifiable, Equatable {
    let id: String
    let path: String
    let entrypoint: String
    let host: String
    let startedAt: Date
    let result: String
    let modes: [String]
    let depth: Int
    let maxPages: Int
    let summary: CaptureSummary
    let stackName: String?
    let errorCount: Int
    let skippedCount: Int

    var configuration: CaptureConfiguration {
        CaptureConfiguration(
            url: entrypoint,
            preset: .closest(to: depth),
            output: .from(modes: modes),
            maxPages: maxPages,
            outputDirectory: URL(fileURLWithPath: path).deletingLastPathComponent().path
        )
    }
}

struct HaulScanResult: Equatable {
    let hauls: [HaulRecord]
    let unreadableManifestCount: Int
}
