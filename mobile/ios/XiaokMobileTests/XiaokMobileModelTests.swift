import XCTest
@testable import XiaokMobile

final class XiaokMobileModelTests: XCTestCase {
    func testAppDeclaresLocalNetworkAccessForDesktopGateway() throws {
        let localNetworkUsage = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "NSLocalNetworkUsageDescription") as? String)
        XCTAssertFalse(localNetworkUsage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        let appTransportSecurity = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any])
        XCTAssertEqual(appTransportSecurity["NSAllowsLocalNetworking"] as? Bool, true)

        let bonjourServices = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "NSBonjourServices") as? [String])
        XCTAssertTrue(bonjourServices.contains("_xiaok-desktop._tcp"))

        let urlTypes = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]])
        let schemes = urlTypes.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        XCTAssertTrue(schemes.contains("xiaok"))
    }

    @MainActor
    func testStorePersistsExplicitNonLoopbackEnvironmentGatewayForDeviceLaunch() {
        let gatewayKey = "XIAOK_MOBILE_GATEWAY_URL"
        let tokenKey = "XIAOK_MOBILE_ACCESS_TOKEN"
        let previousGatewayValue = ProcessInfo.processInfo.environment[gatewayKey]
        let previousTokenValue = ProcessInfo.processInfo.environment[tokenKey]
        setenv(gatewayKey, "http://192.168.1.55:47891", 1)
        setenv(tokenKey, "token-from-device-launch", 1)
        defer {
            if let previousGatewayValue {
                setenv(gatewayKey, previousGatewayValue, 1)
            } else {
                unsetenv(gatewayKey)
            }
            if let previousTokenValue {
                setenv(tokenKey, previousTokenValue, 1)
            } else {
                unsetenv(tokenKey)
            }
        }

        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )

        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.55:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL), "http://192.168.1.55:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.accessToken), "token-from-device-launch")
    }

    @MainActor
    func testStoreDefaultsLanguageToSystemAndPersistsExplicitChoice() {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            client: MockMobileGatewayClient(),
            userDefaults: defaults
        )

        XCTAssertEqual(store.language, .system)

        store.updateLanguage(.simplifiedChinese)

        XCTAssertEqual(store.language, .simplifiedChinese)
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.language), AppLanguage.simplifiedChinese.rawValue)
    }

    @MainActor
    func testStoreDoesNotExposeLoopbackGatewayAsDefaultConnectionTarget() {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )

        XCTAssertEqual(store.gatewayURLString, "")
    }

    @MainActor
    func testStoreMigratesPersistedLoopbackGatewayAwayForRealDevices() {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        defaults.set("http://127.0.0.1:47891", forKey: XiaokPreferenceKeys.gatewayURL)

        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )

        XCTAssertEqual(store.gatewayURLString, "")
        XCTAssertNil(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL))
    }

    @MainActor
    func testStorePersistsGatewayURLAndRebuildsClient() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )

        let didUpdate = store.updateGatewayURL(" http://192.168.1.20:47891 ")

        XCTAssertTrue(didUpdate)
        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.20:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL), "http://192.168.1.20:47891")

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.desktopName, "Desktop at 192.168.1.20")
        XCTAssertEqual(store.health, .online)
    }

    @MainActor
    func testStoreRejectsInvalidGatewayURLWithoutReplacingCurrentClient() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )

        XCTAssertFalse(store.updateGatewayURL("not a url"))
        XCTAssertEqual(store.gatewayURLString, "")

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.health, .offline)
    }

    @MainActor
    func testStoreAppliesDesktopPairingDeepLinkAndPersistsRelayFallback() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )
        let deepLink = URL(string: "xiaok://mobile/pair?gateway=http%3A%2F%2F192.168.1.44%3A47891&desktopId=desktop-192.168.1.44&token=token-paired&relayUrl=wss%3A%2F%2Frelay.example%2Fws&relayJWT=relay-jwt-paired&relayRoomSecret=room-secret-paired")!

        XCTAssertTrue(store.applyPairingURL(deepLink))

        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.44:47891")
        XCTAssertEqual(store.desktopId, "desktop-192.168.1.44")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL), "http://192.168.1.44:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.desktopId), "desktop-192.168.1.44")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.accessToken), "token-paired")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.relayURL), "wss://relay.example/ws")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.relayJWT), "relay-jwt-paired")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.relayRoomSecret), "room-secret-paired")

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.desktopName, "Desktop at 192.168.1.44")
        XCTAssertEqual(store.connectionRoute, .lan)
    }

    @MainActor
    func testStoreRejectsLoopbackPairingDeepLinkWithoutReplacingCurrentGateway() {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        defaults.set("http://192.168.1.20:47891", forKey: XiaokPreferenceKeys.gatewayURL)
        let store = XiaokAppStore(
            userDefaults: defaults,
            makeClient: { url in
                URLRecordingMobileGatewayClient(baseURL: url)
            }
        )

        XCTAssertFalse(store.applyPairingURL(URL(string: "xiaok://mobile/pair?gateway=http%3A%2F%2F127.0.0.1%3A47891&desktopId=desktop-loopback&token=token-loopback")!))

        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.20:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL), "http://192.168.1.20:47891")
        XCTAssertNil(defaults.string(forKey: XiaokPreferenceKeys.desktopId))
        XCTAssertNil(defaults.string(forKey: XiaokPreferenceKeys.accessToken))
    }

    func testSnapshotDecodesBoundedDesktopState() throws {
        let json = """
        {
          "desktopName": "Xiaok Desktop",
          "health": "online",
          "lastSyncSequence": 42,
          "runningTurn": {
            "id": "turn-1",
            "title": "整理日报",
            "status": "running"
          },
          "messages": [
            {
              "id": "msg-1",
              "role": "assistant",
              "text": "hello from desktop",
              "createdAt": "2026-06-28T10:00:00Z"
            }
          ],
          "projects": [],
          "approvals": [],
          "loops": [],
          "artifacts": []
        }
        """.data(using: .utf8)!

        let snapshot = try JSONDecoder.xiaokMobile.decode(MobileSnapshot.self, from: json)

        XCTAssertEqual(snapshot.desktopName, "Xiaok Desktop")
        XCTAssertEqual(snapshot.health, .online)
        XCTAssertEqual(snapshot.lastSyncSequence, 42)
        XCTAssertEqual(snapshot.runningTurn?.status, .running)
        XCTAssertEqual(snapshot.messages.map(\.text), ["hello from desktop"])
        XCTAssertEqual(snapshot.conversations.map(\.id), ["default"])
        XCTAssertEqual(snapshot.conversations.first?.messageCount, 1)
    }

    func testSnapshotDecodesJavaScriptISOStringFractionalSeconds() throws {
        let json = """
        {
          "desktopName": "Xiaok Desktop",
          "health": "online",
          "lastSyncSequence": 42,
          "runningTurn": null,
          "messages": [
            {
              "id": "msg-1",
              "role": "assistant",
              "text": "relay smoke ready",
              "createdAt": "2026-06-28T10:00:00.123Z"
            }
          ],
          "projects": [],
          "approvals": [],
          "loops": [],
          "artifacts": []
        }
        """.data(using: .utf8)!

        let snapshot = try JSONDecoder.xiaokMobile.decode(MobileSnapshot.self, from: json)

        XCTAssertEqual(snapshot.messages.first?.text, "relay smoke ready")
    }

    func testDesktopHelloDecodesReachableLANURLs() throws {
        let json = """
        {
          "desktopId": "desktop-test",
          "desktopName": "Xiaok Desktop",
          "protocol": "mobile-v1",
          "health": "online",
          "reachableURLs": ["http://192.168.1.20:47891"]
        }
        """.data(using: .utf8)!

        let hello = try JSONDecoder.xiaokMobile.decode(DesktopHello.self, from: json)

        XCTAssertEqual(hello.desktopId, "desktop-test")
        XCTAssertEqual(hello.desktopName, "Xiaok Desktop")
        XCTAssertEqual(hello.protocolVersion, "mobile-v1")
        XCTAssertEqual(hello.health, .online)
        XCTAssertEqual(hello.reachableURLs, [URL(string: "http://192.168.1.20:47891")!])
    }

    func testMobileRelaySignerMatchesDesktopCanonicalHMACVector() {
        let payload = MobileRelaySigner.signRequestPayload(
            [
                "kind": "mobile.request",
                "requestId": "req-1",
                "desktopId": "desktop-test",
                "mobileNodeId": "mob1",
                "sentAt": "2026-06-28T00:00:00.000Z",
                "route": "snapshot",
                "body": [:] as [String: Any]
            ],
            accessToken: "mobile-token-secret"
        )

        XCTAssertEqual(MobileRelaySigner.deriveRoomId(secret: "room-secret"), "67c43a8d654bcee1b8933c7f4cc790a6")
        XCTAssertEqual(payload["signature"] as? String, "37CNLtJrlEnM7v2wmGyLmu0PyqhzRrciw3PcG81drHY")
        XCTAssertFalse(String(describing: payload).contains("mobile-token-secret"))
        XCTAssertTrue(MobileRelaySigner.verifyPayload(payload, accessToken: "mobile-token-secret"))
        XCTAssertFalse(MobileRelaySigner.verifyPayload(payload, accessToken: "wrong-token"))
    }

    func testSnapshotDecodesDesktopCoreSummaries() throws {
        let json = """
        {
          "desktopName": "Xiaok Desktop",
          "health": "online",
          "lastSyncSequence": 7,
          "runningTurn": null,
          "messages": [],
          "projects": [
            {
              "id": "project-mobile",
              "name": "Launch desktop gateway",
              "goal": "Keep mobile work view aligned with desktop",
              "requirements": "Show project status, goal, summary, task counts, and artifacts.",
              "summary": "Project artifacts are ready for review.",
              "status": "active",
              "progress": 0.42,
              "activeTasks": 3,
              "taskCount": 7,
              "doneCount": 4,
              "stoppedCount": 1,
              "artifactCount": 2,
              "updatedAt": "2026-06-28T10:01:00Z"
            }
          ],
          "approvals": [
            {
              "id": "approval-build",
              "title": "Allow Codex to run build",
              "detail": "xcodebuild test on Simulator",
              "risk": "medium",
              "status": "pending",
              "createdAt": "2026-06-28T10:02:00Z"
            }
          ],
          "loops": [
            {
              "id": "loop-daily",
              "name": "Daily report loop",
              "status": "scheduled",
              "lastRunStatus": "success",
              "nextRunSummary": "Tomorrow 09:00"
            }
          ],
          "artifacts": [
            {
              "id": "artifact-design",
              "name": "mobile-sync-design.md",
              "kind": "markdown",
              "source": "project-mobile",
              "status": "ready"
            }
          ]
        }
        """.data(using: .utf8)!

        let snapshot = try JSONDecoder.xiaokMobile.decode(MobileSnapshot.self, from: json)

        XCTAssertEqual(snapshot.projects.map(\.name), ["Launch desktop gateway"])
        XCTAssertEqual(snapshot.projects.first?.status, .active)
        XCTAssertEqual(snapshot.projects.first?.activeTasks, 3)
        let projectFields = Dictionary(uniqueKeysWithValues: Mirror(reflecting: try XCTUnwrap(snapshot.projects.first)).children.compactMap { child -> (String, Any)? in
            guard let label = child.label else {
                return nil
            }
            return (label, child.value)
        })
        XCTAssertEqual(projectFields["goal"] as? String, "Keep mobile work view aligned with desktop")
        XCTAssertEqual(projectFields["requirements"] as? String, "Show project status, goal, summary, task counts, and artifacts.")
        XCTAssertEqual(projectFields["summary"] as? String, "Project artifacts are ready for review.")
        XCTAssertEqual(projectFields["taskCount"] as? Int, 7)
        XCTAssertEqual(projectFields["doneCount"] as? Int, 4)
        XCTAssertEqual(projectFields["stoppedCount"] as? Int, 1)
        XCTAssertEqual(projectFields["artifactCount"] as? Int, 2)
        XCTAssertEqual(snapshot.approvals.first?.title, "Allow Codex to run build")
        XCTAssertEqual(snapshot.approvals.first?.status, .pending)
        XCTAssertEqual(snapshot.loops.first?.name, "Daily report loop")
        XCTAssertEqual(snapshot.loops.first?.lastRunStatus, .success)
        XCTAssertEqual(snapshot.artifacts.first?.name, "mobile-sync-design.md")
        XCTAssertEqual(snapshot.artifacts.first?.kind, .markdown)
    }

    @MainActor
    func testStoreHydratesCachedSnapshotAndPagesLongLists() throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let cachedSnapshot = MobileSnapshot(
            desktopName: "Cached Desktop",
            health: .online,
            lastSyncSequence: 12,
            runningTurn: nil,
            messages: (1...25).map { index in
                ChatMessage(
                    id: "msg-\(index)",
                    conversationId: "conversation-1",
                    role: .assistant,
                    text: "message \(index)",
                    createdAt: Date(timeIntervalSince1970: TimeInterval(index)),
                    deliveryStatus: .sent
                )
            },
            conversations: (1...14).map { index in
                ConversationSummary(
                    id: "conversation-\(index)",
                    title: "Conversation \(index)",
                    status: .completed,
                    lastMessagePreview: "message \(index)",
                    updatedAt: Date(timeIntervalSince1970: TimeInterval(index)),
                    messageCount: index
                )
            },
            projects: (1...18).map { index in
                DesktopProjectSummary(
                    id: "project-\(index)",
                    name: "Project \(index)",
                    status: .active,
                    progress: 0.1,
                    activeTasks: 1,
                    updatedAt: Date(timeIntervalSince1970: TimeInterval(index))
                )
            },
            approvals: [],
            loops: [],
            artifacts: []
        )
        defaults.set(try JSONEncoder.xiaokMobile.encode(cachedSnapshot), forKey: XiaokPreferenceKeys.snapshotCache)

        let store = XiaokAppStore(client: OfflineMobileGatewayClient(), userDefaults: defaults)

        XCTAssertEqual(store.desktopName, "Cached Desktop")
        XCTAssertEqual(store.conversations.count, 14)
        XCTAssertEqual(store.visibleConversations.count, 10)
        XCTAssertEqual(store.visibleProjects.count, 10)
        XCTAssertEqual(store.visibleMessages(for: "conversation-1").count, 20)

        store.showMoreConversations()
        store.showMoreProjects()
        store.showMoreMessages(for: "conversation-1")

        XCTAssertEqual(store.visibleConversations.count, 14)
        XCTAssertEqual(store.visibleProjects.count, 18)
        XCTAssertEqual(store.visibleMessages(for: "conversation-1").count, 25)
    }

    func testMessageContentParserKeepsMarkdownTogetherAndExtractsMermaidFence() {
        let parts = MessageContentParser.parse("""
        ## Mobile ready

        - LAN first
        - Relay fallback

        ```mermaid
        graph TD
        Phone[Phone] --> Desktop[Desktop]
        ```

        Done.
        """)

        XCTAssertEqual(parts, [
            MessageContentPart(kind: .markdown, text: "## Mobile ready\n\n- LAN first\n- Relay fallback"),
            MessageContentPart(kind: .mermaid, text: "graph TD\nPhone[Phone] --> Desktop[Desktop]"),
            MessageContentPart(kind: .markdown, text: "Done.")
        ])
    }

    func testMermaidFlowchartParserBuildsRenderableNodesAndEdges() throws {
        let diagram = try XCTUnwrap(MermaidDiagramParser.parse("""
        flowchart LR
        Phone[Phone] --> Desktop[Desktop]
        Desktop --> Artifact[Artifact preview]
        """))

        XCTAssertEqual(diagram.direction, .leftToRight)
        XCTAssertEqual(diagram.nodes.map(\.label), ["Phone", "Desktop", "Artifact preview"])
        XCTAssertEqual(diagram.edges.map { [$0.from.label, $0.to.label] }, [
            ["Phone", "Desktop"],
            ["Desktop", "Artifact preview"]
        ])
    }

    func testMarkdownInlineParserExtractsTappableLinks() throws {
        let segments = MarkdownInlineParser.parse("Open [Xiaok Desktop](https://example.com/xiaok).")

        XCTAssertEqual(segments, [
            MarkdownInlineSegment(kind: .text, text: "Open "),
            MarkdownInlineSegment(kind: .link(URL(string: "https://example.com/xiaok")!), text: "Xiaok Desktop"),
            MarkdownInlineSegment(kind: .text, text: ".")
        ])
    }

    @MainActor
    func testStoreLoadsSnapshotAndReducesChatEvents() async throws {
        let client = MockMobileGatewayClient()
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(client: client, userDefaults: defaults)

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.desktopName, "Xiaok Desktop")
        XCTAssertEqual(store.health, .online)
        XCTAssertEqual(store.messages.count, 3)
        XCTAssertEqual(store.conversations.first?.title, "Mobile ready")
        XCTAssertEqual(store.conversations.first?.messageCount, 3)

        await store.sendMessage("ping")

        XCTAssertEqual(store.messages.suffix(2).map(\.text), ["ping", "pong from desktop"])
        XCTAssertFalse(store.isSending)
        XCTAssertNil(store.errorMessage)
        XCTAssertEqual(store.selectedConversationId, "mock-turn")
    }

    @MainActor
    func testStoreFetchesArtifactPreviewFromCurrentConnection() async throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(client: MockMobileGatewayClient(), userDefaults: defaults)

        await store.loadInitialSnapshot()
        let preview = try await store.fetchArtifactPreview(id: "artifact-mobile-output")

        XCTAssertEqual(preview.artifact.name, "mobile-output.md")
        XCTAssertEqual(preview.contentType, "text/markdown")
        XCTAssertTrue(preview.text?.contains("Mock artifact preview") == true)
    }

    @MainActor
    func testStoreShowsPendingConversationImmediatelyAndReplacesItAfterSendCompletes() async throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let client = SuspendedSendMobileGatewayClient()
        let store = XiaokAppStore(client: client, userDefaults: defaults)
        await store.loadInitialSnapshot()

        let sendStarted = expectation(description: "send started")
        client.onSendStarted = {
            sendStarted.fulfill()
        }

        let task = Task {
            await store.sendMessage("slow message")
        }
        await fulfillment(of: [sendStarted], timeout: 1)

        XCTAssertTrue(store.isSending)
        XCTAssertEqual(store.selectedConversation?.title, "slow message")
        XCTAssertEqual(store.visibleMessages(for: store.selectedConversationId ?? "").last?.deliveryStatus, .sending)

        client.finishSend()
        await task.value

        XCTAssertFalse(store.isSending)
        XCTAssertFalse(store.messages.contains { $0.deliveryStatus == .sending })
        XCTAssertEqual(store.messages.last?.conversationId, "task-slow-message")
        XCTAssertEqual(store.messages.last?.deliveryStatus, .sent)
    }

    @MainActor
    func testStoreRespondsToApprovalWithoutMutatingOtherDesktopState() async throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(client: MockMobileGatewayClient(), userDefaults: defaults)

        await store.loadInitialSnapshot()
        let initialMessageTexts = store.messages.map(\.text)

        await store.respondToApproval(id: "approval-build", decision: .approve)

        XCTAssertEqual(store.approvals.first(where: { $0.id == "approval-build" })?.status, .approved)
        XCTAssertEqual(store.approvals.first(where: { $0.id == "approval-terminal" })?.status, .pending)
        XCTAssertEqual(store.messages.map(\.text), initialMessageTexts)
        XCTAssertNil(store.errorMessage)
    }

    @MainActor
    func testSnapshotRequiredMarksStoreStaleWithoutGuessingState() async throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(client: MockMobileGatewayClient(), userDefaults: defaults)

        await store.loadInitialSnapshot()
        store.apply(.snapshotRequired(sequence: 99))

        XCTAssertTrue(store.requiresSnapshotRefresh)
        XCTAssertEqual(store.lastSyncSequence, 1)
        XCTAssertEqual(store.desktopName, "Xiaok Desktop")
    }

    @MainActor
    func testStoreRefreshesSnapshotAfterSendRequiresDesktopStateReload() async throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            client: SnapshotRefreshMobileGatewayClient(),
            userDefaults: defaults
        )

        await store.loadInitialSnapshot()
        await store.sendMessage("create a report")

        XCTAssertFalse(store.requiresSnapshotRefresh)
        XCTAssertEqual(store.projects.map(\.name), ["Mobile-created desktop task"])
        XCTAssertEqual(store.artifacts.map(\.name), ["mobile-output.md"])
    }

    @MainActor
    func testStoreFollowsUpSnapshotRefreshAfterDesktopCompletesLater() async throws {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            client: DelayedCompletionSnapshotMobileGatewayClient(),
            userDefaults: defaults,
            followUpSnapshotRefreshDelaysNanoseconds: [50_000_000]
        )

        await store.loadInitialSnapshot()
        await store.sendMessage("delayed completion")

        XCTAssertEqual(store.selectedConversation?.status, .running)

        try await Task.sleep(nanoseconds: 120_000_000)

        XCTAssertEqual(store.selectedConversation?.status, .completed)
        XCTAssertFalse(store.requiresSnapshotRefresh)
    }

    @MainActor
    func testStoreDoesNotAutoconnectFromBonjourWithoutAccessToken() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        let store = XiaokAppStore(
            userDefaults: defaults,
            desktopDiscovery: StaticDesktopDiscovery(urls: [URL(string: "http://192.168.1.20:47891")!]),
            makeClient: { url in
                DesktopResolvingMobileGatewayClient(baseURL: url)
            }
        )

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.gatewayURLString, "")
        XCTAssertNil(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL))
        XCTAssertEqual(store.health, .offline)
    }

    @MainActor
    func testStoreFallsBackToMatchingBonjourCandidateAndRejectsMismatchedDesktop() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        defaults.set("token-test", forKey: XiaokPreferenceKeys.accessToken)
        defaults.set("desktop-good", forKey: XiaokPreferenceKeys.desktopId)
        defaults.set("http://192.168.1.10:47891", forKey: XiaokPreferenceKeys.gatewayURL)

        let store = XiaokAppStore(
            userDefaults: defaults,
            desktopDiscovery: StaticDesktopDiscovery(urls: [
                URL(string: "http://192.168.1.11:47891")!,
                URL(string: "http://192.168.1.20:47891")!
            ]),
            makeClient: { url in
                DesktopResolvingMobileGatewayClient(baseURL: url)
            }
        )

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.20:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.gatewayURL), "http://192.168.1.20:47891")
        XCTAssertEqual(defaults.string(forKey: XiaokPreferenceKeys.desktopId), "desktop-good")
        XCTAssertEqual(store.desktopName, "Desktop at 192.168.1.20")
        XCTAssertEqual(store.health, .online)
        XCTAssertEqual(store.connectionRoute, .lan)
    }

    @MainActor
    func testStoreFallsBackToRelayWhenLANAndBonjourAreUnavailable() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        defaults.set("token-test", forKey: XiaokPreferenceKeys.accessToken)
        defaults.set("desktop-good", forKey: XiaokPreferenceKeys.desktopId)
        defaults.set("http://192.168.1.10:47891", forKey: XiaokPreferenceKeys.gatewayURL)

        let store = XiaokAppStore(
            userDefaults: defaults,
            desktopDiscovery: StaticDesktopDiscovery(urls: []),
            relayClient: RelaySnapshotMobileGatewayClient(desktopId: "desktop-good"),
            makeClient: { url in
                DesktopResolvingMobileGatewayClient(baseURL: url)
            }
        )

        await store.loadInitialSnapshot()

        XCTAssertEqual(store.connectionRoute, .relay)
        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.10:47891")
        XCTAssertEqual(store.desktopName, "Relay Desktop")
        XCTAssertEqual(store.health, .online)
    }

    @MainActor
    func testStoreReturnsToLANAfterNetworkChangeWhenBonjourFindsTheDesktop() async {
        let defaults = UserDefaults(suiteName: "XiaokMobileModelTests-\(UUID().uuidString)")!
        defaults.set("token-test", forKey: XiaokPreferenceKeys.accessToken)
        defaults.set("desktop-good", forKey: XiaokPreferenceKeys.desktopId)
        defaults.set("http://192.168.1.10:47891", forKey: XiaokPreferenceKeys.gatewayURL)
        let discovery = MutableDesktopDiscovery(urls: [])
        let networkMonitor = ManualNetworkMonitor()

        let store = XiaokAppStore(
            userDefaults: defaults,
            desktopDiscovery: discovery,
            relayClient: RelaySnapshotMobileGatewayClient(desktopId: "desktop-good"),
            networkMonitor: networkMonitor,
            makeClient: { url in
                DesktopResolvingMobileGatewayClient(baseURL: url)
            }
        )

        await store.loadInitialSnapshot()
        XCTAssertEqual(store.connectionRoute, .relay)

        discovery.urls = [URL(string: "http://192.168.1.20:47891")!]
        await networkMonitor.triggerAndWait()

        XCTAssertEqual(store.connectionRoute, .lan)
        XCTAssertEqual(store.gatewayURLString, "http://192.168.1.20:47891")
        XCTAssertEqual(store.desktopName, "Desktop at 192.168.1.20")
    }
}

