import Foundation
import CryptoKit

protocol MobileGatewayClient {
    func fetchHello() async throws -> DesktopHello
    func fetchSnapshot() async throws -> MobileSnapshot
    func sendMessage(_ text: String) async throws -> [MobileEvent]
    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest
    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview
}

extension MobileGatewayClient {
    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview {
        throw URLError(.unsupportedURL)
    }
}

struct MockMobileGatewayClient: MobileGatewayClient {
    private let baseDate = Date(timeIntervalSince1970: 1_782_580_800)

    func fetchHello() async throws -> DesktopHello {
        DesktopHello(
            desktopId: "desktop-mock",
            desktopName: "Xiaok Desktop",
            protocolVersion: "mobile-v1",
            health: .online,
            reachableURLs: [URL(string: "http://192.168.1.20:47891")!]
        )
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        MobileSnapshot(
            desktopName: "Xiaok Desktop",
            health: .online,
            lastSyncSequence: 1,
            runningTurn: nil,
            messages: [
                ChatMessage(
                    id: "mock-user-ready",
                    conversationId: "mock-ready",
                    role: .user,
                    text: "prepare mobile ready summary",
                    createdAt: baseDate.addingTimeInterval(-120),
                    deliveryStatus: .sent
                ),
                ChatMessage(
                    id: "mock-progress-ready",
                    conversationId: "mock-ready",
                    role: .assistant,
                    text: "## Mobile ready\n\n```mermaid\ngraph TD\nPhone[Phone app] --> Desktop[Mac desktop]\nDesktop --> Artifact[Artifact viewer]\n```",
                    createdAt: baseDate.addingTimeInterval(-60),
                    deliveryStatus: .sent
                ),
                ChatMessage(
                    id: "mock-assistant-ready",
                    conversationId: "mock-ready",
                    role: .assistant,
                    text: "mobile ready\n\nGenerated `mobile-output.md`.\n\nOpen [Xiaok Desktop](https://example.com/xiaok).",
                    createdAt: baseDate,
                    deliveryStatus: .sent
                )
            ],
            conversations: [
                ConversationSummary(
                    id: "mock-ready",
                    title: "Mobile ready",
                    status: .completed,
                    lastMessagePreview: "mobile ready",
                    updatedAt: baseDate,
                    messageCount: 3
                )
            ],
            projects: [
                DesktopProjectSummary(
                    id: "project-gateway",
                    name: "Launch desktop gateway",
                    goal: "Keep mobile work view aligned with desktop",
                    requirements: "Show project status, goal, summary, task counts, and artifacts.",
                    summary: "Project artifacts are ready for review.",
                    status: .active,
                    progress: 0.42,
                    activeTasks: 3,
                    taskCount: 7,
                    doneCount: 4,
                    stoppedCount: 1,
                    artifactCount: 2,
                    updatedAt: baseDate.addingTimeInterval(60)
                ),
                DesktopProjectSummary(
                    id: "project-mobile-sync",
                    name: "Design mobile sync",
                    goal: "Keep mobile task messages and previews in sync",
                    status: .active,
                    progress: 0.68,
                    activeTasks: 2,
                    taskCount: 4,
                    doneCount: 2,
                    stoppedCount: 0,
                    artifactCount: 1,
                    updatedAt: baseDate.addingTimeInterval(120)
                )
            ],
            approvals: [
                ApprovalRequest(
                    id: "approval-build",
                    title: "Allow Codex to run build",
                    detail: "xcodebuild test on Simulator",
                    risk: .medium,
                    status: .pending,
                    createdAt: baseDate.addingTimeInterval(180)
                ),
                ApprovalRequest(
                    id: "approval-terminal",
                    title: "Allow terminal command",
                    detail: "Read-only project inspection",
                    risk: .low,
                    status: .pending,
                    createdAt: baseDate.addingTimeInterval(240)
                )
            ],
            loops: [
                LoopSummary(
                    id: "loop-daily",
                    name: "Daily report loop",
                    status: .scheduled,
                    lastRunStatus: .success,
                    nextRunSummary: "Tomorrow 09:00"
                ),
                LoopSummary(
                    id: "loop-release",
                    name: "Release sentinel loop",
                    status: .running,
                    lastRunStatus: .running,
                    nextRunSummary: "Watching current build"
                )
            ],
            artifacts: [
                DesktopArtifactSummary(
                    id: "artifact-mobile-output",
                    name: "mobile-output.md",
                    kind: .markdown,
                    source: "mock-ready",
                    status: .ready,
                    previewAvailable: true,
                    mimeType: "text/markdown",
                    sizeBytes: 38
                ),
                DesktopArtifactSummary(
                    id: "artifact-report",
                    name: "report-preview.pdf",
                    kind: .pdf,
                    source: "project-gateway",
                    status: .ready
                ),
                DesktopArtifactSummary(
                    id: "artifact-gateway-runbook",
                    name: "gateway-runbook.md",
                    kind: .markdown,
                    source: "project-gateway",
                    status: .ready,
                    previewAvailable: true,
                    mimeType: "text/markdown",
                    sizeBytes: 72
                )
            ]
        )
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        let conversationId = "mock-turn"
        let userMessage = ChatMessage(
            id: "mock-user-\(text.hashValue)",
            conversationId: conversationId,
            role: .user,
            text: text,
            createdAt: baseDate.addingTimeInterval(1),
            deliveryStatus: .sent
        )
        let turn = RunningTurn(id: conversationId, title: "Mobile task", status: .running)
        let assistantMessage = ChatMessage(
            id: "mock-assistant-pong",
            conversationId: conversationId,
            role: .assistant,
            text: text.lowercased() == "ping" ? "pong from desktop" : "desktop received: \(text)",
            createdAt: baseDate.addingTimeInterval(2),
            deliveryStatus: .sent
        )

        return [
            .chatMessageAppended(message: userMessage, sequence: 2),
            .turnStarted(turn: turn, sequence: 3),
            .chatMessageAppended(message: assistantMessage, sequence: 4),
            .turnFinished(turnId: turn.id, sequence: 5)
        ]
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        let snapshot = try await fetchSnapshot()
        guard let approval = snapshot.approvals.first(where: { $0.id == id }) else {
            throw URLError(.resourceUnavailable)
        }

        return ApprovalRequest(
            id: approval.id,
            title: approval.title,
            detail: approval.detail,
            risk: approval.risk,
            status: decision.resolvedStatus,
            createdAt: approval.createdAt
        )
    }

    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview {
        let snapshot = try await fetchSnapshot()
        guard let artifact = snapshot.artifacts.first(where: { $0.id == id }) else {
            throw URLError(.resourceUnavailable)
        }
        return ArtifactPreview(
            artifact: artifact,
            contentType: artifact.mimeType ?? "text/markdown",
            text: "# Mock artifact preview\n\n- mobile ready\n- artifact preview works"
        )
    }
}

