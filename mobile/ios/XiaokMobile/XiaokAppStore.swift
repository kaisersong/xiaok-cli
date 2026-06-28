import Foundation

@MainActor
final class XiaokAppStore: ObservableObject {
    static let defaultGatewayURLString = ""

    @Published private(set) var desktopName = "Xiaok Desktop"
    @Published private(set) var health: DesktopHealth = .offline
    @Published private(set) var lastSyncSequence = 0
    @Published private(set) var runningTurn: RunningTurn?
    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var conversations: [ConversationSummary] = []
    @Published private(set) var projects: [DesktopProjectSummary] = []
    @Published private(set) var approvals: [ApprovalRequest] = []
    @Published private(set) var loops: [LoopSummary] = []
    @Published private(set) var artifacts: [DesktopArtifactSummary] = []
    @Published private(set) var requiresSnapshotRefresh = false
    @Published private(set) var isSending = false
    @Published private(set) var isLoadingSnapshot = false
    @Published private(set) var respondingApprovalIds: Set<String> = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var gatewayURLString: String
    @Published private(set) var language: AppLanguage
    @Published private(set) var desktopId: String?
    @Published private(set) var connectionRoute: MobileConnectionRoute = .none
    @Published private(set) var selectedConversationId: String?

    private var client: any MobileGatewayClient
    private let makeClient: (URL) -> any MobileGatewayClient
    private let userDefaults: UserDefaults
    private let desktopDiscovery: any DesktopDiscovery
    private var relayClient: (any MobileGatewayClient)?
    private let networkMonitor: any MobileNetworkMonitor
    private let usesFixedClient: Bool
    private var accessToken: String?
    private var visibleConversationLimit = 10
    private var visibleProjectLimit = 10
    private var visibleMessageLimitByConversation: [String: Int] = [:]
    private let followUpSnapshotRefreshDelaysNanoseconds: [UInt64]
    private var followUpSnapshotRefreshTask: Task<Void, Never>?

    init(
        client: any MobileGatewayClient,
        userDefaults: UserDefaults = .standard,
        desktopDiscovery: any DesktopDiscovery = NoopDesktopDiscovery(),
        relayClient: (any MobileGatewayClient)? = nil,
        networkMonitor: any MobileNetworkMonitor = NoopMobileNetworkMonitor(),
        followUpSnapshotRefreshDelaysNanoseconds: [UInt64] = [
            2_000_000_000,
            6_000_000_000,
            12_000_000_000,
            20_000_000_000
        ]
    ) {
        self.userDefaults = userDefaults
        self.gatewayURLString = Self.storedGatewayURLString(in: userDefaults)
        self.language = Self.storedLanguage(in: userDefaults)
        self.desktopId = Self.storedDesktopId(in: userDefaults)
        self.accessToken = Self.storedAccessToken(in: userDefaults)
        self.desktopDiscovery = desktopDiscovery
        self.relayClient = relayClient
        self.networkMonitor = networkMonitor
        self.usesFixedClient = true
        self.client = client
        self.makeClient = { _ in client }
        self.followUpSnapshotRefreshDelaysNanoseconds = followUpSnapshotRefreshDelaysNanoseconds
        applyCachedSnapshotIfPresent()
        startNetworkMonitor()
    }

    init(
        userDefaults: UserDefaults = .standard,
        desktopDiscovery: any DesktopDiscovery = NoopDesktopDiscovery(),
        relayClient: (any MobileGatewayClient)? = nil,
        networkMonitor: any MobileNetworkMonitor = NoopMobileNetworkMonitor(),
        followUpSnapshotRefreshDelaysNanoseconds: [UInt64] = [
            2_000_000_000,
            6_000_000_000,
            12_000_000_000,
            20_000_000_000
        ],
        makeClient: @escaping (URL) -> any MobileGatewayClient
    ) {
        let gatewayURLString = Self.storedGatewayURLString(in: userDefaults)
        self.userDefaults = userDefaults
        self.gatewayURLString = gatewayURLString
        self.language = Self.storedLanguage(in: userDefaults)
        self.desktopId = Self.storedDesktopId(in: userDefaults)
        self.accessToken = Self.storedAccessToken(in: userDefaults)
        self.desktopDiscovery = desktopDiscovery
        self.relayClient = relayClient
        self.networkMonitor = networkMonitor
        self.usesFixedClient = false
        self.makeClient = makeClient
        self.followUpSnapshotRefreshDelaysNanoseconds = followUpSnapshotRefreshDelaysNanoseconds
        if let gatewayURL = Self.validGatewayURL(from: gatewayURLString) {
            self.client = makeClient(gatewayURL)
        } else {
            self.client = OfflineMobileGatewayClient()
        }
        applyCachedSnapshotIfPresent()
        startNetworkMonitor()
    }

