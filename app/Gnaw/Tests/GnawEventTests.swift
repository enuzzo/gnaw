import XCTest
@testable import Gnaw

final class GnawEventTests: XCTestCase {
    func testDecodesProgressEvent() throws {
        let json = #"{"v":2,"type":"progress","pages":3,"assets":147,"bytes":8810342,"queued":12,"elapsedMs":42000}"#
        let event = try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))

        XCTAssertEqual(event.type, "progress")
        XCTAssertEqual(event.pages, 3)
        XCTAssertEqual(event.assets, 147)
        XCTAssertEqual(event.bytes, 8_810_342)
        XCTAssertEqual(event.queued, 12)
    }

    func testIgnoresUnknownFields() throws {
        let json = #"{"v":2,"type":"request","id":"r-1","url":"https://example.com","method":"GET","futureField":true}"#
        let event = try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))
        XCTAssertEqual(event.id, "r-1")
    }

    func testCaptureOutputMapsToEngineModes() {
        XCTAssertEqual(CaptureOutput.complete.modes, "study,navigable")
        XCTAssertEqual(CaptureOutput.offline.modes, "navigable")
        XCTAssertEqual(CaptureOutput.study.modes, "study")
    }

    func testBrowserStringStatusDoesNotBreakEventDecoding() throws {
        let json = #"{"v":2,"type":"browser","status":"found","detail":"Google Chrome"}"#
        let event = try JSONDecoder().decode(GnawEvent.self, from: Data(json.utf8))

        XCTAssertEqual(event.type, "browser")
        XCTAssertNil(event.status)
    }
}