struct OfflineMobileGatewayClient: MobileGatewayClient {
    func fetchHello() async throws -> DesktopHello {
        throw URLError(.cannotConnectToHost)
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        throw URLError(.cannotConnectToHost)
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        throw URLError(.cannotConnectToHost)
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        throw URLError(.cannotConnectToHost)
    }

    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview {
        throw URLError(.cannotConnectToHost)
    }
}

struct HTTPMobileGatewayClient: MobileGatewayClient {
    private struct ChatSendRequest: Encodable {
        let text: String
    }

    private struct ChatSendResponse: Decodable {
        let events: [MobileEvent]
    }

    private struct ApprovalRespondRequest: Encodable {
        let id: String
        let decision: ApprovalDecision
    }

    private struct ApprovalRespondResponse: Decodable {
        let approval: ApprovalRequest
    }

    let baseURL: URL
    var accessToken: String?
    var session: URLSession = .shared

    func fetchHello() async throws -> DesktopHello {
        let url = baseURL.appendingPathComponent("v0/mobile/hello")
        let request = request(url: url)
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try JSONDecoder.xiaokMobile.decode(DesktopHello.self, from: data)
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        let url = baseURL.appendingPathComponent("v0/mobile/snapshot")
        let request = request(url: url, authorized: true)
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try JSONDecoder.xiaokMobile.decode(MobileSnapshot.self, from: data)
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        let url = baseURL.appendingPathComponent("v0/mobile/actions/chat.send")
        var request = request(url: url, method: "POST", authorized: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.xiaokMobile.encode(ChatSendRequest(text: text))

        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try JSONDecoder.xiaokMobile.decode(ChatSendResponse.self, from: data).events
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        let url = baseURL.appendingPathComponent("v0/mobile/actions/approval.respond")
        var request = request(url: url, method: "POST", authorized: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.xiaokMobile.encode(ApprovalRespondRequest(id: id, decision: decision))

        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try JSONDecoder.xiaokMobile.decode(ApprovalRespondResponse.self, from: data).approval
    }

    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview {
        var url = baseURL
        url.appendPathComponent("v0")
        url.appendPathComponent("mobile")
        url.appendPathComponent("artifacts")
        url.appendPathComponent(id)
        url.appendPathComponent("preview")
        let request = request(url: url, authorized: true)
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try JSONDecoder.xiaokMobile.decode(ArtifactPreview.self, from: data)
    }

    private func request(url: URL, method: String = "GET", authorized: Bool = false) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("XiaokMobile/1", forHTTPHeaderField: "User-Agent")
        if authorized, let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func validate(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw URLError(.init(rawValue: httpResponse.statusCode))
        }
    }
}

struct MobileRelayConfiguration: Equatable {
    static let defaultRelayURLString = "wss://relay.kaihub.space/ws"

