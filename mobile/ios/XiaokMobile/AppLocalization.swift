import Foundation

enum XiaokPreferenceKeys {
    static let gatewayURL = "xiaok.mobile.gatewayURL"
    static let desktopId = "xiaok.mobile.desktopId"
    static let accessToken = "xiaok.mobile.accessToken"
    static let relayURL = "xiaok.mobile.relayURL"
    static let relayJWT = "xiaok.mobile.relayJWT"
    static let relayRoomSecret = "xiaok.mobile.relayRoomSecret"
    static let language = "xiaok.mobile.language"
    static let snapshotCache = "xiaok.mobile.snapshotCache"
}

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case simplifiedChinese = "zh-Hans"
    case english = "en"

    var id: String { rawValue }

    init?(storedValue: String) {
        switch storedValue {
        case "system":
            self = .system
        case "zh", "zh-Hans", "zh_CN", "zh-Hans-CN":
            self = .simplifiedChinese
        case "en", "en-US", "en_US":
            self = .english
        default:
            return nil
        }
    }

    var forcedLocaleIdentifier: String? {
        switch self {
        case .system:
            nil
        case .simplifiedChinese:
            "zh-Hans"
        case .english:
            "en"
        }
    }
}

struct AppStrings {
    let tabOverview: String
    let tabTasks: String
    let tabWork: String
    let tabApprovals: String
    let tabSettings: String
    let appTitle: String
    let overviewTitle: String
    let currentTurn: String
    let noActiveTurn: String
    let sync: String
    let sequence: (Int) -> String
    let snapshotRefreshRequired: String
    let activeProjects: (Int) -> String
    let pendingApprovals: (Int) -> String
    let runningLoops: (Int) -> String
    let recentFiles: (Int) -> String
    let tasksTitle: String
    let taskHistoryTitle: String
    let newTask: String
    let taskWelcomeTitle: String
    let taskWelcomeSubtitle: String
    let suggestedPromptStatus: String
    let suggestedPromptSummarize: String
    let suggestedPromptPlan: String
    let noTasks: String
    let done: String
    let back: String
    let messagePlaceholder: String
    let send: String
    let loadMore: String
    let refreshing: String
    let messageCount: (Int) -> String
    let messageDeliveryStatus: (MessageDeliveryStatus?) -> String
    let conversationStatus: (ConversationStatus) -> String
    let workTitle: String
    let projects: String
    let projectDetails: String
    let goal: String
    let requirements: String
    let summary: String
    let progress: String
    let lastUpdated: String
    let noFiles: String
    let artifactsTitle: String
    let artifactFallbackName: (ArtifactKind) -> String
    let artifactPreviewTitle: String
    let artifactPreviewUnavailable: String
    let mermaidDiagram: String
    let loops: String
    let files: String
    let activeTasks: (Int) -> String
    let projectTaskStats: (Int, Int, Int) -> String
    let artifactCount: (Int) -> String
    let lastRun: (String) -> String
    let approvalsTitle: String
    let approvalEmptyTitle: String
    let approvalEmptyMessage: String
    let risk: (String) -> String
    let approve: String
    let reject: String
    let settingsTitle: String
    let desktopConnection: String
    let gatewayURL: String
    let gatewayURLPlaceholder: String
    let connectionHint: String
    let connectToDesktop: String
    let openConnectionSettings: String
    let scanPairingQRCode: String
    let pairingQRCodeTitle: String
    let pairingQRCodeHint: String
    let pairingQRCodeFrameLabel: String
    let pairingScannerUnavailable: String
    let invalidPairingQRCode: String
    let pairingSucceededTitle: String
    let pairingSucceededMessage: String
    let language: String
    let systemLanguage: String
    let simplifiedChinese: String
    let english: String
    let diagnostics: String
    let currentGateway: String
    let currentRoute: String
    let invalidGatewayURL: String
    let unableToConnectDesktop: String
    let messageFailed: String
    let approvalFailed: String
    let desktopHealth: (DesktopHealth) -> String
    let projectStatus: (ProjectStatus) -> String
    let approvalRisk: (ApprovalRisk) -> String
    let approvalStatus: (ApprovalStatus) -> String
    let loopStatus: (LoopStatus) -> String
    let loopRunStatus: (LoopRunStatus) -> String
    let artifactStatus: (ArtifactStatus) -> String
    let connectionRoute: (MobileConnectionRoute) -> String
}

