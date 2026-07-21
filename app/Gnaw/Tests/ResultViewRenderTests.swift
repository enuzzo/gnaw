import AppKit
import SwiftUI
import XCTest
@testable import Gnaw

@MainActor
final class ResultViewRenderTests: XCTestCase {
    func testNewCaptureViewRendersAtDesktopSize() throws {
        let model = configuredModel()
        model.phase = .setup

        try render(NewCaptureView(model: model), named: "new-capture")
    }

    func testCapturingViewRendersAtDesktopSize() throws {
        let model = configuredModel()
        model.phase = .capturing
        model.engineState = "running"
        model.pages = 20
        model.assets = 362
        model.bytes = 40_818_415
        model.queued = 7
        model.elapsedMs = 22_000
        model.stackName = "Next.js"
        model.logLines = ["Downloading captured assets…"]
        model.rows = sampleRows + [
            WaterfallRow(id: "6", url: "https://netmilk.ch/fonts/site.woff2")
        ]

        try render(CapturingView(model: model), named: "capturing")
    }

    func testCompactResultViewRendersAtDesktopSize() throws {
        let model = configuredModel()
        model.phase = .result
        model.result = "complete"
        model.summary = CaptureSummary(pages: 20, assets: 362, bytes: 40_818_415, durationMs: 22_000)
        model.haulPath = "/Users/example/Gnaw/haul-netmilk.ch-20260715-110729"
        model.rows = sampleRows

        try render(ResultView(model: model), named: "result")
    }

    private func configuredModel() -> AppModel {
        let model = AppModel()
        model.configuration = CaptureConfiguration(
            url: "https://netmilk.ch/",
            preset: .site,
            output: .study,
            maxPages: 200,
            outputDirectory: "/Users/example/Gnaw"
        )
        return model
    }

    private func render<Content: View>(_ content: Content, named name: String) throws {
        let view = NSHostingView(
            rootView: content
                .frame(width: 1_200, height: 800)
                .background(Color(nsColor: .windowBackgroundColor))
                .environment(\.colorScheme, .light)
        )
        view.frame = NSRect(x: 0, y: 0, width: 1_200, height: 800)

        // Attach the hosting view to an off-screen AppKit window so native-backed
        // SwiftUI controls such as Table take their real desktop rendering path.
        let window = NSWindow(
            contentRect: view.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.appearance = NSAppearance(named: .aqua)
        window.backgroundColor = .windowBackgroundColor
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        view.displayIfNeeded()

        let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        XCTAssertEqual(bitmap.pixelsWide, 1_200)
        XCTAssertEqual(bitmap.pixelsHigh, 800)

        if let outputDirectory = ProcessInfo.processInfo.environment["GNAW_SNAPSHOT_DIRECTORY"] {
            let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
            let outputURL = URL(fileURLWithPath: outputDirectory, isDirectory: true)
                .appendingPathComponent("\(name).png")
            try FileManager.default.createDirectory(
                at: outputURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try png.write(to: outputURL, options: .atomic)
        }
    }

    private var sampleRows: [WaterfallRow] {
        [
            WaterfallRow(
                id: "1",
                url: "https://netmilk.ch/",
                kind: "HTML",
                bytes: 33_000,
                status: 200,
                durationMs: 11,
                contentType: "text/html",
                isInFlight: false
            ),
            WaterfallRow(
                id: "2",
                url: "https://netmilk.ch/img/netmilk_logo_blue.svg",
                kind: "IMG",
                bytes: 10_000,
                status: 200,
                durationMs: 43,
                contentType: "image/svg+xml",
                isInFlight: false
            ),
            WaterfallRow(
                id: "3",
                url: "https://netmilk.ch/css/site.css",
                kind: "CSS",
                bytes: 18_300,
                status: 200,
                durationMs: 26,
                contentType: "text/css",
                isInFlight: false
            ),
            WaterfallRow(
                id: "4",
                url: "https://netmilk.ch/scripts/application.min.js",
                kind: "JS",
                bytes: 82_500,
                status: 200,
                durationMs: 49,
                contentType: "application/javascript",
                isInFlight: false
            ),
            WaterfallRow(
                id: "5",
                url: "https://netmilk.ch/img/portfolio/project.jpg",
                kind: "IMG",
                bytes: 248_000,
                status: 200,
                durationMs: 132,
                contentType: "image/jpeg",
                isInFlight: false
            )
        ]
    }
}