    var strings: AppStrings {
        AppStrings.resolve(language: language)
    }

    var isDesktopConnected: Bool {
        health == .online || health == .degraded
    }

    var selectedConversation: ConversationSummary? {
        guard let selectedConversationId else {
            return nil
        }
        return conversations.first { $0.id == selectedConversationId }
    }

    var visibleConversations: [ConversationSummary] {
        Array(conversations.prefix(visibleConversationLimit))
    }

    var visibleProjects: [DesktopProjectSummary] {
        Array(projects.prefix(visibleProjectLimit))
    }

    var hasMoreConversations: Bool {
        visibleConversationLimit < conversations.count
    }

    var hasMoreProjects: Bool {
        visibleProjectLimit < projects.count
    }

    func visibleMessages(for conversationId: String) -> [ChatMessage] {
        let filteredMessages = messages.filter { ($0.conversationId ?? "default") == conversationId }
        let limit = visibleMessageLimitByConversation[conversationId] ?? 20
        return Array(filteredMessages.suffix(limit))
    }

    func artifacts(for conversationId: String) -> [DesktopArtifactSummary] {
        artifacts.filter { artifact in
            artifact.source == conversationId
        }
    }

    func hasMoreMessages(for conversationId: String) -> Bool {
        let messageCount = messages.filter { ($0.conversationId ?? "default") == conversationId }.count
        return (visibleMessageLimitByConversation[conversationId] ?? 20) < messageCount
    }

    func showMoreConversations() {
        visibleConversationLimit = min(conversations.count, visibleConversationLimit + 10)
        objectWillChange.send()
    }

    func showMoreProjects() {
        visibleProjectLimit = min(projects.count, visibleProjectLimit + 10)
        objectWillChange.send()
    }

    func showMoreMessages(for conversationId: String) {
        let messageCount = messages.filter { ($0.conversationId ?? "default") == conversationId }.count
        visibleMessageLimitByConversation[conversationId] = min(messageCount, (visibleMessageLimitByConversation[conversationId] ?? 20) + 20)
        objectWillChange.send()
    }

    func selectConversation(_ conversationId: String) {
        selectedConversationId = conversationId
    }

    func fetchArtifactPreview(id: String) async throws -> ArtifactPreview {
        try await client.fetchArtifactPreview(id: id)
    }

    func updateLanguage(_ nextLanguage: AppLanguage) {
        language = nextLanguage
        userDefaults.set(nextLanguage.rawValue, forKey: XiaokPreferenceKeys.language)
    }

    @discardableResult
    func updateGatewayURL(_ rawValue: String) -> Bool {
        let normalizedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = Self.validGatewayURL(from: normalizedValue) else {
            errorMessage = strings.invalidGatewayURL
            return false
        }

        gatewayURLString = url.absoluteString
        userDefaults.set(gatewayURLString, forKey: XiaokPreferenceKeys.gatewayURL)
        client = makeClient(url)
        health = .offline
        connectionRoute = .none
        errorMessage = nil
        return true
    }