private struct URLRecordingMobileGatewayClient: MobileGatewayClient {
    let baseURL: URL

    func fetchHello() async throws -> DesktopHello {
        DesktopHello(
            desktopId: "desktop-\(baseURL.host ?? "unknown")",
            desktopName: "Desktop at \(baseURL.host ?? "unknown")",
            protocolVersion: "mobile-v1",
            health: .online,
            reachableURLs: [baseURL]
        )
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        MobileSnapshot(
            desktopName: "Desktop at \(baseURL.host ?? "unknown")",
            health: .online,
            lastSyncSequence: 1,
            runningTurn: nil,
            messages: [],
            projects: [],
            approvals: [],
            loops: [],
            artifacts: []
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        []
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.unsupportedURL)
    }
}

private struct StaticDesktopDiscovery: DesktopDiscovery {
    let urls: [URL]

    func discoverDesktopGatewayURLs(timeout: TimeInterval) async -> [URL] {
        urls
    }
}

private final class MutableDesktopDiscovery: DesktopDiscovery {
    var urls: [URL]

    init(urls: [URL]) {
        self.urls = urls
    }

    func discoverDesktopGatewayURLs(timeout: TimeInterval) async -> [URL] {
        urls
    }
}

private final class ManualNetworkMonitor: MobileNetworkMonitor {
    private var onChange: (@Sendable () -> Void)?

