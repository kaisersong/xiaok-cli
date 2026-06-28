import XCTest

final class XiaokMobileUITests: XCTestCase {
    func testConnectsToRealDesktopGatewayFromDevice() throws {
        guard let gatewayURL = ProcessInfo.processInfo.environment["XIAOK_MOBILE_REAL_GATEWAY_URL"],
              !gatewayURL.isEmpty else {
            throw XCTSkip("Set XIAOK_MOBILE_REAL_GATEWAY_URL to run the real device gateway connection test.")
        }

        let app = XCUIApplication()
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()
        allowSystemAlertIfPresent()

        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()

        let gatewayInput = app.textFields["GatewayURLInput"]
        XCTAssertTrue(gatewayInput.waitForExistence(timeout: 10))
        replaceText(in: gatewayInput, with: gatewayURL)

        let connectButton = app.buttons["ConnectToDesktopButton"]
        XCTAssertTrue(connectButton.waitForExistence(timeout: 5))
        if !connectButton.isHittable {
            app.swipeUp()
        }
        connectButton.tap()
        allowSystemAlertIfPresent()

        XCTAssertTrue(app.staticTexts["Desktop online"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts[gatewayURL].waitForExistence(timeout: 5))
    }

    func testRealDesktopGatewaySendsMessageFromDevice() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let gatewayURL = environment["XIAOK_MOBILE_REAL_GATEWAY_URL"],
              let desktopId = environment["XIAOK_MOBILE_REAL_DESKTOP_ID"],
              let accessToken = environment["XIAOK_MOBILE_REAL_ACCESS_TOKEN"],
              let message = environment["XIAOK_MOBILE_REAL_MESSAGE"],
              !gatewayURL.isEmpty,
              !desktopId.isEmpty,
              !accessToken.isEmpty,
              !message.isEmpty else {
            throw XCTSkip("Set real desktop gateway credentials to run the real device send test.")
        }

        let app = XCUIApplication()
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launchEnvironment["XIAOK_MOBILE_GATEWAY_URL"] = gatewayURL
        app.launchEnvironment["XIAOK_MOBILE_DESKTOP_ID"] = desktopId
        app.launchEnvironment["XIAOK_MOBILE_ACCESS_TOKEN"] = accessToken
        app.launch()
        allowSystemAlertIfPresent()

        XCTAssertTrue(app.staticTexts["Desktop online"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Tasks"].tap()

        let messageInput = app.textFields["MessageInput"]
        XCTAssertTrue(messageInput.waitForExistence(timeout: 10))
        messageInput.tap()
        messageInput.typeText(message)

        let sendButton = app.buttons["SendMessageButton"]
        XCTAssertTrue(sendButton.waitForExistence(timeout: 5))
        XCTAssertTrue(sendButton.isEnabled)
        sendButton.tap()

        XCTAssertTrue(app.staticTexts[message].waitForExistence(timeout: 20))
    }

    func testSettingsRendersConnectionAndLanguageControls() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Settings"].tap()

        XCTAssertTrue(app.staticTexts["Desktop Connection"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["GatewayURLInput"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["ScanPairingQRCodeButton"].waitForExistence(timeout: 5))
        app.buttons["ScanPairingQRCodeButton"].tap()
        XCTAssertTrue(app.staticTexts["Align the QR code inside the frame."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.otherElements["PairingQRCodeFrame"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["ConnectToDesktopButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Language"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["System"].waitForExistence(timeout: 5))
    }

    func testOfflineTasksShowsConnectionEntryAndDisablesSend() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test", "--xiaok-offline"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        app.tabBars.buttons["Tasks"].tap()

        XCTAssertTrue(app.staticTexts["Connect to Desktop"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["SendMessageButton"].isEnabled)

        app.buttons["OpenConnectionSettingsButton"].tap()

        XCTAssertTrue(app.staticTexts["Desktop Connection"].waitForExistence(timeout: 5))
    }

    func testMockGatewayTaskFlowKeepsHistoryBehindToolbarInSimulator() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        XCTAssertTrue(app.staticTexts["Overview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Desktop online"].waitForExistence(timeout: 5))

        app.tabBars.buttons["Tasks"].tap()

        XCTAssertTrue(app.staticTexts["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["What are we working on?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Draft a status update"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Mobile ready"].waitForExistence(timeout: 1))

        app.buttons["TaskHistoryButton"].tap()
        XCTAssertTrue(app.staticTexts["Task history"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Mobile ready"].waitForExistence(timeout: 5))
        app.staticTexts["Mobile ready"].tap()
        XCTAssertTrue(app.staticTexts["mobile ready"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Mermaid diagram"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Artifacts"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["mobile-output.md"].waitForExistence(timeout: 5))
        app.staticTexts["mobile-output.md"].tap()
        XCTAssertTrue(app.staticTexts["Artifact preview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Mock artifact preview")).element.waitForExistence(timeout: 5))
        app.buttons["Done"].tap()

        app.buttons["NewTaskButton"].tap()
        XCTAssertFalse(app.staticTexts["Mobile ready"].waitForExistence(timeout: 1))

        let messageInput = app.textFields["MessageInput"]
        XCTAssertTrue(messageInput.waitForExistence(timeout: 5))
        messageInput.tap()
        messageInput.typeText("ping")
        app.buttons["SendMessageButton"].tap()

        XCTAssertTrue(app.staticTexts["ping"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["pong from desktop"].waitForExistence(timeout: 5))
    }

    func testDesktopCoreTabsRenderAndApprovalFlowInSimulator() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        XCTAssertTrue(app.staticTexts["2 active projects"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["2 pending approvals"].waitForExistence(timeout: 5))

        app.tabBars.buttons["Work"].tap()
        XCTAssertTrue(app.staticTexts["Launch desktop gateway"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Design mobile sync"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Daily report loop"].waitForExistence(timeout: 5))
        app.staticTexts["Launch desktop gateway"].tap()
        XCTAssertTrue(app.staticTexts["Project details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["report-preview.pdf"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()

        app.tabBars.buttons["Approvals"].tap()
        XCTAssertTrue(app.staticTexts["Allow Codex to run build"].waitForExistence(timeout: 5))
        app.buttons["Approve approval-build"].tap()
        XCTAssertTrue(app.staticTexts["Approved"].waitForExistence(timeout: 5))

        app.tabBars.buttons["Work"].tap()
        XCTAssertTrue(app.staticTexts["mobile-output.md"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["report-preview.pdf"].waitForExistence(timeout: 5))
    }

    func testApprovalsEmptyStateExplainsPurposeWhenThereIsNothingToReview() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test", "--xiaok-offline"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        app.tabBars.buttons["Approvals"].tap()

        XCTAssertTrue(app.staticTexts["No approvals"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Desktop tasks that need your confirmation will appear here."].waitForExistence(timeout: 5))
    }

    private func replaceText(in textField: XCUIElement, with text: String) {
        textField.tap()
        let currentValue = textField.value as? String ?? ""
        if !currentValue.isEmpty {
            textField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: currentValue.count))
        }
        textField.typeText(text)
    }

    private func allowSystemAlertIfPresent() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 3) else {
            return
        }

        if alert.buttons["Allow"].exists {
            alert.buttons["Allow"].tap()
            return
        }

        if alert.buttons.count > 1 {
            alert.buttons.element(boundBy: 1).tap()
            return
        }

        if alert.buttons.firstMatch.exists {
            alert.buttons.firstMatch.tap()
        }
    }
}
