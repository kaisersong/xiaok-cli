import Foundation

enum DesktopHealth: String, Codable, Equatable {
    case online
    case degraded
    case offline

    var displayText: String {
        switch self {
        case .online:
            "Desktop online"
        case .degraded:
            "Desktop degraded"
        case .offline:
            "Desktop offline"
        }
    }
}

enum MobileConnectionRoute: String, Codable, Equatable {
    case none
    case lan
    case relay
}

struct RunningTurn: Codable, Equatable, Identifiable {
    enum Status: String, Codable, Equatable {
        case running
        case waiting
        case finished
    }

    let id: String
    let title: String
    let status: Status
}

struct ChatMessage: Codable, Equatable, Identifiable {
    enum Role: String, Codable, Equatable {
        case user
        case assistant
        case system
    }

    let id: String
    let conversationId: String?
    let role: Role
    let text: String
    let createdAt: Date
    let deliveryStatus: MessageDeliveryStatus?

    init(
        id: String,
        conversationId: String? = nil,
        role: Role,
        text: String,
        createdAt: Date,
        deliveryStatus: MessageDeliveryStatus? = nil
    ) {
        self.id = id
        self.conversationId = conversationId
        self.role = role
        self.text = text
        self.createdAt = createdAt
        self.deliveryStatus = deliveryStatus
    }
}

struct MessageActivity: Equatable, Identifiable {
    enum Kind: Equatable {
        case skill
        case bash
        case tool
    }

    enum Status: Equatable {
        case running
        case completed
        case failed
        case unknown
    }

    let id: String
    let conversationId: String?
    let kind: Kind
    let status: Status
    let title: String
    let detail: String
    let createdAt: Date
}

struct MessageDisplayItem: Equatable, Identifiable {
    enum Kind: Equatable {
        case chat(ChatMessage)
        case activity(MessageActivity)
    }

    let id: String
    let kind: Kind

    init(chat message: ChatMessage) {
        self.id = message.id
        self.kind = .chat(message)
    }

    init(activity: MessageActivity) {
        self.id = activity.id
        self.kind = .activity(activity)
    }

    var createdAt: Date {
        switch kind {
        case .chat(let message):
            message.createdAt
        case .activity(let activity):
            activity.createdAt
        }
    }

    var debugText: String {
        switch kind {
        case .chat(let message):
            message.text
        case .activity(let activity):
            activity.detail
        }
    }
}

enum MobileMessageDisplayBuilder {
    static func displayItems(from messages: [ChatMessage]) -> [MessageDisplayItem] {
        messages.compactMap(displayItem(from:))
    }

    static func previewText(for message: ChatMessage) -> String? {
        displayItem(from: message)?.debugText.nonEmptyPrefix(maxLength: 160)
    }

    private static func displayItem(from message: ChatMessage) -> MessageDisplayItem? {
        let displayText = sanitizeDisplayText(message.text)
        guard !displayText.isEmpty else {
            return nil
        }
        if let activity = activity(from: message, displayText: displayText) {
            return MessageDisplayItem(activity: activity)
        }
        guard message.role != .system else {
            return nil
        }
        if displayText == message.text {
            return MessageDisplayItem(chat: message)
        }
        return MessageDisplayItem(chat: ChatMessage(
            id: message.id,
            conversationId: message.conversationId,
            role: message.role,
            text: displayText,
            createdAt: message.createdAt,
            deliveryStatus: message.deliveryStatus
        ))
    }

    private static func sanitizeDisplayText(_ text: String) -> String {
        let visibleLines = text.components(separatedBy: .newlines).filter { line in
            !isSystemMetadataLine(line)
        }
        return collapseExcessBlankLines(visibleLines.joined(separator: "\n"))
    }

    private static func isSystemMetadataLine(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("[SYSTEM:") && trimmed.hasSuffix("]")
    }

    private static func collapseExcessBlankLines(_ text: String) -> String {
        var lines: [String] = []
        var blankCount = 0

        for line in text.components(separatedBy: .newlines) {
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                blankCount += 1
                if blankCount <= 2 {
                    lines.append("")
                }
            } else {
                blankCount = 0
                lines.append(line)
            }
        }

