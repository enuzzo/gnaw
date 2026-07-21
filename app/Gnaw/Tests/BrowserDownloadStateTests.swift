import XCTest
@testable import Gnaw

@MainActor
final class BrowserDownloadStateTests: XCTestCase {
    private func event(_ json: String) throws -> GnawEvent {
        try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))
    }

    func testDownloadingEventSetsDownloadingDetail() throws {
        let model = AppModel()
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"downloading","detail":"Downloading browser engine…"}"#))
        guard case .downloading(let detail) = model.browserDownload else {
            return XCTFail("expected .downloading, got \(model.browserDownload)")
        }
        XCTAssertEqual(detail, "Downloading browser engine…")
    }

    func testFoundEventClearsDownloadState() throws {
        let model = AppModel()
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"downloading","detail":"x"}"#))
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"found","detail":"Google Chrome"}"#))
        XCTAssertEqual(model.browserDownload, .idle)
    }

    func testCancelBrowserDownloadReturnsToIdleFromDownloading() throws {
        let model = AppModel()
        model.consumeBrowserEvent(try event(#"{"v":2,"type":"browser","status":"downloading","detail":"x"}"#))
        guard case .downloading = model.browserDownload else {
            return XCTFail("expected .downloading, got \(model.browserDownload)")
        }
        // Safe even with no in-flight ensure process.
        model.cancelBrowserDownload()
        XCTAssertEqual(model.browserDownload, .idle)
    }

    func testCancelSuppressesFailureAlertOnSubsequentExit() throws {
        let model = AppModel()
        model.browserDownload = .downloading("x")
        model.cancelBrowserDownload()
        XCTAssertEqual(model.browserDownload, .idle)
        // Simulate the SIGTERM-induced non-zero exit that arrives after cancellation.
        model.finishBrowserDownload(15)
        XCTAssertEqual(model.browserDownload, .idle)
    }

    func testRealFailureStillSurfacesAlert() throws {
        let model = AppModel()
        model.browserDownload = .downloading("x")
        model.finishBrowserDownload(4)
        if case .failed = model.browserDownload {
            // expected
        } else {
            XCTFail("expected .failed, got \(model.browserDownload)")
        }
    }
}
