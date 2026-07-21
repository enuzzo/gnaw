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
}