        return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func activity(from message: ChatMessage, displayText: String) -> MessageActivity? {
        guard let title = displayText.components(separatedBy: .newlines).first(where: { line in
            !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        })?.trimmingCharacters(in: .whitespacesAndNewlines),
              let kind = activityKind(from: title),
              isActivityTitle(title) else {
            return nil
        }

        return MessageActivity(
            id: message.id,
            conversationId: message.conversationId,
            kind: kind,
            status: activityStatus(from: displayText),
            title: title,
            detail: displayText,
            createdAt: message.createdAt
        )
    }

    private static func activityKind(from title: String) -> MessageActivity.Kind? {
        let lowercasedTitle = title.lowercased()
        if lowercasedTitle.hasPrefix("skill") {
            return .skill
        }
        if lowercasedTitle.hasPrefix("bash") {
            return .bash
        }
        if lowercasedTitle.hasPrefix("tool") {
            return .tool
        }
        return nil
    }

    private static func isActivityTitle(_ title: String) -> Bool {
        let lowercasedTitle = title.lowercased()
        return title.contains(":")
            || title.contains("：")
            || title.contains("完成")
            || title.contains("失败")
            || title.contains("调用")
            || lowercasedTitle.contains("completed")
            || lowercasedTitle.contains("started")
            || lowercasedTitle.contains("running")
            || lowercasedTitle.contains("failed")
    }

    private static func activityStatus(from text: String) -> MessageActivity.Status {
        let lowercasedText = text.lowercased()
        if text.contains("失败") || lowercasedText.contains("failed") || lowercasedText.contains("error") {
            return .failed
        }
        if text.contains("完成") || lowercasedText.contains("completed") || lowercasedText.contains("succeeded") || lowercasedText.contains("success") {
            return .completed
        }
        if text.contains("调用") || lowercasedText.contains("started") || lowercasedText.contains("running") {
            return .running
        }
        return .unknown
    }
}

enum MessageDeliveryStatus: String, Codable, Equatable {
    case sending
    case sent
    case failed
}

enum ConversationStatus: String, Codable, Equatable {
    case running
    case waiting
    case completed
    case failed
}

struct ConversationSummary: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let status: ConversationStatus
    let lastMessagePreview: String
    let updatedAt: Date
    let messageCount: Int
}

enum ProjectStatus: String, Codable, Equatable {
    case active
    case blocked
    case completed
    case closed

    var displayText: String {
        switch self {
        case .active: "Active"
        case .blocked: "Blocked"
        case .completed: "Completed"
        case .closed: "Closed"
        }
    }
}

struct DesktopProjectSummary: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    var goal: String? = nil
    var requirements: String? = nil
    var summary: String? = nil
    let status: ProjectStatus
    let progress: Double
    let activeTasks: Int
    var taskCount: Int? = nil
    var doneCount: Int? = nil
    var stoppedCount: Int? = nil
    var artifactCount: Int? = nil
    let updatedAt: Date
}

enum ApprovalRisk: String, Codable, Equatable {
    case low
    case medium
    case high

    var displayText: String {
        switch self {
        case .low: "Low"
        case .medium: "Medium"
        case .high: "High"
        }
    }
}

enum ApprovalStatus: String, Codable, Equatable {
    case pending
    case approved
    case rejected

    var displayText: String {
        switch self {
        case .pending: "Pending"
        case .approved: "Approved"
        case .rejected: "Rejected"
        }
    }
}

enum ApprovalDecision: String, Codable, Equatable {
    case approve
    case reject

    var resolvedStatus: ApprovalStatus {
        switch self {
        case .approve: .approved
        case .reject: .rejected
        }
    }
}

struct ApprovalRequest: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let detail: String
    let risk: ApprovalRisk
    let status: ApprovalStatus
    let createdAt: Date
}

enum LoopStatus: String, Codable, Equatable {
    case scheduled
    case running
    case paused
    case blocked

    var displayText: String {
        switch self {
        case .scheduled: "Scheduled"
        case .running: "Running"
        case .paused: "Paused"
        case .blocked: "Blocked"
        }
    }
}

enum LoopRunStatus: String, Codable, Equatable {
    case success
    case failed
    case running
    case blocked
    case skipped

    var displayText: String {
        switch self {
        case .success: "Success"
        case .failed: "Failed"
        case .running: "Running"
        case .blocked: "Blocked"
        case .skipped: "Skipped"
        }
    }
}