extension AppStrings {
    static func resolve(language: AppLanguage, locale: Locale = .autoupdatingCurrent) -> AppStrings {
        switch language {
        case .simplifiedChinese:
            chinese
        case .english:
            english
        case .system:
            locale.identifier.hasPrefix("zh") ? chinese : english
        }
    }

    static let english = AppStrings(
        tabOverview: "Overview",
        tabTasks: "Tasks",
        tabWork: "Work",
        tabApprovals: "Approvals",
        tabSettings: "Settings",
        appTitle: "Xiaok Mobile",
        overviewTitle: "Overview",
        currentTurn: "Current turn",
        noActiveTurn: "No active turn",
        sync: "Sync",
        sequence: { "Sequence \($0)" },
        snapshotRefreshRequired: "Snapshot refresh required",
        activeProjects: { "\($0) active projects" },
        pendingApprovals: { "\($0) pending approvals" },
        runningLoops: { "\($0) running loops" },
        recentFiles: { "\($0) recent artifacts" },
        tasksTitle: "Tasks",
        taskHistoryTitle: "Task history",
        newTask: "New task",
        taskWelcomeTitle: "What are we working on?",
        taskWelcomeSubtitle: "Start a desktop task from your phone. Xiaok will keep the task synced here.",
        suggestedPromptStatus: "Draft a status update",
        suggestedPromptSummarize: "Summarize current project",
        suggestedPromptPlan: "Plan next steps",
        noTasks: "No tasks yet",
        done: "Done",
        back: "Back",
        messagePlaceholder: "Message",
        send: "Send",
        loadMore: "Load more",
        refreshing: "Refreshing...",
        messageCount: { "\($0) messages" },
        messageDeliveryStatus: { status in
            switch status {
            case .sending: "Sending"
            case .sent: "Sent"
            case .failed: "Failed"
            case .none: ""
            }
        },
        conversationStatus: { status in
            switch status {
            case .running: "Running"
            case .waiting: "Waiting"
            case .completed: "Done"
            case .failed: "Failed"
            }
        },
        workTitle: "Work",
        projects: "Projects",
        projectDetails: "Project details",
        goal: "Goal",
        requirements: "Requirements",
        summary: "Summary",
        progress: "Progress",
        lastUpdated: "Last updated",
        noFiles: "No artifacts",
        artifactsTitle: "Artifacts",
        artifactFallbackName: { "\($0.displayText) artifact" },
        artifactPreviewTitle: "Artifact preview",
        artifactPreviewUnavailable: "Preview is not available for this artifact.",
        mermaidDiagram: "Mermaid diagram",
        loops: "Loops",
        files: "Artifacts",
        activeTasks: { "\($0) active tasks" },
        projectTaskStats: { done, total, stopped in
            stopped > 0 ? "\(done)/\(total) tasks done, \(stopped) stopped" : "\(done)/\(total) tasks done"
        },
        artifactCount: { count in
            count == 1 ? "1 artifact" : "\(count) artifacts"
        },
        lastRun: { "Last run: \($0)" },
        approvalsTitle: "Approvals",
        approvalEmptyTitle: "No approvals",
        approvalEmptyMessage: "Desktop tasks that need your confirmation will appear here.",
        risk: { "Risk: \($0)" },
        approve: "Approve",
        reject: "Reject",
        settingsTitle: "Settings",
        desktopConnection: "Desktop Connection",
        gatewayURL: "Gateway URL",
        gatewayURLPlaceholder: "http://192.168.1.10:47891",
        connectionHint: "After pairing, Xiaok can rediscover your Mac when its Wi-Fi address changes. 127.0.0.1 only works for local development.",
        connectToDesktop: "Connect to Desktop",
        openConnectionSettings: "Open Connection Settings",
        scanPairingQRCode: "Scan pairing QR code",
        pairingQRCodeTitle: "Pair desktop",
        pairingQRCodeHint: "Point the camera at the QR code shown by Xiaok Desktop.",
        pairingQRCodeFrameLabel: "Align the QR code inside the frame.",
        pairingScannerUnavailable: "Camera is unavailable.",
        invalidPairingQRCode: "This QR code is not a Xiaok desktop pairing code.",
        pairingSucceededTitle: "Pairing complete",
        pairingSucceededMessage: "Connected to Xiaok Desktop.",
        language: "Language",
        systemLanguage: "System",
        simplifiedChinese: "简体中文",
        english: "English",
        diagnostics: "Diagnostics",
        currentGateway: "Current gateway",
        currentRoute: "Current route",
        invalidGatewayURL: "Enter a valid http or https desktop gateway URL.",
        unableToConnectDesktop: "Unable to connect to desktop",
        messageFailed: "Message failed",
        approvalFailed: "Approval failed",
        desktopHealth: { health in
            switch health {
            case .online: "Desktop online"
            case .degraded: "Desktop degraded"
            case .offline: "Desktop offline"
            }
        },
        projectStatus: { status in
            switch status {
            case .active: "Active"
            case .blocked: "Blocked"
            case .completed: "Completed"
            case .closed: "Closed"
            }
        },
        approvalRisk: { risk in
            switch risk {
            case .low: "Low"
            case .medium: "Medium"
            case .high: "High"
            }
        },
        approvalStatus: { status in
            switch status {
            case .pending: "Pending"
            case .approved: "Approved"
            case .rejected: "Rejected"
            }
        },
        loopStatus: { status in
            switch status {
            case .scheduled: "Scheduled"
            case .running: "Running"
            case .paused: "Paused"
            case .blocked: "Blocked"
            }
        },
        loopRunStatus: { status in
            switch status {
            case .success: "Success"
            case .failed: "Failed"
            case .running: "Running"
            case .blocked: "Blocked"
            case .skipped: "Skipped"
            }
        },
        artifactStatus: { status in
            switch status {
            case .ready: "Ready"
            case .generating: "Generating"
            case .failed: "Failed"
            }
        },
        connectionRoute: { route in
            switch route {
            case .none: "Not connected"
            case .lan: "Local network"
            case .relay: "Relay"
            }
        }
    )