    @discardableResult
    func applyPairingURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "xiaok",
              url.host?.lowercased() == "mobile",
              url.path == "/pair",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            errorMessage = strings.invalidGatewayURL
            return false
        }

        let values = Dictionary(uniqueKeysWithValues: components.queryItems?.compactMap { item in
            item.value.map { (item.name, $0) }
        } ?? [])
        guard let pairedDesktopId = Self.nonEmpty(values["desktopId"]),
              let pairedToken = Self.nonEmpty(values["token"]) else {
            errorMessage = strings.invalidGatewayURL
            return false
        }

        let gatewayURL = Self.nonEmpty(values["gateway"]).flatMap(Self.validGatewayURL(from:))
        if Self.nonEmpty(values["gateway"]) != nil && gatewayURL == nil {
            errorMessage = strings.invalidGatewayURL
            return false
        }
        if let gatewayURL, Self.isLoopbackGatewayURL(gatewayURL) {
            errorMessage = strings.invalidGatewayURL
            return false
        }

        let relayURL = Self.nonEmpty(values["relayUrl"]).flatMap(MobileRelayConfiguration.normalizedRelayURL(from:))
        if Self.nonEmpty(values["relayUrl"]) != nil && relayURL == nil {
            errorMessage = strings.invalidGatewayURL
            return false
        }
        let relayJWT = Self.nonEmpty(values["relayJWT"]) ?? Self.nonEmpty(values["relayJwt"])
        let relayRoomSecret = Self.nonEmpty(values["relayRoomSecret"])

        desktopId = pairedDesktopId
        accessToken = pairedToken
        userDefaults.set(pairedDesktopId, forKey: XiaokPreferenceKeys.desktopId)
        userDefaults.set(pairedToken, forKey: XiaokPreferenceKeys.accessToken)

        if let gatewayURL {
            gatewayURLString = gatewayURL.absoluteString
            userDefaults.set(gatewayURLString, forKey: XiaokPreferenceKeys.gatewayURL)
            client = makeClient(gatewayURL)
        } else {
            gatewayURLString = Self.defaultGatewayURLString
            userDefaults.removeObject(forKey: XiaokPreferenceKeys.gatewayURL)
            client = OfflineMobileGatewayClient()
        }

        if let relayURL {
            userDefaults.set(relayURL.absoluteString, forKey: XiaokPreferenceKeys.relayURL)
        }
        if let relayJWT {
            userDefaults.set(relayJWT, forKey: XiaokPreferenceKeys.relayJWT)
        }
        if let relayRoomSecret {
            userDefaults.set(relayRoomSecret, forKey: XiaokPreferenceKeys.relayRoomSecret)
        }
        relayClient = MobileRelayConfiguration.load(userDefaults: userDefaults).map {
            RelayMobileGatewayClient(configuration: $0)
        }

        health = .offline
        connectionRoute = .none
        errorMessage = nil
        requiresSnapshotRefresh = true
        return true
    }

    func loadInitialSnapshot() async {
        isLoadingSnapshot = true
        defer { isLoadingSnapshot = false }

        if usesFixedClient {
            await loadSnapshotFromFixedClient()
            return
        }

        if await loadSnapshotFromConfiguredGateway() {
            return
        }
        if await loadSnapshotFromDiscoveredDesktop() {
            return
        }
        if await loadSnapshotFromRelay() {
            return
        }

        print("xiaok-mobile:desktop-snapshot-failed gateway=\(gatewayURLString)")
        errorMessage = strings.unableToConnectDesktop
        health = .offline
        connectionRoute = .none
    }

    func sendMessage(_ text: String) async {
        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedText.isEmpty else {
            return
        }

        let localConversationId = "local-\(Int(Date().timeIntervalSince1970 * 1000))"
        let localMessageId = "\(localConversationId)-user"
        let localMessage = ChatMessage(
            id: localMessageId,
            conversationId: localConversationId,
            role: .user,
            text: trimmedText,
            createdAt: Date(),
            deliveryStatus: .sending
        )
        messages.append(localMessage)
        upsertConversation(
            ConversationSummary(
                id: localConversationId,
                title: trimmedText.nonEmptyPrefix(maxLength: 80) ?? strings.tasksTitle,
                status: .running,
                lastMessagePreview: trimmedText,
                updatedAt: localMessage.createdAt,
                messageCount: 1
            )
        )
        selectedConversationId = localConversationId

        isSending = true
        defer { isSending = false }

        do {
            let events = try await client.sendMessage(trimmedText)
            let hasAppendedMessage = events.contains { event in
                if case .chatMessageAppended = event {
                    return true
                }
                return false
            }
            if hasAppendedMessage {
                messages.removeAll { $0.id == localMessageId }
                removeConversationIfEmpty(localConversationId)
            } else {
                markMessage(localMessageId, deliveryStatus: .sent)
            }
            for event in events {
                apply(event)
            }
            if requiresSnapshotRefresh {
                await loadInitialSnapshot()
                if selectedConversationId == nil {
                    selectedConversationId = conversations.first?.id
                }
                scheduleFollowUpSnapshotRefreshes()
            }
            errorMessage = nil
        } catch {
            markMessage(localMessageId, deliveryStatus: .failed)
            errorMessage = strings.messageFailed
        }
    }

    func respondToApproval(id: String, decision: ApprovalDecision) async {
        guard !respondingApprovalIds.contains(id) else {
            return
        }

        respondingApprovalIds.insert(id)
        defer { respondingApprovalIds.remove(id) }

        do {
            let updatedApproval = try await client.respondToApproval(id: id, decision: decision)
            if let index = approvals.firstIndex(where: { $0.id == id }) {
                approvals[index] = updatedApproval
            }
            errorMessage = nil
        } catch {
            errorMessage = strings.approvalFailed
        }
    }

    func apply(_ event: MobileEvent) {
        switch event {
        case .chatMessageAppended(let message, let sequence):
            let normalizedMessage = normalized(message: message)
            messages.append(normalizedMessage)
            upsertConversation(conversationSummary(for: normalizedMessage, status: .running))
            selectedConversationId = normalizedMessage.conversationId ?? selectedConversationId
            lastSyncSequence = sequence
        case .turnStarted(let turn, let sequence):
            runningTurn = turn
            upsertConversation(
                ConversationSummary(
                    id: turn.id,
                    title: turn.title,
                    status: turn.status == .waiting ? .waiting : .running,
                    lastMessagePreview: turn.title,
                    updatedAt: Date(),
                    messageCount: messages.filter { ($0.conversationId ?? "default") == turn.id }.count
                )
            )
            selectedConversationId = turn.id
            lastSyncSequence = sequence
        case .turnFinished(let turnId, let sequence):
            if runningTurn?.id == turnId {
                runningTurn = nil
            }
            if let conversation = conversations.first(where: { $0.id == turnId }) {
                upsertConversation(
                    ConversationSummary(
                        id: conversation.id,
                        title: conversation.title,
                        status: .completed,
                        lastMessagePreview: conversation.lastMessagePreview,
                        updatedAt: Date(),
                        messageCount: conversation.messageCount
                    )
                )
            }
            lastSyncSequence = sequence
        case .snapshotRequired:
            requiresSnapshotRefresh = true
        }
    }

    private func apply(_ snapshot: MobileSnapshot, persistCache: Bool = true) {
        desktopName = snapshot.desktopName
        health = snapshot.health
        lastSyncSequence = snapshot.lastSyncSequence
        runningTurn = snapshot.runningTurn
        messages = snapshot.messages
        conversations = snapshot.conversations
        projects = snapshot.projects
        approvals = snapshot.approvals
        loops = snapshot.loops
        artifacts = snapshot.artifacts
        requiresSnapshotRefresh = false
        if let selectedConversationId,
           !conversations.contains(where: { $0.id == selectedConversationId }) {
            self.selectedConversationId = nil
        }
        if persistCache {
            persistSnapshotCache(snapshot)
        }
    }

    private func applyCachedSnapshotIfPresent() {
        guard let data = userDefaults.data(forKey: XiaokPreferenceKeys.snapshotCache),
              let snapshot = try? JSONDecoder.xiaokMobile.decode(MobileSnapshot.self, from: data) else {
            return
        }
        apply(snapshot, persistCache: false)
    }

    private func persistSnapshotCache(_ snapshot: MobileSnapshot) {
        guard let data = try? JSONEncoder.xiaokMobile.encode(snapshot) else {
            return
        }
        userDefaults.set(data, forKey: XiaokPreferenceKeys.snapshotCache)
    }

    private func normalized(message: ChatMessage) -> ChatMessage {
        let conversationId = message.conversationId ?? runningTurn?.id ?? "default"
        return ChatMessage(
            id: message.id,
            conversationId: conversationId,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            deliveryStatus: message.deliveryStatus ?? .sent
        )
    }

    private func conversationSummary(for message: ChatMessage, status: ConversationStatus) -> ConversationSummary {
        let conversationId = message.conversationId ?? "default"
        let conversationMessages = messages.filter { ($0.conversationId ?? "default") == conversationId }
        let existingTitle = conversations.first(where: { $0.id == conversationId })?.title
        return ConversationSummary(
            id: conversationId,
            title: existingTitle ?? message.text.nonEmptyPrefix(maxLength: 80) ?? strings.tasksTitle,
            status: status,
            lastMessagePreview: message.text,
            updatedAt: message.createdAt,
            messageCount: conversationMessages.count
        )
    }

    private func upsertConversation(_ conversation: ConversationSummary) {
        conversations.removeAll { $0.id == conversation.id }
        conversations.append(conversation)
        conversations.sort { $0.updatedAt > $1.updatedAt }
    }

    private func removeConversationIfEmpty(_ conversationId: String) {
        guard !messages.contains(where: { ($0.conversationId ?? "default") == conversationId }) else {
            return
        }
        conversations.removeAll { $0.id == conversationId }
    }

    private func markMessage(_ messageId: String, deliveryStatus: MessageDeliveryStatus) {
        guard let index = messages.firstIndex(where: { $0.id == messageId }) else {
            return
        }
        let message = messages[index]
        messages[index] = ChatMessage(
            id: message.id,
            conversationId: message.conversationId,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            deliveryStatus: deliveryStatus
        )
        if let conversationId = message.conversationId,
           let conversation = conversations.first(where: { $0.id == conversationId }) {
            upsertConversation(
                ConversationSummary(
                    id: conversation.id,
                    title: conversation.title,
                    status: deliveryStatus == .failed ? .failed : conversation.status,
                    lastMessagePreview: conversation.lastMessagePreview,
                    updatedAt: conversation.updatedAt,
                    messageCount: conversation.messageCount
                )
            )
        }
    }

    private func scheduleFollowUpSnapshotRefreshes() {
        guard !followUpSnapshotRefreshDelaysNanoseconds.isEmpty else {
            return
        }

        followUpSnapshotRefreshTask?.cancel()
        let delays = followUpSnapshotRefreshDelaysNanoseconds
        followUpSnapshotRefreshTask = Task { [weak self] in
            for delay in delays {
                do {
                    try await Task.sleep(nanoseconds: delay)
                } catch {
                    return
                }
                await self?.loadInitialSnapshot()
            }
        }
    }

    private func startNetworkMonitor() {
        networkMonitor.start { [weak self] in
            Task { @MainActor in
                await self?.handleNetworkChanged()
            }
        }
    }

    private func handleNetworkChanged() async {
        await loadInitialSnapshot()
    }

    private func loadSnapshotFromFixedClient() async {
        do {
            try await prepareCurrentDesktopTrustIfPossible(using: client)
            let snapshot = try await client.fetchSnapshot()
            connectionRoute = .lan
            apply(snapshot)
            print("xiaok-mobile:desktop-snapshot-loaded health=\(snapshot.health.rawValue) route=fixed")
            errorMessage = nil
        } catch {
            print("xiaok-mobile:desktop-snapshot-failed route=fixed error=\(error)")
            errorMessage = strings.unableToConnectDesktop
            health = .offline
            connectionRoute = .none
        }
    }

    private func loadSnapshotFromConfiguredGateway() async -> Bool {
        guard let gatewayURL = Self.validGatewayURL(from: gatewayURLString) else {
            return false
        }

        let candidate = makeClient(gatewayURL)
        do {
            try await prepareCurrentDesktopTrustIfPossible(using: candidate)
            let snapshot = try await fetchStableLANSnapshot(using: candidate)
            client = candidate
            connectionRoute = .lan
            apply(snapshot)
            print("xiaok-mobile:desktop-snapshot-loaded health=\(snapshot.health.rawValue) route=lan gateway=\(gatewayURLString)")
            errorMessage = nil
            return true
        } catch {
            return false
        }
    }

    private func prepareCurrentDesktopTrustIfPossible(using client: any MobileGatewayClient) async throws {
        guard accessToken != nil else {
            return
        }

        let hello = try await client.fetchHello()
        guard hello.protocolVersion == "mobile-v1" else {
            throw URLError(.badServerResponse)
        }

        if let expectedDesktopId = desktopId {
            guard expectedDesktopId == hello.desktopId else {
                throw URLError(.userAuthenticationRequired)
            }
            return
        }

        desktopId = hello.desktopId
        userDefaults.set(hello.desktopId, forKey: XiaokPreferenceKeys.desktopId)
    }

    private func loadSnapshotFromDiscoveredDesktop() async -> Bool {
        guard accessToken != nil,
              let expectedDesktopId = desktopId else {
            return false
        }

        let discoveredURLs = await desktopDiscovery.discoverDesktopGatewayURLs(timeout: 2)
        for url in discoveredURLs {
            guard Self.validGatewayURL(from: url.absoluteString) != nil else {
                continue
            }

            let candidate = makeClient(url)
            do {
                let hello = try await candidate.fetchHello()
                guard hello.protocolVersion == "mobile-v1",
                      hello.desktopId == expectedDesktopId else {
                    continue
                }

                let snapshot = try await fetchStableLANSnapshot(using: candidate)
                gatewayURLString = url.absoluteString
                userDefaults.set(gatewayURLString, forKey: XiaokPreferenceKeys.gatewayURL)
                client = candidate
                connectionRoute = .lan
                apply(snapshot)
                print("xiaok-mobile:desktop-snapshot-loaded health=\(snapshot.health.rawValue) route=lan gateway=\(gatewayURLString)")
                errorMessage = nil
                return true
            } catch {
                continue
            }
        }

        return false
    }

    private func loadSnapshotFromRelay() async -> Bool {
        guard let relayClient,
              accessToken != nil,
              let expectedDesktopId = desktopId else {
            return false
        }

        do {
            let hello = try await relayClient.fetchHello()
            guard hello.protocolVersion == "mobile-v1",
                  hello.desktopId == expectedDesktopId else {
                return false
            }

            let snapshot = try await relayClient.fetchSnapshot()
            client = relayClient
            connectionRoute = .relay
            apply(snapshot)
            print("xiaok-mobile:desktop-snapshot-loaded health=\(snapshot.health.rawValue) route=relay gateway=\(gatewayURLString)")
            errorMessage = nil
            return true
        } catch {
            return false
        }
    }

    private func fetchStableLANSnapshot(using candidate: any MobileGatewayClient) async throws -> MobileSnapshot {
        let firstSnapshot = try await candidate.fetchSnapshot()
        guard connectionRoute == .relay else {
            return firstSnapshot
        }
        return try await candidate.fetchSnapshot()
    }

    private static func storedGatewayURLString(in userDefaults: UserDefaults) -> String {
        if let environmentURL = ProcessInfo.processInfo.environment["XIAOK_MOBILE_GATEWAY_URL"],
           let validEnvironmentURL = validGatewayURL(from: environmentURL) {
            if !isLoopbackGatewayURL(validEnvironmentURL) {
                userDefaults.set(validEnvironmentURL.absoluteString, forKey: XiaokPreferenceKeys.gatewayURL)
            }
            return validEnvironmentURL.absoluteString
        }

        let storedValue = userDefaults.string(forKey: XiaokPreferenceKeys.gatewayURL)
        if let storedValue,
           let storedURL = validGatewayURL(from: storedValue) {
            if isLoopbackGatewayURL(storedURL) {
                userDefaults.removeObject(forKey: XiaokPreferenceKeys.gatewayURL)
                return defaultGatewayURLString
            }
            return storedURL.absoluteString
        }

        return defaultGatewayURLString
    }

    private static func storedDesktopId(in userDefaults: UserDefaults) -> String? {
        if let environmentDesktopId = ProcessInfo.processInfo.environment["XIAOK_MOBILE_DESKTOP_ID"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !environmentDesktopId.isEmpty {
            userDefaults.set(environmentDesktopId, forKey: XiaokPreferenceKeys.desktopId)
            return environmentDesktopId
        }

        guard let storedDesktopId = userDefaults.string(forKey: XiaokPreferenceKeys.desktopId)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !storedDesktopId.isEmpty else {
            return nil
        }

        return storedDesktopId
    }

    private static func storedAccessToken(in userDefaults: UserDefaults) -> String? {
        if let environmentAccessToken = ProcessInfo.processInfo.environment["XIAOK_MOBILE_ACCESS_TOKEN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !environmentAccessToken.isEmpty {
            userDefaults.set(environmentAccessToken, forKey: XiaokPreferenceKeys.accessToken)
            return environmentAccessToken
        }

        guard let storedAccessToken = userDefaults.string(forKey: XiaokPreferenceKeys.accessToken)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !storedAccessToken.isEmpty else {
            return nil
        }

        return storedAccessToken
    }

    private static func storedLanguage(in userDefaults: UserDefaults) -> AppLanguage {
        if let environmentLanguage = ProcessInfo.processInfo.environment["XIAOK_MOBILE_LANGUAGE"],
           let language = AppLanguage(storedValue: environmentLanguage) {
            return language
        }

        if let storedValue = userDefaults.string(forKey: XiaokPreferenceKeys.language),
           let language = AppLanguage(storedValue: storedValue) {
            return language
        }

        return .system
    }

    private static func isLoopbackGatewayURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else {
            return false
        }

        return host == "localhost" || host == "::1" || host.hasPrefix("127.")
    }

    private static func validGatewayURL(from rawValue: String) -> URL? {
        guard let components = URLComponents(string: rawValue),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host?.isEmpty == false,
              let url = components.url else {
            return nil
        }

        return url
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}