struct LoopSummary: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let status: LoopStatus
    let lastRunStatus: LoopRunStatus
    let nextRunSummary: String
}

enum ArtifactKind: String, Codable, Equatable {
    case markdown
    case pdf
    case pptx
    case html
    case image
    case text
    case other

    var displayText: String {
        rawValue.uppercased()
    }
}

enum ArtifactStatus: String, Codable, Equatable {
    case ready
    case generating
    case failed

    var displayText: String {
        switch self {
        case .ready: "Ready"
        case .generating: "Generating"
        case .failed: "Failed"
        }
    }
}

struct DesktopArtifactSummary: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let kind: ArtifactKind
    let source: String
    let status: ArtifactStatus
    let previewAvailable: Bool?
    let mimeType: String?
    let sizeBytes: Int?

    init(
        id: String,
        name: String,
        kind: ArtifactKind,
        source: String,
        status: ArtifactStatus,
        previewAvailable: Bool? = nil,
        mimeType: String? = nil,
        sizeBytes: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.source = source
        self.status = status
        self.previewAvailable = previewAvailable
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
    }
}

struct ArtifactPreview: Codable, Equatable {
    let artifact: DesktopArtifactSummary
    let contentType: String
    let text: String?
    let fileName: String?
    let dataBase64: String?

    init(
        artifact: DesktopArtifactSummary,
        contentType: String,
        text: String? = nil,
        fileName: String? = nil,
        dataBase64: String? = nil
    ) {
        self.artifact = artifact
        self.contentType = contentType
        self.text = text
        self.fileName = fileName
        self.dataBase64 = dataBase64
    }
}

struct MobileSnapshot: Codable, Equatable {
    let desktopName: String
    let health: DesktopHealth
    let lastSyncSequence: Int
    let runningTurn: RunningTurn?
    let messages: [ChatMessage]
    let conversations: [ConversationSummary]
    let projects: [DesktopProjectSummary]
    let approvals: [ApprovalRequest]
    let loops: [LoopSummary]
    let artifacts: [DesktopArtifactSummary]

    init(
        desktopName: String,
        health: DesktopHealth,
        lastSyncSequence: Int,
        runningTurn: RunningTurn?,
        messages: [ChatMessage],
        conversations: [ConversationSummary] = [],
        projects: [DesktopProjectSummary],
        approvals: [ApprovalRequest],
        loops: [LoopSummary],
        artifacts: [DesktopArtifactSummary]
    ) {
        self.desktopName = desktopName
        self.health = health
        self.lastSyncSequence = lastSyncSequence
        self.runningTurn = runningTurn
        self.messages = messages
        self.conversations = conversations.isEmpty
            ? Self.deriveConversations(messages: messages, projects: projects, runningTurn: runningTurn)
            : conversations
        self.projects = projects
        self.approvals = approvals
        self.loops = loops
        self.artifacts = artifacts
    }

    private enum CodingKeys: String, CodingKey {
        case desktopName
        case health
        case lastSyncSequence
        case runningTurn
        case messages
        case conversations
        case projects
        case approvals
        case loops
        case artifacts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        desktopName = try container.decode(String.self, forKey: .desktopName)
        health = try container.decode(DesktopHealth.self, forKey: .health)
        lastSyncSequence = try container.decode(Int.self, forKey: .lastSyncSequence)
        runningTurn = try container.decodeIfPresent(RunningTurn.self, forKey: .runningTurn)
        messages = try container.decode([ChatMessage].self, forKey: .messages)
        projects = try container.decode([DesktopProjectSummary].self, forKey: .projects)
        approvals = try container.decode([ApprovalRequest].self, forKey: .approvals)
        loops = try container.decode([LoopSummary].self, forKey: .loops)
        artifacts = try container.decode([DesktopArtifactSummary].self, forKey: .artifacts)
        conversations = try container.decodeIfPresent([ConversationSummary].self, forKey: .conversations)
            ?? Self.deriveConversations(messages: messages, projects: projects, runningTurn: runningTurn)
    }

