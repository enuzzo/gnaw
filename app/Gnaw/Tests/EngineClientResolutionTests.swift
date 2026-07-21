import XCTest
@testable import Gnaw

final class EngineClientResolutionTests: XCTestCase {
    func testBrowserCachePathIsUnderApplicationSupportGnaw() {
        let path = EngineClient.browserCachePath.path
        XCTAssertTrue(path.hasSuffix("Application Support/Gnaw/browsers"), path)
    }

    func testMakeProcessInjectsBrowsersPathAndUsesResolvedNode() throws {
        let client = EngineClient()
        let built = try client.makeProcess(arguments: ["browser", "check"])
        XCTAssertEqual(built.0.executableURL, try client.resolveEngine().node)
        let env = built.0.environment ?? [:]
        XCTAssertEqual(env["PLAYWRIGHT_BROWSERS_PATH"], EngineClient.browserCachePath.path)
        XCTAssertEqual(built.0.arguments?.first, try client.resolveEngine().cli.path)
    }

    func testCheckBrowserCompletionFires() {
        // Guards against EngineClient#checkBrowser losing its Process to ARC before the
        // child exits: if `checkBrowser` doesn't retain the Process on self, the
        // terminationHandler (and thus this completion) may never fire, and this test
        // will time out instead of passing.
        let client = EngineClient()
        let expectation = expectation(description: "checkBrowser completion fires")
        client.checkBrowser { _ in expectation.fulfill() }
        wait(for: [expectation], timeout: 30)
    }
}
