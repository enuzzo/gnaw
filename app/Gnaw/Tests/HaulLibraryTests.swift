import XCTest
@testable import Gnaw

final class HaulLibraryTests: XCTestCase {
    func testScansSortsAndMapsHaulsWithoutFailingOnBadManifest() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }

        try writeManifest(
            in: root.appendingPathComponent("haul-older"),
            host: "older.example",
            startedAt: "2026-07-16T09:30:00Z",
            modes: ["study"],
            depth: 0,
            bytes: 1_024
        )
        try writeManifest(
            in: root.appendingPathComponent("nested/haul-newer"),
            host: "newer.example",
            startedAt: "2026-07-17T10:30:00.000Z",
            modes: ["study", "navigable"],
            depth: 3,
            bytes: 4_096
        )

        let broken = root.appendingPathComponent("haul-broken")
        try FileManager.default.createDirectory(at: broken, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: broken.appendingPathComponent("MANIFEST.json"))
        try Data().write(to: broken.appendingPathComponent("waterfall.ndjson"))

        let result = HaulLibrary().scan(outputDirectory: root.path)

        XCTAssertEqual(result.hauls.map(\.host), ["newer.example", "older.example"])
        XCTAssertEqual(result.unreadableManifestCount, 1)
        XCTAssertEqual(result.hauls[0].configuration.preset, .site)
        XCTAssertEqual(result.hauls[0].configuration.output, .complete)
        XCTAssertEqual(result.hauls[1].configuration.output, .study)
    }

    func testLoadsFinishedWaterfallRowsAndSkipsMalformedLines() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let haulURL = root.appendingPathComponent("haul-example")
        try writeManifest(
            in: haulURL,
            host: "example.com",
            startedAt: "2026-07-17T10:30:00.000Z",
            modes: ["navigable"],
            depth: 1,
            bytes: 2_048,
            assetPath: "navigable/_assets/example.com/app.js"
        )
        let assetURL = haulURL.appendingPathComponent("navigable/_assets/example.com/app.js")
        try FileManager.default.createDirectory(
            at: assetURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try "const answer = 42;".write(to: assetURL, atomically: true, encoding: .utf8)
        let waterfall = """
        {"t":120,"url":"https://example.com/app.js","method":"GET","status":200,"kind":"JS","contentType":"application/javascript","bytes":2048,"durationMs":42,"fromCache":false,"viaJs":true,"referrer":null,"page":"https://example.com/"}
        malformed
        """
        try waterfall.write(
            to: haulURL.appendingPathComponent("waterfall.ndjson"),
            atomically: true,
            encoding: .utf8
        )

        let record = try XCTUnwrap(HaulLibrary().scan(outputDirectory: root.path).hauls.first)
        let rows = HaulLibrary().loadWaterfall(for: record)

        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].kind, "JS")
        XCTAssertEqual(rows[0].durationMs, 42)
        XCTAssertEqual(rows[0].contentType, "application/javascript")
        XCTAssertEqual(rows[0].localFilePath, assetURL.path)
        XCTAssertFalse(rows[0].isInFlight)
    }

    func testAssetPathResolutionRejectsTraversalAndAcceptsFilesInsideHaul() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let haulURL = root.appendingPathComponent("haul-example")
        let assetURL = haulURL.appendingPathComponent("study/raw/example.com/app.js")
        try FileManager.default.createDirectory(
            at: assetURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("safe".utf8).write(to: assetURL)
        let outsideURL = root.appendingPathComponent("outside.txt")
        try Data("outside".utf8).write(to: outsideURL)
        let escapingLinkURL = haulURL.appendingPathComponent("linked-outside.txt")
        try FileManager.default.createSymbolicLink(at: escapingLinkURL, withDestinationURL: outsideURL)

        let library = HaulLibrary()

        XCTAssertEqual(
            library.resolvedAssetPath(in: haulURL.path, relativePath: "study/raw/example.com/app.js"),
            assetURL.path
        )
        XCTAssertNil(library.resolvedAssetPath(in: haulURL.path, relativePath: "../outside.txt"))
        XCTAssertNil(library.resolvedAssetPath(in: haulURL.path, relativePath: outsideURL.path))
        XCTAssertNil(library.resolvedAssetPath(in: haulURL.path, relativePath: "linked-outside.txt"))
    }

    func testFallsBackToHaulFolderTimestampWhenManifestDateWasRedacted() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let haulURL = root.appendingPathComponent("haul-example.com-20260715-110729")
        try writeManifest(
            in: haulURL,
            host: "example.com",
            startedAt: "2026-07-[REDACTED]5T[REDACTED][REDACTED]:07:29.02[REDACTED]Z",
            modes: ["study"],
            depth: 1,
            bytes: 2_048
        )

        let result = HaulLibrary().scan(outputDirectory: root.path)

        XCTAssertEqual(result.hauls.count, 1)
        XCTAssertEqual(result.unreadableManifestCount, 0)
        XCTAssertEqual(
            result.hauls[0].startedAt,
            ISO8601DateFormatter().date(from: "2026-07-15T11:07:29Z")
        )
    }

    private func makeTemporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("GnawHaulLibraryTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func writeManifest(
        in haulURL: URL,
        host: String,
        startedAt: String,
        modes: [String],
        depth: Int,
        bytes: Int64,
        assetPath: String? = nil
    ) throws {
        try FileManager.default.createDirectory(at: haulURL, withIntermediateDirectories: true)
        let modesJSON = modes.map { "\"\($0)\"" }.joined(separator: ",")
        let assetsJSON = assetPath.map {
            "[{\"url\":\"https://\(host)/app.js\",\"rawPath\":\"\($0)\"}]"
        } ?? "[]"
        let manifest = """
        {
          "schemaVersion": 2,
          "entrypoint": "https://\(host)/",
          "host": "\(host)",
          "startedAt": "\(startedAt)",
          "durationMs": 1200,
          "result": "complete",
          "modes": [\(modesJSON)],
          "config": { "depth": \(depth), "maxPages": 200 },
          "stack": { "primary": "Next.js", "detected": [] },
          "stats": { "pages": 2, "assets": 3, "bytes": \(bytes), "byKind": {} },
          "assets": \(assetsJSON),
          "safety": { "skippedUrls": [] },
          "errors": []
        }
        """
        try manifest.write(
            to: haulURL.appendingPathComponent("MANIFEST.json"),
            atomically: true,
            encoding: .utf8
        )
        try Data().write(to: haulURL.appendingPathComponent("waterfall.ndjson"))
    }
}