    let relayURL: URL
    let relayJWT: String
    let relayRoomSecret: String
    let desktopId: String
    let accessToken: String

    var roomId: String {
        MobileRelaySigner.deriveRoomId(secret: relayRoomSecret)
    }

    static func load(userDefaults: UserDefaults = .standard) -> MobileRelayConfiguration? {
        let environment = ProcessInfo.processInfo.environment
        let relayURLString = persistEnvironmentValue(
            environment["XIAOK_MOBILE_RELAY_URL"],
            key: XiaokPreferenceKeys.relayURL,
            userDefaults: userDefaults
        ) ?? userDefaults.string(forKey: XiaokPreferenceKeys.relayURL) ?? defaultRelayURLString

        guard let relayURL = normalizedRelayURL(from: relayURLString),
              let relayJWT = nonEmptyValue(
                persistEnvironmentValue(environment["XIAOK_MOBILE_RELAY_JWT"], key: XiaokPreferenceKeys.relayJWT, userDefaults: userDefaults)
                    ?? userDefaults.string(forKey: XiaokPreferenceKeys.relayJWT)
              ),
              let roomSecret = nonEmptyValue(
                persistEnvironmentValue(environment["XIAOK_MOBILE_RELAY_ROOM_SECRET"], key: XiaokPreferenceKeys.relayRoomSecret, userDefaults: userDefaults)
                    ?? userDefaults.string(forKey: XiaokPreferenceKeys.relayRoomSecret)
              ),
              let desktopId = nonEmptyValue(
                persistEnvironmentValue(environment["XIAOK_MOBILE_DESKTOP_ID"], key: XiaokPreferenceKeys.desktopId, userDefaults: userDefaults)
                    ?? userDefaults.string(forKey: XiaokPreferenceKeys.desktopId)
              ),
              let accessToken = nonEmptyValue(
                persistEnvironmentValue(environment["XIAOK_MOBILE_ACCESS_TOKEN"], key: XiaokPreferenceKeys.accessToken, userDefaults: userDefaults)
                    ?? userDefaults.string(forKey: XiaokPreferenceKeys.accessToken)
              ) else {
            return nil
        }

        userDefaults.set(relayURL.absoluteString, forKey: XiaokPreferenceKeys.relayURL)
        return MobileRelayConfiguration(
            relayURL: relayURL,
            relayJWT: relayJWT,
            relayRoomSecret: roomSecret,
            desktopId: desktopId,
            accessToken: accessToken
        )
    }

    private static func persistEnvironmentValue(_ value: String?, key: String, userDefaults: UserDefaults) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        userDefaults.set(trimmed, forKey: key)
        return trimmed
    }

    private static func nonEmptyValue(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    static func normalizedRelayURL(from rawValue: String) -> URL? {
        guard var components = URLComponents(string: rawValue),
              let scheme = components.scheme?.lowercased(),
              ["ws", "wss", "http", "https"].contains(scheme),
              components.host?.isEmpty == false else {
            return nil
        }

        if scheme == "http" {
            components.scheme = "ws"
        } else if scheme == "https" {
            components.scheme = "wss"
        }
        if components.path.isEmpty || components.path == "/" {
            components.path = "/ws"
        }
        return components.url
    }
}

final class RelayMobileGatewayClient: MobileGatewayClient {
    private struct ChatSendResponse: Decodable {
        let events: [MobileEvent]
    }

    private struct ApprovalRespondResponse: Decodable {
        let approval: ApprovalRequest
    }

    private let configuration: MobileRelayConfiguration
    private let session: URLSession