    func start(onChange: @escaping @Sendable () -> Void) {
        self.onChange = onChange
    }

    func cancel() {
        onChange = nil
    }

    func triggerAndWait() async {
        onChange?()
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
}

private struct RelaySnapshotMobileGatewayClient: MobileGatewayClient {
    let desktopId: String

    func fetchHello() async throws -> DesktopHello {
        DesktopHello(
            desktopId: desktopId,
            desktopName: "Relay Desktop",
            protocolVersion: "mobile-v1",
            health: .online,
            reachableURLs: []
        )
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        MobileSnapshot(
            desktopName: "Relay Desktop",
            health: .online,
            lastSyncSequence: 30,
            runningTurn: nil,
            messages: [],
            projects: [],
            approvals: [],
            loops: [],
            artifacts: []
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        []
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.unsupportedURL)
    }
}

private struct DesktopResolvingMobileGatewayClient: MobileGatewayClient {
    let baseURL: URL

    func fetchHello() async throws -> DesktopHello {
        switch baseURL.host {
        case "192.168.1.10":
            throw URLError(.cannotConnectToHost)
        case "192.168.1.11":
            return DesktopHello(
                desktopId: "desktop-bad",
                desktopName: "Wrong Desktop",
                protocolVersion: "mobile-v1",
                health: .online,
                reachableURLs: [baseURL]
            )
        case "192.168.1.20":
            return DesktopHello(
                desktopId: "desktop-good",
                desktopName: "Good Desktop",
                protocolVersion: "mobile-v1",
                health: .online,
                reachableURLs: [baseURL]
            )
        default:
            throw URLError(.cannotFindHost)
        }
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        guard baseURL.host == "192.168.1.20" else {
            throw URLError(.cannotConnectToHost)
        }
        return MobileSnapshot(
            desktopName: "Desktop at 192.168.1.20",
            health: .online,
            lastSyncSequence: 20,
            runningTurn: nil,
            messages: [],
            projects: [],
            approvals: [],
            loops: [],
            artifacts: []
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        []
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.unsupportedURL)
    }
}

private actor SnapshotRefreshMobileGatewayClient: MobileGatewayClient {
    private var didSend = false
    private let date = Date(timeIntervalSince1970: 1_782_580_800)

    func fetchHello() async throws -> DesktopHello {
        DesktopHello(
            desktopId: "desktop-refresh",
            desktopName: "Refresh Desktop",
            protocolVersion: "mobile-v1",
            health: .online,
            reachableURLs: [URL(string: "http://192.168.1.30:47891")!]
        )
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        MobileSnapshot(
            desktopName: "Refresh Desktop",
            health: .online,
            lastSyncSequence: didSend ? 8 : 1,
            runningTurn: nil,
            messages: [],
            projects: didSend ? [
                DesktopProjectSummary(
                    id: "task-mobile-created",
                    name: "Mobile-created desktop task",
                    status: .active,
                    progress: 0.5,
                    activeTasks: 1,
                    updatedAt: date
                )
            ] : [],
            approvals: [],
            loops: [],
            artifacts: didSend ? [
                DesktopArtifactSummary(
                    id: "artifact-mobile-output",
                    name: "mobile-output.md",
                    kind: .markdown,
                    source: "task-mobile-created",
                    status: .ready
                )
            ] : []
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        didSend = true
        return [.snapshotRequired(sequence: 2)]
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.unsupportedURL)
    }
}

private actor DelayedCompletionSnapshotMobileGatewayClient: MobileGatewayClient {
    private var didSend = false
    private var snapshotCount = 0
    private let date = Date(timeIntervalSince1970: 1_782_580_800)

    func fetchHello() async throws -> DesktopHello {
        DesktopHello(
            desktopId: "desktop-delayed-completion",
            desktopName: "Delayed Completion Desktop",
            protocolVersion: "mobile-v1",
            health: .online,
            reachableURLs: []
        )
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        snapshotCount += 1
        let isCompleted = didSend && snapshotCount >= 3
        return MobileSnapshot(
            desktopName: "Delayed Completion Desktop",
            health: .online,
            lastSyncSequence: snapshotCount,
            runningTurn: isCompleted || !didSend ? nil : RunningTurn(
                id: "task-delayed-completion",
                title: "delayed completion",
                status: .running
            ),
            messages: didSend ? [
                ChatMessage(
                    id: "msg-delayed-completion",
                    conversationId: "task-delayed-completion",
                    role: .user,
                    text: "delayed completion",
                    createdAt: date,
                    deliveryStatus: .sent
                )
            ] : [],
            conversations: didSend ? [
                ConversationSummary(
                    id: "task-delayed-completion",
                    title: "delayed completion",
                    status: isCompleted ? .completed : .running,
                    lastMessagePreview: "delayed completion",
                    updatedAt: date,
                    messageCount: isCompleted ? 2 : 1
                )
            ] : [],
            projects: [],
            approvals: [],
            loops: [],
            artifacts: []
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        didSend = true
        return [.snapshotRequired(sequence: 2)]
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.unsupportedURL)
    }
}

private final class SuspendedSendMobileGatewayClient: MobileGatewayClient {
    var onSendStarted: (() -> Void)?
    private var continuation: CheckedContinuation<Void, Never>?
    private let date = Date(timeIntervalSince1970: 1_782_580_800)

    func fetchHello() async throws -> DesktopHello {
        DesktopHello(
            desktopId: "desktop-suspended",
            desktopName: "Suspended Desktop",
            protocolVersion: "mobile-v1",
            health: .online,
            reachableURLs: []
        )
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        MobileSnapshot(
            desktopName: "Suspended Desktop",
            health: .online,
            lastSyncSequence: 1,
            runningTurn: nil,
            messages: [],
            projects: [],
            approvals: [],
            loops: [],
            artifacts: []
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        await MainActor.run {
            onSendStarted?()
        }
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
        return [
            .chatMessageAppended(
                message: ChatMessage(
                    id: "msg-slow-message",
                    conversationId: "task-slow-message",
                    role: .user,
                    text: text,
                    createdAt: date,
                    deliveryStatus: .sent
                ),
                sequence: 2
            ),
            .turnStarted(
                turn: RunningTurn(
                    id: "task-slow-message",
                    title: text,
                    status: .running
                ),
                sequence: 3
            )
        ]
    }

    func finishSend() {
        continuation?.resume()
        continuation = nil
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.unsupportedURL)
    }
}