    private static func deriveConversations(
        messages: [ChatMessage],
        projects: [DesktopProjectSummary],
        runningTurn: RunningTurn?
    ) -> [ConversationSummary] {
        var conversationsById: [String: ConversationSummary] = [:]
        let groupedMessages = Dictionary(grouping: messages) { message in
            message.conversationId ?? "default"
        }

        for project in projects {
            let projectMessages = groupedMessages[project.id] ?? []
            let displayItems = MobileMessageDisplayBuilder.displayItems(from: projectMessages)
            let latestItem = displayItems.sorted { $0.createdAt > $1.createdAt }.first
            conversationsById[project.id] = ConversationSummary(
                id: project.id,
                title: project.name,
                status: conversationStatus(project: project, runningTurn: runningTurn),
                lastMessagePreview: latestItem?.debugText ?? project.name,
                updatedAt: max(project.updatedAt, latestItem?.createdAt ?? project.updatedAt),
                messageCount: displayItems.count
            )
        }

        for (conversationId, conversationMessages) in groupedMessages where conversationsById[conversationId] == nil {
            let sortedItems = MobileMessageDisplayBuilder.displayItems(from: conversationMessages).sorted { $0.createdAt > $1.createdAt }
            guard let latestItem = sortedItems.first else {
                continue
            }
            conversationsById[conversationId] = ConversationSummary(
                id: conversationId,
                title: latestItem.debugText.nonEmptyPrefix(maxLength: 80) ?? conversationId,
                status: .completed,
                lastMessagePreview: latestItem.debugText,
                updatedAt: latestItem.createdAt,
                messageCount: sortedItems.count
            )
        }

        return conversationsById.values.sorted { $0.updatedAt > $1.updatedAt }
    }

    private static func conversationStatus(project: DesktopProjectSummary, runningTurn: RunningTurn?) -> ConversationStatus {
        if runningTurn?.id == project.id {
            return runningTurn?.status == .waiting ? .waiting : .running
        }
        switch project.status {
        case .active: return .running
        case .blocked: return .waiting
        case .completed: return .completed
        case .closed: return .failed
        }
    }
}

struct DesktopHello: Codable, Equatable {
    let desktopId: String
    let desktopName: String
    let protocolVersion: String
    let health: DesktopHealth
    let reachableURLs: [URL]

    private enum CodingKeys: String, CodingKey {
        case desktopId
        case desktopName
        case protocolVersion = "protocol"
        case health
        case reachableURLs
    }
}

enum MobileEvent: Equatable {
    case chatMessageAppended(message: ChatMessage, sequence: Int)
    case turnStarted(turn: RunningTurn, sequence: Int)
    case turnFinished(turnId: String, sequence: Int)
    case snapshotRequired(sequence: Int)

    var sequence: Int {
        switch self {
        case .chatMessageAppended(_, let sequence),
             .turnStarted(_, let sequence),
             .turnFinished(_, let sequence),
             .snapshotRequired(let sequence):
            sequence
        }
    }
}

extension MobileEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type
        case sequence
        case message
        case turn
        case turnId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        let sequence = try container.decode(Int.self, forKey: .sequence)

        switch type {
        case "chat.message_appended":
            let message = try container.decode(ChatMessage.self, forKey: .message)
            self = .chatMessageAppended(message: message, sequence: sequence)
        case "turn.started":
            let turn = try container.decode(RunningTurn.self, forKey: .turn)
            self = .turnStarted(turn: turn, sequence: sequence)
        case "turn.finished":
            let turnId = try container.decode(String.self, forKey: .turnId)
            self = .turnFinished(turnId: turnId, sequence: sequence)
        case "snapshot.required":
            self = .snapshotRequired(sequence: sequence)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unsupported mobile event type: \(type)"
            )
        }
    }
}

extension JSONDecoder {
    static var xiaokMobile: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = DateFormatters.iso8601WithFractionalSeconds.date(from: value)
                ?? DateFormatters.iso8601.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return decoder
    }
}

extension JSONEncoder {
    static var xiaokMobile: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private enum DateFormatters {
    static let iso8601WithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static let iso8601 = ISO8601DateFormatter()
}

extension String {
    func nonEmptyPrefix(maxLength: Int) -> String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }
        if trimmed.count <= maxLength {
            return trimmed
        }
        return String(trimmed.prefix(maxLength - 1)) + "..."
    }
}