    init(configuration: MobileRelayConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func fetchHello() async throws -> DesktopHello {
        try await perform(route: "hello", body: [:], decoding: DesktopHello.self)
    }

    func fetchSnapshot() async throws -> MobileSnapshot {
        try await perform(route: "snapshot", body: [:], decoding: MobileSnapshot.self)
    }

    func sendMessage(_ text: String) async throws -> [MobileEvent] {
        let response = try await perform(
            route: "chat.send",
            body: ["text": text],
            decoding: ChatSendResponse.self
        )
        return response.events
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async throws -> ApprovalRequest {
        let response = try await perform(
            route: "approval.respond",
            body: ["id": id, "decision": decision.rawValue],
            decoding: ApprovalRespondResponse.self
        )
        return response.approval
    }

    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview {
        try await perform(
            route: "artifact.preview",
            body: ["id": id],
            decoding: ArtifactPreview.self
        )
    }

    private func perform<T: Decodable>(
        route: String,
        body: [String: Any],
        decoding type: T.Type
    ) async throws -> T {
        let requestId = UUID().uuidString
        let signedPayload = MobileRelaySigner.signRequestPayload(
            [
                "kind": "mobile.request",
                "requestId": requestId,
                "desktopId": configuration.desktopId,
                "mobileNodeId": "mob1",
                "sentAt": ISO8601DateFormatter().string(from: Date()),
                "route": route,
                "body": body
            ],
            accessToken: configuration.accessToken
        )

        var request = URLRequest(url: configuration.relayURL)
        request.setValue("Bearer \(configuration.relayJWT)", forHTTPHeaderField: "Authorization")
        request.setValue(configuration.roomId, forHTTPHeaderField: "X-Room-Id")
        request.setValue("xiaok-mobile-\(configuration.desktopId)", forHTTPHeaderField: "X-Broker-Id")
        request.setValue("mob1", forHTTPHeaderField: "X-Node-Id")
        request.setValue("1", forHTTPHeaderField: "X-Protocol-Version")

        let task = session.webSocketTask(with: request)
        task.resume()
        defer {
            task.cancel(with: .normalClosure, reason: nil)
        }

        let envelope = try JSONSerialization.data(withJSONObject: [
            "type": "relay:event",
            "payload": signedPayload
        ])
        guard let envelopeString = String(data: envelope, encoding: .utf8) else {
            throw URLError(.badServerResponse)
        }
        try await task.send(.string(envelopeString))

        let responsePayload = try await receiveResponsePayload(matching: requestId, task: task)
        guard let status = responsePayload["status"] as? Int else {
            throw URLError(.badServerResponse)
        }
        guard 200..<300 ~= status else {
            throw URLError(.init(rawValue: status))
        }
        guard let body = responsePayload["body"] as? [String: Any] else {
            throw URLError(.badServerResponse)
        }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        return try JSONDecoder.xiaokMobile.decode(T.self, from: bodyData)
    }

    private func receiveResponsePayload(
        matching requestId: String,
        task: URLSessionWebSocketTask
    ) async throws -> [String: Any] {
        while true {
            let message = try await task.receive()
            let data: Data
            switch message {
            case .string(let text):
                data = Data(text.utf8)
            case .data(let messageData):
                data = messageData
            @unknown default:
                continue
            }

            guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  envelope["type"] as? String == "relay:event",
                  let payload = envelope["payload"] as? [String: Any],
                  payload["kind"] as? String == "mobile.response",
                  payload["requestId"] as? String == requestId else {
                continue
            }

            guard MobileRelaySigner.verifyPayload(payload, accessToken: configuration.accessToken) else {
                throw URLError(.userAuthenticationRequired)
            }
            return payload
        }
    }
}

enum MobileRelaySigner {
    static func deriveRoomId(secret: String) -> String {
        let digest = SHA256.hash(data: Data(secret.utf8))
        return digest.map { String(format: "%02x", $0) }.joined().prefix(32).description
    }

    static func signRequestPayload(_ payload: [String: Any], accessToken: String) -> [String: Any] {
        var signed = payload
        signed["signature"] = signature(for: payload, accessToken: accessToken)
        return signed
    }

    static func verifyPayload(_ payload: [String: Any], accessToken: String) -> Bool {
        guard let signature = payload["signature"] as? String else {
            return false
        }
        var unsigned = payload
        unsigned.removeValue(forKey: "signature")
        return signature == self.signature(for: unsigned, accessToken: accessToken)
    }

    private static func signature(for payload: [String: Any], accessToken: String) -> String {
        let key = SymmetricKey(data: Data(accessToken.utf8))
        let data = Data(canonicalJSON(payload).utf8)
        let mac = HMAC<SHA256>.authenticationCode(for: data, using: key)
        return Data(mac).base64URLEncodedString()
    }

    private static func canonicalJSON(_ value: Any) -> String {
        if let dictionary = value as? [String: Any] {
            return "{"
                + dictionary.keys.sorted().map { key in
                    "\(jsonStringLiteral(key)):\(canonicalJSON(dictionary[key] as Any))"
                }.joined(separator: ",")
                + "}"
        }
        if let array = value as? [Any] {
            return "[\(array.map { canonicalJSON($0) }.joined(separator: ","))]"
        }
        if let string = value as? String {
            return jsonStringLiteral(string)
        }
        if let bool = value as? Bool {
            return bool ? "true" : "false"
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        if value is NSNull {
            return "null"
        }
        return "null"
    }

    private static func jsonStringLiteral(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value], options: [])
        let encodedArray = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(encodedArray.dropFirst().dropLast())
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