    static let chinese = AppStrings(
        tabOverview: "总览",
        tabTasks: "任务",
        tabWork: "工作",
        tabApprovals: "审批",
        tabSettings: "设置",
        appTitle: "小 K 移动端",
        overviewTitle: "总览",
        currentTurn: "当前回合",
        noActiveTurn: "没有正在运行的回合",
        sync: "同步",
        sequence: { "序列号 \($0)" },
        snapshotRefreshRequired: "需要刷新快照",
        activeProjects: { "\($0) 个活跃项目" },
        pendingApprovals: { "\($0) 个待审批" },
        runningLoops: { "\($0) 个运行中的 Loop" },
        recentFiles: { "\($0) 个近期产物" },
        tasksTitle: "任务",
        taskHistoryTitle: "历史任务",
        newTask: "新建任务",
        taskWelcomeTitle: "今天要推进什么？",
        taskWelcomeSubtitle: "从手机发起桌面端任务，后续消息、产物和状态会同步到这里。",
        suggestedPromptStatus: "起草状态更新",
        suggestedPromptSummarize: "总结当前项目",
        suggestedPromptPlan: "规划下一步",
        noTasks: "还没有任务",
        done: "完成",
        back: "返回",
        messagePlaceholder: "输入任务",
        send: "发送",
        loadMore: "加载更多",
        refreshing: "正在刷新...",
        messageCount: { "\($0) 条消息" },
        messageDeliveryStatus: { status in
            switch status {
            case .sending: "发送中"
            case .sent: "已发送"
            case .failed: "发送失败"
            case .none: ""
            }
        },
        conversationStatus: { status in
            switch status {
            case .running: "运行中"
            case .waiting: "等待中"
            case .completed: "已完成"
            case .failed: "失败"
            }
        },
        workTitle: "工作",
        projects: "项目",
        projectDetails: "项目详情",
        goal: "目标",
        requirements: "要求",
        summary: "摘要",
        progress: "进度",
        lastUpdated: "最后更新",
        noFiles: "暂无产物",
        artifactsTitle: "产物",
        artifactFallbackName: { "\($0.displayText) 产物" },
        artifactPreviewTitle: "产物预览",
        artifactPreviewUnavailable: "这个产物暂时无法预览。",
        mermaidDiagram: "Mermaid 图",
        loops: "Loop",
        files: "产物",
        activeTasks: { "\($0) 个活跃任务" },
        projectTaskStats: { done, total, stopped in
            stopped > 0 ? "\(done)/\(total) 个任务完成，\(stopped) 个已停止" : "\(done)/\(total) 个任务完成"
        },
        artifactCount: { "\($0) 个产物" },
        lastRun: { "上次运行：\($0)" },
        approvalsTitle: "审批",
        approvalEmptyTitle: "暂无审批",
        approvalEmptyMessage: "需要你确认命令、权限或选择的桌面端任务会出现在这里。",
        risk: { "风险：\($0)" },
        approve: "批准",
        reject: "拒绝",
        settingsTitle: "设置",
        desktopConnection: "桌面端连接",
        gatewayURL: "Gateway 地址",
        gatewayURLPlaceholder: "http://192.168.1.10:47891",
        connectionHint: "配对后，小 K 会在 Mac 的 Wi-Fi 地址变化时自动重新发现。127.0.0.1 只适合本机开发。",
        connectToDesktop: "连接桌面端",
        openConnectionSettings: "打开连接设置",
        scanPairingQRCode: "扫描配对二维码",
        pairingQRCodeTitle: "配对桌面端",
        pairingQRCodeHint: "将 Xiaok Desktop 显示的二维码放入取景框。",
        pairingQRCodeFrameLabel: "将二维码对准取景框。",
        pairingScannerUnavailable: "摄像头不可用。",
        invalidPairingQRCode: "这不是 Xiaok 桌面端配对二维码。",
        pairingSucceededTitle: "配对成功",
        pairingSucceededMessage: "已连接到 Xiaok Desktop。",
        language: "语言",
        systemLanguage: "跟随系统",
        simplifiedChinese: "简体中文",
        english: "English",
        diagnostics: "诊断",
        currentGateway: "当前 Gateway",
        currentRoute: "当前通道",
        invalidGatewayURL: "请输入有效的 http 或 https desktop gateway 地址。",
        unableToConnectDesktop: "无法连接桌面端",
        messageFailed: "消息发送失败",
        approvalFailed: "审批失败",
        desktopHealth: { health in
            switch health {
            case .online: "桌面端在线"
            case .degraded: "桌面端部分可用"
            case .offline: "桌面端离线"
            }
        },
        projectStatus: { status in
            switch status {
            case .active: "进行中"
            case .blocked: "阻塞"
            case .completed: "已完成"
            case .closed: "已关闭"
            }
        },
        approvalRisk: { risk in
            switch risk {
            case .low: "低"
            case .medium: "中"
            case .high: "高"
            }
        },
        approvalStatus: { status in
            switch status {
            case .pending: "待处理"
            case .approved: "已批准"
            case .rejected: "已拒绝"
            }
        },
        loopStatus: { status in
            switch status {
            case .scheduled: "已排期"
            case .running: "运行中"
            case .paused: "已暂停"
            case .blocked: "阻塞"
            }
        },
        loopRunStatus: { status in
            switch status {
            case .success: "成功"
            case .failed: "失败"
            case .running: "运行中"
            case .blocked: "阻塞"
            case .skipped: "已跳过"
            }
        },
        artifactStatus: { status in
            switch status {
            case .ready: "可用"
            case .generating: "生成中"
            case .failed: "失败"
            }
        },
        connectionRoute: { route in
            switch route {
            case .none: "未连接"
            case .lan: "局域网"
            case .relay: "Relay"
            }
        }
    )
}
