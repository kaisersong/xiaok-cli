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

        assertNoBottomTabs(in: app)
        openSidebarSection("TaskSidebarSettings", in: app)

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
        assertNoBottomTabs(in: app)

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

    func testRealDesktopTaskHistoryShowsConversationMessagesFromDevice() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let gatewayURL = environment["XIAOK_MOBILE_REAL_GATEWAY_URL"],
              let desktopId = environment["XIAOK_MOBILE_REAL_DESKTOP_ID"],
              let accessToken = environment["XIAOK_MOBILE_REAL_ACCESS_TOKEN"],
              let conversationTitle = environment["XIAOK_MOBILE_REAL_CONVERSATION_TITLE"],
              let expectedReplyText = environment["XIAOK_MOBILE_REAL_CONVERSATION_REPLY"],
              !gatewayURL.isEmpty,
              !desktopId.isEmpty,
              !accessToken.isEmpty,
              !conversationTitle.isEmpty,
              !expectedReplyText.isEmpty else {
            throw XCTSkip("Set real desktop gateway credentials and a conversation title/reply to run the real task history test.")
        }

        let app = XCUIApplication()
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "zh-Hans"
        app.launchEnvironment["XIAOK_MOBILE_GATEWAY_URL"] = gatewayURL
        app.launchEnvironment["XIAOK_MOBILE_DESKTOP_ID"] = desktopId
        app.launchEnvironment["XIAOK_MOBILE_ACCESS_TOKEN"] = accessToken
        app.launch()
        allowSystemAlertIfPresent()

        XCTAssertTrue(app.staticTexts["桌面端在线"].waitForExistence(timeout: 20))
        assertNoBottomTabs(in: app)
        XCTAssertTrue(app.staticTexts["任务"].waitForExistence(timeout: 5))

        app.buttons["TaskMenuButton"].tap()
        XCTAssertTrue(app.staticTexts["任务"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["最近"].waitForExistence(timeout: 5))
        for _ in 0..<8 where !app.staticTexts[conversationTitle].exists {
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts[conversationTitle].waitForExistence(timeout: 5))
        app.staticTexts[conversationTitle].tap()

        XCTAssertTrue(app.staticTexts[conversationTitle].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", expectedReplyText)).element.waitForExistence(timeout: 5))
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "Real desktop task history conversation"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testSettingsRendersConnectionAndLanguageControls() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        assertNoBottomTabs(in: app)
        openSidebarSection("TaskSidebarSettings", in: app)

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

    func testSettingsGatewayInputUpdatesAfterPairingDeepLink() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test", "--xiaok-offline"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launchEnvironment["XIAOK_MOBILE_TEST_SCANNED_QR_CODE"] = "xiaok://mobile/pair?gateway=http%3A%2F%2F192.168.31.84%3A47891&desktopId=desktop-ui-pair&token=token-ui-pair"
        app.launch()

        assertNoBottomTabs(in: app)
        openSidebarSection("TaskSidebarSettings", in: app)

        let gatewayInput = app.textFields["GatewayURLInput"]
        XCTAssertTrue(gatewayInput.waitForExistence(timeout: 5))

        app.buttons["ScanPairingQRCodeButton"].tap()

        let gatewayURL = "http://192.168.31.84:47891"
        let predicate = NSPredicate(format: "value == %@", gatewayURL)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: gatewayInput)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
    }

    func testOfflineTasksShowsConnectionEntryAndDisablesSend() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test", "--xiaok-offline"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        assertNoBottomTabs(in: app)

        XCTAssertTrue(app.staticTexts["Connect to Desktop"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["SendMessageButton"].isEnabled)

        app.buttons["OpenConnectionSettingsButton"].tap()

        XCTAssertTrue(app.staticTexts["Desktop Connection"].waitForExistence(timeout: 5))
    }

    func testMockGatewayTaskFlowUsesFixedSidebarAndMixedMessagesInSimulator() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        assertNoBottomTabs(in: app)

        XCTAssertTrue(app.staticTexts["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["TaskMenuButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Ask"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["What are we working on?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["MessageInput"].waitForExistence(timeout: 5))
        app.buttons["AddTaskContextButton"].tap()
        XCTAssertTrue(app.staticTexts["Add to task"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Desktop context"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Tool access"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertFalse(app.staticTexts["Mobile mixed demo"].waitForExistence(timeout: 1))

        app.buttons["TaskMenuButton"].tap()
        XCTAssertTrue(app.staticTexts["XiaoK"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["TaskSidebarProjects"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["TaskSidebarArtifacts"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["TaskSidebarKnowledge"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["TaskSidebarAutomations"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["TaskSidebarCode"].exists)

        app.buttons["TaskSidebarProjects"].tap()
        XCTAssertTrue(app.staticTexts["Launch desktop gateway"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["TaskSidebarProject-project-gateway"].waitForExistence(timeout: 1))
        app.buttons["TaskMainProject-project-gateway"].tap()
        XCTAssertTrue(app.staticTexts["Keep mobile work view aligned with desktop"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["2 artifacts"].waitForExistence(timeout: 5))
        app.buttons["TaskMainBackButton"].tap()

        app.buttons["TaskMenuButton"].tap()
        app.buttons["TaskSidebarArtifacts"].tap()
        XCTAssertTrue(app.staticTexts["mobile-output.md"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["mobile-dashboard.html"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["report-preview.pdf"].waitForExistence(timeout: 5))
        let reportArtifact = app.buttons["TaskMainArtifact-artifact-report"]
        XCTAssertTrue(reportArtifact.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(reportArtifact, timeout: 5))
        app.staticTexts["report-preview.pdf"].tap()
        XCTAssertTrue(app.staticTexts["Artifact preview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["OpenOrSaveArtifactButton"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "PDF")).element.waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertFalse(app.staticTexts["Artifact preview"].waitForExistence(timeout: 2))

        app.buttons["TaskMainArtifact-artifact-html-dashboard"].tap()
        XCTAssertTrue(app.staticTexts["Artifact preview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Rendered mobile dashboard")).element.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "<html")).element.exists)
        app.buttons["Done"].tap()

        app.buttons["TaskMenuButton"].tap()
        app.buttons["TaskSidebarKnowledge"].tap()
        XCTAssertTrue(app.staticTexts["Knowledge"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["No knowledge items yet"].waitForExistence(timeout: 5))

        app.buttons["TaskMenuButton"].tap()
        app.buttons["TaskSidebarAutomations"].tap()
        XCTAssertTrue(app.staticTexts["Daily report loop"].waitForExistence(timeout: 5))
        app.staticTexts["Daily report loop"].tap()
        XCTAssertTrue(app.staticTexts["Tomorrow 09:00"].waitForExistence(timeout: 5))
        app.buttons["TaskMainBackButton"].tap()

        app.buttons["TaskMenuButton"].tap()
        XCTAssertTrue(app.buttons["TaskSidebarTasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Recents"].waitForExistence(timeout: 5))
        let taskHistorySearch = app.textFields["TaskHistorySearchInput"]
        XCTAssertTrue(taskHistorySearch.waitForExistence(timeout: 5))
        taskHistorySearch.tap()
        taskHistorySearch.typeText("mixed")
        XCTAssertTrue(app.staticTexts["Mobile mixed demo"].waitForExistence(timeout: 5))
        app.staticTexts["XiaoK"].tap()
        let mixedConversation = app.buttons["TaskSidebarConversation-mock-ready"]
        XCTAssertTrue(waitUntilHittable(mixedConversation, timeout: 5))
        mixedConversation.tap()
        XCTAssertTrue(app.staticTexts["Mobile mixed demo"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.scrollViews["TaskConversationScrollView"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["ConversationTopBarTitle"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Ask"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Mobile mixed demo 🚀"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "let artifacts")).element.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Assistant"].exists)
        XCTAssertFalse(app.staticTexts["User"].exists)
        XCTAssertFalse(app.staticTexts["Sent"].exists)
        XCTAssertTrue(app.staticTexts["Mermaid diagram"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["User message 🚀"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Render code block"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Attach artifact card"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Review on phone"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Artifacts"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["mobile-output.md"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["CopyMessageButton"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "[SYSTEM:")).element.exists)

        let bashActivity = app.buttons["MessageActivity-mock-bash-complete"]
        if !bashActivity.waitForExistence(timeout: 2) {
            app.swipeUp()
        }
        XCTAssertTrue(bashActivity.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "xcodebuild test -scheme XiaokMobile")).element.exists)
        bashActivity.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "xcodebuild test -scheme XiaokMobile")).element.waitForExistence(timeout: 5))

        XCTAssertFalse(app.staticTexts["mock-ready"].exists)
        let conversationArtifact = app.buttons["TaskConversationArtifact-artifact-mobile-output"]
        var artifactScrollAttempts = 0
        while !conversationArtifact.exists && artifactScrollAttempts < 5 {
            app.swipeDown()
            artifactScrollAttempts += 1
        }
        XCTAssertTrue(waitUntilHittable(conversationArtifact, timeout: 5))
        conversationArtifact.tap()
        XCTAssertTrue(app.staticTexts["Artifact preview"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Mock artifact preview")).element.waitForExistence(timeout: 5))
        app.buttons["Done"].tap()

        let xiaokDesktopLink = app.links["Xiaok Desktop"]
        let xiaokDesktopButton = app.buttons["Xiaok Desktop"]
        var linkScrollAttempts = 0
        while !xiaokDesktopLink.exists && !xiaokDesktopButton.exists && linkScrollAttempts < 3 {
            app.swipeUp()
            linkScrollAttempts += 1
        }
        let didFindDesktopLink = xiaokDesktopLink.waitForExistence(timeout: 1)
            || xiaokDesktopButton.waitForExistence(timeout: 1)
        XCTAssertTrue(didFindDesktopLink)
        XCTAssertTrue(xiaokDesktopLink.exists ? xiaokDesktopLink.isHittable : xiaokDesktopButton.isHittable)

        XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5))
        app.swipeRight()
        XCTAssertTrue(app.staticTexts["What are we working on?"].waitForExistence(timeout: 5))

        app.buttons["TaskMenuButton"].tap()
        XCTAssertTrue(app.staticTexts["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Mobile mixed demo"].waitForExistence(timeout: 5))
        app.buttons["TaskSidebarConversation-mock-ready"].tap()
        XCTAssertTrue(app.buttons["Back"].waitForExistence(timeout: 5))
        app.buttons["Back"].tap()
        XCTAssertTrue(app.staticTexts["What are we working on?"].waitForExistence(timeout: 5))

        app.buttons["NewTaskButton"].tap()
        XCTAssertFalse(app.staticTexts["Mobile mixed demo"].waitForExistence(timeout: 1))

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

        assertNoBottomTabs(in: app)
        openSidebarSection("TaskSidebarProjects", in: app)
        XCTAssertTrue(app.staticTexts["Launch desktop gateway"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Design mobile sync"].waitForExistence(timeout: 5))
        app.staticTexts["Launch desktop gateway"].tap()
        XCTAssertTrue(app.staticTexts["Project details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Goal"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Keep mobile work view aligned with desktop"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["2 artifacts"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Artifacts"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["report-preview.pdf"].waitForExistence(timeout: 5))
        app.buttons["TaskMainBackButton"].tap()

        openSidebarSection("TaskSidebarAutomations", in: app)
        XCTAssertTrue(app.staticTexts["Daily report loop"].waitForExistence(timeout: 5))

        openSidebarSection("TaskSidebarApprovals", in: app)
        XCTAssertTrue(app.staticTexts["Allow Codex to run build"].waitForExistence(timeout: 5))
        app.buttons["Approve approval-build"].tap()
        XCTAssertTrue(app.staticTexts["Approved"].waitForExistence(timeout: 5))

        openSidebarSection("TaskSidebarArtifacts", in: app)
        XCTAssertTrue(app.staticTexts["mobile-output.md"].waitForExistence(timeout: 5))
        if !app.staticTexts["report-preview.pdf"].waitForExistence(timeout: 2) {
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["report-preview.pdf"].waitForExistence(timeout: 5))
    }

    func testSidebarTasksItemReturnsFromMainSectionsToTaskComposer() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        assertNoBottomTabs(in: app)
        openSidebarSection("TaskSidebarProjects", in: app)
        XCTAssertTrue(app.staticTexts["Launch desktop gateway"].waitForExistence(timeout: 5))

        app.buttons["TaskMenuButton"].tap()
        XCTAssertTrue(app.buttons["TaskSidebarTasks"].waitForExistence(timeout: 5))
        app.buttons["TaskSidebarTasks"].tap()

        XCTAssertTrue(app.staticTexts["What are we working on?"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["TaskSidebarProjects"].waitForExistence(timeout: 1))
        XCTAssertFalse(app.staticTexts["Launch desktop gateway"].waitForExistence(timeout: 1))
    }

    func testApprovalsEmptyStateExplainsPurposeWhenThereIsNothingToReview() {
        let app = XCUIApplication()
        app.launchArguments = ["--xiaok-ui-test", "--xiaok-offline"]
        app.launchEnvironment["XIAOK_MOBILE_TEST_MODE"] = "1"
        app.launchEnvironment["XIAOK_MOBILE_LANGUAGE"] = "en"
        app.launch()

        assertNoBottomTabs(in: app)
        openSidebarSection("TaskSidebarApprovals", in: app)

        XCTAssertTrue(app.staticTexts["No approvals"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Desktop tasks that need your confirmation will appear here."].waitForExistence(timeout: 5))
    }

    private func assertNoBottomTabs(in app: XCUIApplication) {
        XCTAssertFalse(app.tabBars.firstMatch.waitForExistence(timeout: 1))
    }

    private func openSidebarSection(_ identifier: String, in app: XCUIApplication) {
        let menuButton = app.buttons["TaskMenuButton"]
        XCTAssertTrue(menuButton.waitForExistence(timeout: 5))
        menuButton.tap()
        let sectionButton = app.buttons[identifier]
        XCTAssertTrue(sectionButton.waitForExistence(timeout: 5))
        sectionButton.tap()
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

    private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "hittable == true")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }
}
