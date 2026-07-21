import Foundation

struct HaulLibrary {
    private let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    func scan(outputDirectory: String) -> HaulScanResult {
        let root = URL(fileURLWithPath: outputDirectory, isDirectory: true).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return HaulScanResult(hauls: [], unreadableManifestCount: 0)
        }

        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants],
            errorHandler: { _, _ in true }
        ) else {
            return HaulScanResult(hauls: [], unreadableManifestCount: 0)
        }

        var hauls: [HaulRecord] = []
        var unreadableManifestCount = 0

        for case let haulURL as URL in enumerator {
            guard (try? haulURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            let fileURL = haulURL.appendingPathComponent("MANIFEST.json")
            let waterfallURL = haulURL.appendingPathComponent("waterfall.ndjson")
            guard fileManager.fileExists(atPath: fileURL.path),
                  fileManager.fileExists(atPath: waterfallURL.path)
            else { continue }

            enumerator.skipDescendants()
            do {
                let data = try Data(contentsOf: fileURL)
                let manifest = try JSONDecoder().decode(ManifestFile.self, from: data)
                guard manifest.schemaVersion == 2 else {
                    unreadableManifestCount += 1
                    continue
                }
                let startedAt = Self.parseDate(manifest.startedAt)
                    ?? Self.parseFolderDate(haulURL.lastPathComponent)
                    ?? (try? haulURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)
                    ?? .distantPast

                let haulURL = haulURL.standardizedFileURL
                hauls.append(HaulRecord(
                    id: haulURL.path,
                    path: haulURL.path,
                    entrypoint: manifest.entrypoint,
                    host: manifest.host,
                    startedAt: startedAt,
                    result: manifest.result,
                    modes: manifest.modes,
                    depth: manifest.config.depth,
                    maxPages: manifest.config.maxPages,
                    summary: CaptureSummary(
                        pages: manifest.stats.pages,
                        assets: manifest.stats.assets,
                        bytes: manifest.stats.bytes,
                        durationMs: manifest.durationMs
                    ),
                    stackName: manifest.stack.primary,
                    errorCount: manifest.errors?.count ?? 0,
                    skippedCount: manifest.safety?.skippedUrls.count ?? 0
                ))
            } catch {
                unreadableManifestCount += 1
            }
        }

        return HaulScanResult(
            hauls: hauls.sorted { $0.startedAt > $1.startedAt },
            unreadableManifestCount: unreadableManifestCount
        )
    }

    func loadWaterfall(for haul: HaulRecord) -> [WaterfallRow] {
        let haulURL = URL(fileURLWithPath: haul.path, isDirectory: true)
        let fileURL = haulURL.appendingPathComponent("waterfall.ndjson")
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        let decoder = JSONDecoder()
        let assetPaths = loadAssetPaths(in: haulURL, decoder: decoder)

        return data.split(separator: 0x0A).enumerated().compactMap { index, line in
            guard let entry = try? decoder.decode(WaterfallEntry.self, from: Data(line)) else { return nil }
            let relativePath = assetPaths[entry.url]
            return WaterfallRow(
                id: "\(haul.id)#\(index)",
                url: entry.url,
                kind: entry.kind,
                bytes: entry.bytes,
                status: entry.status,
                durationMs: entry.durationMs,
                contentType: entry.contentType,
                localFilePath: relativePath.flatMap {
                    resolvedAssetPath(in: haul.path, relativePath: $0)
                },
                isInFlight: false
            )
        }
    }

    func resolvedAssetPath(in haulPath: String, relativePath: String) -> String? {
        guard !relativePath.isEmpty, !NSString(string: relativePath).isAbsolutePath else { return nil }

        let root = URL(fileURLWithPath: haulPath, isDirectory: true)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        let candidate = root
            .appendingPathComponent(relativePath)
            .standardizedFileURL
            .resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(root.path + "/") else { return nil }

        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            return nil
        }
        return candidate.path
    }

    private func loadAssetPaths(in haulURL: URL, decoder: JSONDecoder) -> [String: String] {
        let manifestURL = haulURL.appendingPathComponent("MANIFEST.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? decoder.decode(ManifestFile.self, from: data)
        else { return [:] }

        return (manifest.assets ?? []).reduce(into: [:]) { paths, asset in
            paths[asset.url] = asset.rawPath
        }
    }

    private static let fractionalDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let dateFormatter = ISO8601DateFormatter()

    private static let folderDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()

    private static func parseDate(_ value: String) -> Date? {
        fractionalDateFormatter.date(from: value) ?? dateFormatter.date(from: value)
    }

    private static func parseFolderDate(_ folderName: String) -> Date? {
        guard let range = folderName.range(of: #"\d{8}-\d{6}$"#, options: .regularExpression) else {
            return nil
        }
        return folderDateFormatter.date(from: String(folderName[range]))
    }
}

private struct ManifestFile: Decodable {
    let schemaVersion: Int
    let entrypoint: String
    let host: String
    let startedAt: String
    let durationMs: Int
    let result: String
    let modes: [String]
    let config: ManifestConfiguration
    let stack: ManifestStack
    let stats: ManifestStats
    let assets: [ManifestAsset]?
    let safety: ManifestSafety?
    let errors: [ManifestError]?
}

private struct ManifestAsset: Decodable {
    let url: String
    let rawPath: String
}

private struct ManifestConfiguration: Decodable {
    let depth: Int
    let maxPages: Int
}

private struct ManifestStack: Decodable {
    let primary: String?
}

private struct ManifestStats: Decodable {
    let pages: Int
    let assets: Int
    let bytes: Int64
}

private struct ManifestSafety: Decodable {
    let skippedUrls: [ManifestSkippedURL]
}

private struct ManifestSkippedURL: Decodable {}
private struct ManifestError: Decodable {}

private struct WaterfallEntry: Decodable {
    let url: String
    let status: Int
    let kind: String
    let contentType: String
    let bytes: Int64
    let durationMs: Int
}
