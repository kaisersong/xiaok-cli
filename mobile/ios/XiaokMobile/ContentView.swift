import AVFoundation
import QuickLook
import SwiftUI
import UIKit
import WebKit

struct ContentView: View {
    @StateObject private var store: XiaokAppStore

    init(store: XiaokAppStore) {
        _store = StateObject(wrappedValue: store)
    }

    var body: some View {
        let strings = store.strings

        TasksView(store: store, strings: strings)
        .environment(\.locale, Locale(identifier: store.language.forcedLocaleIdentifier ?? Locale.autoupdatingCurrent.identifier))
        .task {
            await store.loadInitialSnapshot()
        }
    }
}

private enum TaskSidebarSection: CaseIterable {
    case tasks
    case projects
    case artifacts
    case approvals
    case knowledge
    case automations
    case settings

    var icon: String {
        switch self {
        case .tasks:
            "checklist"
        case .projects:
            "folder"
        case .artifacts:
            "shippingbox"
        case .approvals:
            "checkmark.shield"
        case .knowledge:
            "book"
        case .automations:
            "clock.arrow.circlepath"
        case .settings:
            "gearshape"
        }
    }

    func title(strings: AppStrings) -> String {
        switch self {
        case .tasks:
            strings.tasksTitle
        case .projects:
            strings.projects
        case .artifacts:
            strings.artifactsTitle
        case .approvals:
            strings.approvalsTitle
        case .knowledge:
            strings.knowledgeTitle
        case .automations:
            strings.automationsTitle
        case .settings:
            strings.settingsTitle
        }
    }
}

private struct OverviewView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    let openSettings: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !store.isDesktopConnected {
                        ConnectionRequiredBanner(strings: strings, openSettings: openSettings)
                    }

                    CardSection {
                        Text(strings.desktopHealth(store.health))
                            .font(.headline)
                            .foregroundStyle(store.isDesktopConnected ? .green : .secondary)
                            .accessibilityIdentifier("DesktopHealthLabel")
                        Text(strings.connectionRoute(store.connectionRoute))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        SummaryTile(title: strings.activeProjects(activeProjectCount), subtitle: strings.projects)
                        SummaryTile(title: strings.pendingApprovals(pendingApprovalCount), subtitle: strings.approvalsTitle)
                        SummaryTile(title: strings.runningLoops(runningLoopCount), subtitle: strings.loops)
                        SummaryTile(title: strings.recentFiles(store.artifacts.count), subtitle: strings.files)
                    }

                    CardSection {
                        Text(strings.currentTurn)
                            .font(.headline)
                        if let runningTurn = store.runningTurn {
                            Text(runningTurn.title)
                                .font(.body.weight(.medium))
                            Text(runningTurn.status.rawValue)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(strings.noActiveTurn)
                                .foregroundStyle(.secondary)
                        }
                    }

                    CardSection {
                        Text(strings.sync)
                            .font(.headline)
                        Text(strings.sequence(store.lastSyncSequence))
                            .foregroundStyle(.secondary)
                        if store.requiresSnapshotRefresh {
                            Text(strings.snapshotRefreshRequired)
                                .foregroundStyle(.orange)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle(strings.overviewTitle)
        }
    }

    private var activeProjectCount: Int {
        store.projects.filter { $0.status == .active }.count
    }

    private var pendingApprovalCount: Int {
        store.approvals.filter { $0.status == .pending }.count
    }

    private var runningLoopCount: Int {
        store.loops.filter { $0.status == .running }.count
    }
}

private struct TasksView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var activeConversationId: String?
    @State private var mainSection: TaskSidebarSection = .tasks
    @State private var showsTaskSidebar = false
    @State private var sidebarSection: TaskSidebarSection = .tasks
    @State private var showsComposerContext = false
    @State private var selectedArtifactRoute: ArtifactPreviewRoute?
    @State private var pendingSelectedArtifactRoute: ArtifactPreviewRoute?
    @State private var selectedMainProjectId: String?
    @State private var selectedMainAutomationId: String?

    var body: some View {
        NavigationStack {
            ZStack(alignment: .leading) {
                VStack(spacing: 0) {
                    ClaudeTaskTopBar(
                        title: activeConversation?.title ?? mainSection.title(strings: strings),
                        isDetail: activeConversation != nil,
                        strings: strings,
                        onMenu: openTaskSidebar,
                        onBack: closeConversation,
                        onNewTask: startNewTask
                    )
                    Divider()

                    if !store.isDesktopConnected {
                        ConnectionRequiredBanner(strings: strings, openSettings: openSettings)
                            .padding()
                    }

                    mainContent

                    if let errorMessage = store.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .padding(.horizontal)
                            .padding(.bottom, 8)
                    }
                }

                if showsTaskSidebar {
                    TaskSidebarOverlay(
                        store: store,
                        strings: strings,
                        selectedSection: $sidebarSection,
                        onClose: closeTaskSidebar,
                        onOpenSection: openMainSection,
                        onOpenConversation: openConversation,
                        onStartNewTask: startNewTask
                    )
                    .transition(.move(edge: .leading).combined(with: .opacity))
                    .zIndex(10)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !showsTaskSidebar && shouldShowTaskInputBar {
                    TaskInputBar(
                        draft: $draft,
                        strings: strings,
                        isSending: store.isSending,
                        isConnected: store.isDesktopConnected,
                        onAddContext: {
                            showsComposerContext = true
                        },
                        onSubmit: submitDraft
                    )
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showsComposerContext) {
                ComposerContextSheet(strings: strings)
            }
            .fullScreenCover(item: $selectedArtifactRoute, onDismiss: presentPendingArtifactIfNeeded) { route in
                ArtifactPreviewSheet(store: store, artifact: route.artifact, strings: strings)
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase != .active else {
                    return
                }
                resetTransientTaskState()
            }
            .onDisappear {
                showsTaskSidebar = false
            }
        }
    }

    private var conversationBackGesture: some Gesture {
        DragGesture(minimumDistance: 30)
            .onEnded { value in
                guard value.translation.width > 80,
                      abs(value.translation.height) < 80 else {
                    return
                }
                closeConversation()
            }
    }

    private var activeConversation: ConversationSummary? {
        guard let activeConversationId else {
            return nil
        }
        return store.conversations.first { $0.id == activeConversationId }
    }

    private var shouldShowTaskInputBar: Bool {
        activeConversationId != nil || mainSection == .tasks
    }

    @ViewBuilder
    private var mainContent: some View {
        if let conversation = activeConversation {
            ConversationDetailView(
                store: store,
                conversation: conversation,
                strings: strings,
                onOpenArtifact: { artifact in
                    openArtifact(artifact)
                }
            )
            .simultaneousGesture(conversationBackGesture)
        } else {
            switch mainSection {
            case .tasks:
                NewTaskComposerView(strings: strings)
            case .projects:
                TaskProjectsMainView(
                    store: store,
                    strings: strings,
                    selectedProjectId: $selectedMainProjectId,
                    onOpenArtifact: { artifact in
                        openArtifact(artifact)
                    }
                )
            case .artifacts:
                TaskArtifactsMainView(
                    store: store,
                    strings: strings,
                    onOpenArtifact: { artifact in
                        openArtifact(artifact)
                    }
                )
            case .approvals:
                TaskApprovalsMainView(store: store, strings: strings)
            case .knowledge:
                TaskKnowledgeMainView(strings: strings)
            case .automations:
                TaskAutomationsMainView(
                    store: store,
                    strings: strings,
                    selectedAutomationId: $selectedMainAutomationId
                )
            case .settings:
                TaskSettingsMainView(store: store, strings: strings)
            }
        }
    }

    private func openTaskSidebar() {
        sidebarSection = activeConversationId == nil ? mainSection : .tasks
        withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) {
            showsTaskSidebar = true
        }
    }

    private func closeTaskSidebar() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.95)) {
            showsTaskSidebar = false
        }
    }

    private func openConversation(_ conversationId: String) {
        mainSection = .tasks
        selectedMainProjectId = nil
        selectedMainAutomationId = nil
        activeConversationId = conversationId
        closeTaskSidebar()
        store.selectConversation(conversationId)
    }

    private func openMainSection(_ section: TaskSidebarSection) {
        activeConversationId = nil
        mainSection = section
        selectedMainProjectId = nil
        selectedMainAutomationId = nil
        closeTaskSidebar()
    }

    private func openSettings() {
        openMainSection(.settings)
    }

    private func closeConversation() {
        activeConversationId = nil
        showsTaskSidebar = false
    }

    private func startNewTask() {
        activeConversationId = nil
        mainSection = .tasks
        selectedMainProjectId = nil
        selectedMainAutomationId = nil
        closeTaskSidebar()
    }

    private func resetTransientTaskState() {
        activeConversationId = nil
        mainSection = .tasks
        selectedMainProjectId = nil
        selectedMainAutomationId = nil
        showsTaskSidebar = false
    }

    private func submitDraft() {
        let text = draft
        draft = ""
        Task { @MainActor in
            await store.sendMessage(text)
            if let selectedConversationId = store.selectedConversationId {
                activeConversationId = selectedConversationId
                mainSection = .tasks
                selectedMainProjectId = nil
                selectedMainAutomationId = nil
                showsTaskSidebar = false
            }
        }
    }

    private func openArtifact(_ artifact: DesktopArtifactSummary) {
        let route = ArtifactPreviewRoute(artifact: artifact)
        guard selectedArtifactRoute == nil else {
            pendingSelectedArtifactRoute = route
            selectedArtifactRoute = nil
            Task { @MainActor in
                await Task.yield()
                presentPendingArtifactIfNeeded()
            }
            return
        }
        selectedArtifactRoute = route
    }

    private func presentPendingArtifactIfNeeded() {
        guard let route = pendingSelectedArtifactRoute else {
            return
        }
        pendingSelectedArtifactRoute = nil
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            selectedArtifactRoute = route
        }
    }
}

private struct ClaudeTaskTopBar: View {
    let title: String
    let isDetail: Bool
    let strings: AppStrings
    let onMenu: () -> Void
    let onBack: () -> Void
    let onNewTask: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if isDetail {
                Button {
                    onBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.body.weight(.semibold))
                        .frame(width: 34, height: 34)
                }
                .accessibilityLabel(strings.back)
                .accessibilityIdentifier("ConversationBackButton")
            } else {
                Button {
                    onMenu()
                } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.body.weight(.semibold))
                        .frame(width: 34, height: 34)
                }
                .accessibilityLabel(strings.taskHistoryTitle)
                .accessibilityIdentifier("TaskMenuButton")
            }

            Text(title)
                .font(.headline.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("ConversationTopBarTitle")

            if isDetail {
                Button {
                    onMenu()
                } label: {
                    Image(systemName: "sidebar.left")
                        .font(.body.weight(.semibold))
                        .frame(width: 34, height: 34)
                }
                .accessibilityLabel(strings.taskHistoryTitle)
                .accessibilityIdentifier("TaskMenuButton")
            }

            Button {
                onNewTask()
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.body.weight(.semibold))
                    .frame(width: 34, height: 34)
            }
            .accessibilityLabel(strings.newTask)
            .accessibilityIdentifier("NewTaskButton")
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 9)
        .background(Color(uiColor: .systemBackground).opacity(0.96))
    }
}

private struct NewTaskComposerView: View {
    let strings: AppStrings

    var body: some View {
        VStack(spacing: 14) {
            Spacer()

            ClaudeWelcomeMark()

            VStack(spacing: 10) {
                Text(strings.taskWelcomeTitle)
                    .font(.title3.weight(.medium))
                    .multilineTextAlignment(.center)
                Text(strings.taskWelcomeSubtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            .padding(.horizontal)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("NewTaskEmptyState")
    }
}

private struct TaskInputBar: View {
    @Binding var draft: String
    let strings: AppStrings
    let isSending: Bool
    let isConnected: Bool
    let onAddContext: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField(strings.messagePlaceholder, text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 2)
                .accessibilityIdentifier("MessageInput")

            HStack(spacing: 10) {
                Button {
                    onAddContext()
                } label: {
                    Image(systemName: "plus")
                        .font(.body.weight(.semibold))
                        .frame(width: 32, height: 32)
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(strings.addTaskContext)
                .accessibilityIdentifier("AddTaskContextButton")

                Text(strings.taskModeAsk)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Color(uiColor: .tertiarySystemFill))
                    .clipShape(Capsule())
                    .accessibilityIdentifier("TaskModePill")

                Spacer()

                Button {
                    onSubmit()
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.body.weight(.semibold))
                        .frame(width: 38, height: 38)
                        .foregroundStyle(.white)
                        .background(isSubmitDisabled ? Color.secondary.opacity(0.35) : Color.accentColor)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(isSubmitDisabled)
                .accessibilityLabel(strings.send)
                .accessibilityIdentifier("SendMessageButton")
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Color(uiColor: .systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 0.7)
        )
        .shadow(color: .black.opacity(0.08), radius: 16, y: 7)
        .padding(.horizontal)
        .padding(.vertical, 7)
        .background(.bar)
    }

    private var isSubmitDisabled: Bool {
        !isConnected || isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private struct ClaudeWelcomeMark: View {
    var body: some View {
        Image(systemName: "sparkle")
            .font(.title2.weight(.semibold))
            .foregroundStyle(Color.orange)
            .frame(width: 40, height: 40)
            .accessibilityHidden(true)
    }
}

private struct ComposerContextSheet: View {
    let strings: AppStrings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .frame(width: 36, height: 36)
                        .background(Color(uiColor: .secondarySystemBackground))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(strings.done)

                Spacer()

                Text(strings.composerContextTitle)
                    .font(.headline.weight(.semibold))

                Spacer()

                Color.clear
                    .frame(width: 36, height: 36)
            }

            VStack(spacing: 10) {
                ComposerContextRow(
                    icon: "desktopcomputer",
                    title: strings.composerContextDesktop,
                    detail: strings.composerContextDesktopDetail
                )
                ComposerContextRow(
                    icon: "shippingbox",
                    title: strings.composerContextArtifacts,
                    detail: strings.composerContextArtifactsDetail
                )
                ComposerContextRow(
                    icon: "wrench.and.screwdriver",
                    title: strings.composerContextToolAccess,
                    detail: strings.composerContextToolAccessDetail
                )
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, 18)
        .padding(.bottom, 12)
        .presentationDetents([.height(310), .medium])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("ComposerContextSheet")
    }
}

private struct ComposerContextRow: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .background(Color(uiColor: .tertiarySystemFill))
                .clipShape(RoundedRectangle(cornerRadius: 10))

            Text(title)
                .font(.body.weight(.medium))

            Spacer(minLength: 8)

            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private struct ConversationDetailView: View {
    @ObservedObject var store: XiaokAppStore
    let conversation: ConversationSummary
    let strings: AppStrings
    let onOpenArtifact: (DesktopArtifactSummary) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ConversationSummaryHeader(conversation: conversation, strings: strings)

                    let artifacts = store.artifacts(for: conversation.id)
                    if !artifacts.isEmpty {
                        ArtifactAttachmentStrip(
                            artifacts: artifacts,
                            strings: strings,
                            onOpenArtifact: onOpenArtifact
                        )
                    }

                    if store.hasMoreMessages(for: conversation.id) {
                        Button(strings.loadMore) {
                            store.showMoreMessages(for: conversation.id)
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity, alignment: .center)
                    }

                    ForEach(messageItems) { item in
                        MessageDisplayRow(item: item, strings: strings)
                            .id(item.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 18)
            }
            .accessibilityIdentifier("TaskConversationScrollView")
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                scrollToLatestMessage(using: proxy, animated: false)
            }
            .onChange(of: conversation.id) { _, _ in
                scrollToLatestMessage(using: proxy, animated: false)
            }
            .onChange(of: messageIdSignature) { _, _ in
                scrollToLatestMessage(using: proxy, animated: true)
            }
        }
    }

    private var messageItems: [MessageDisplayItem] {
        store.visibleMessageItems(for: conversation.id)
    }

    private var messageIdSignature: String {
        messageItems.map(\.id).joined(separator: "|")
    }

    private func scrollToLatestMessage(using proxy: ScrollViewProxy, animated: Bool) {
        guard let latestMessageId = messageItems.last?.id else {
            return
        }

        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.22)) {
                    proxy.scrollTo(latestMessageId, anchor: .bottom)
                }
            } else {
                proxy.scrollTo(latestMessageId, anchor: .bottom)
            }
        }
    }
}

private struct ConversationSummaryHeader: View {
    let conversation: ConversationSummary
    let strings: AppStrings

    var body: some View {
        HStack(spacing: 6) {
            Text(strings.conversationStatus(conversation.status))
                .foregroundStyle(statusColor)
            Text("·")
                .foregroundStyle(.tertiary)
            Text(strings.messageCount(conversation.messageCount))
                .foregroundStyle(.secondary)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusColor: Color {
        switch conversation.status {
        case .running: .blue
        case .waiting: .orange
        case .completed: .secondary
        case .failed: .red
        }
    }
}

private struct ArtifactAttachmentStrip: View {
    let artifacts: [DesktopArtifactSummary]
    let strings: AppStrings
    let onOpenArtifact: (DesktopArtifactSummary) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(strings.artifactsTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(artifacts) { artifact in
                        Button {
                            onOpenArtifact(artifact)
                        } label: {
                            ArtifactAttachmentCard(artifact: artifact, strings: strings)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("TaskConversationArtifact-\(artifact.id)")
                    }
                }
                .padding(.trailing, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ArtifactAttachmentCard: View {
    let artifact: DesktopArtifactSummary
    let strings: AppStrings

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.body.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 30, height: 30)
                .background(Color(uiColor: .tertiarySystemFill))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(ArtifactDisplayName.displayName(for: artifact, strings: strings))
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                Text("\(artifact.kind.displayText) · \(strings.artifactStatus(artifact.status))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .frame(minWidth: 210, maxWidth: 260, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground).opacity(0.82))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color(uiColor: .separator).opacity(0.25), lineWidth: 0.7)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .contentShape(RoundedRectangle(cornerRadius: 14))
    }

    private var iconName: String {
        switch artifact.kind {
        case .markdown, .text:
            "doc.text"
        case .pdf:
            "doc.richtext"
        case .pptx:
            "rectangle.on.rectangle.angled"
        case .html:
            "chevron.left.forwardslash.chevron.right"
        case .image:
            "photo"
        case .other:
            "doc"
        }
    }
}

private struct WorkView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @State private var selectedArtifactRoute: ArtifactPreviewRoute?

    var body: some View {
        NavigationStack {
            List {
                Section(strings.projects) {
                    if store.isLoadingSnapshot && store.projects.isEmpty {
                        HStack {
                            ProgressView()
                            Text(strings.refreshing)
                                .foregroundStyle(.secondary)
                        }
                    }

                    ForEach(store.visibleProjects) { project in
                        NavigationLink {
                            ProjectDetailView(
                                project: project,
                                artifacts: relatedArtifacts(for: project),
                                strings: strings,
                                onOpenArtifact: { artifact in
                                    selectedArtifactRoute = ArtifactPreviewRoute(artifact: artifact)
                                }
                            )
                        } label: {
                            ProjectRow(project: project, strings: strings)
                        }
                    }

                    if store.hasMoreProjects {
                        Button(strings.loadMore) {
                            store.showMoreProjects()
                        }
                    }
                }

                Section(strings.loops) {
                    ForEach(store.loops) { loop in
                        LoopRow(loop: loop, strings: strings)
                    }
                }

                Section(strings.artifactsTitle) {
                    ForEach(store.artifacts) { artifact in
                        Button {
                            selectedArtifactRoute = ArtifactPreviewRoute(artifact: artifact)
                        } label: {
                            ArtifactRow(artifact: artifact, strings: strings)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle(strings.workTitle)
            .fullScreenCover(item: $selectedArtifactRoute) { route in
                ArtifactPreviewSheet(store: store, artifact: route.artifact, strings: strings)
            }
        }
    }

    private func relatedArtifacts(for project: DesktopProjectSummary) -> [DesktopArtifactSummary] {
        store.artifacts.filter { artifact in
            artifact.source == project.id || artifact.source == project.name
        }
    }
}

private struct ApprovalsView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings

    var body: some View {
        NavigationStack {
            List {
                if store.approvals.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(strings.approvalEmptyTitle)
                            .font(.headline)
                        Text(strings.approvalEmptyMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                    .accessibilityElement(children: .combine)
                }

                ForEach(store.approvals) { approval in
                    ApprovalRow(
                        approval: approval,
                        strings: strings,
                        isResponding: store.respondingApprovalIds.contains(approval.id),
                        onApprove: {
                            Task {
                                await store.respondToApproval(id: approval.id, decision: .approve)
                            }
                        },
                        onReject: {
                            Task {
                                await store.respondToApproval(id: approval.id, decision: .reject)
                            }
                        }
                    )
                }
            }
            .navigationTitle(strings.approvalsTitle)
        }
    }
}

private struct TaskSidebarOverlay: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @Binding var selectedSection: TaskSidebarSection
    let onClose: () -> Void
    let onOpenSection: (TaskSidebarSection) -> Void
    let onOpenConversation: (String) -> Void
    let onStartNewTask: () -> Void

    var body: some View {
        GeometryReader { proxy in
            let sidebarWidth = min(proxy.size.width * 0.82, 350)

            ZStack(alignment: .leading) {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onClose()
                    }

                TaskSidebarView(
                    store: store,
                    strings: strings,
                    selectedSection: $selectedSection,
                    onOpenSection: onOpenSection,
                    onOpenConversation: onOpenConversation,
                    onStartNewTask: onStartNewTask
                )
                .frame(width: sidebarWidth)
                .frame(maxHeight: .infinity)
                .background(Color(uiColor: .systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                .shadow(color: .black.opacity(0.16), radius: 18, x: 8, y: 0)
            }
        }
    }
}

private struct TaskSidebarView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @Binding var selectedSection: TaskSidebarSection
    let onOpenSection: (TaskSidebarSection) -> Void
    let onOpenConversation: (String) -> Void
    let onStartNewTask: () -> Void
    @State private var searchText = ""
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(strings.appTitle)
                .font(.largeTitle.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 22)
                .padding(.top, 26)

            if !isSearchingTasks {
                sidebarNavigation
                    .padding(.horizontal, 18)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    tasksSection
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 18)
            }
            .id(selectedSection)

            Button {
                onStartNewTask()
            } label: {
                Label(strings.newTask, systemImage: "plus")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .foregroundStyle(.white)
                    .background(Color(uiColor: .label))
                    .clipShape(Capsule())
            }
            .accessibilityIdentifier("TaskSidebarNewTaskButton")
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }

    private var sidebarNavigation: some View {
        VStack(spacing: 4) {
            ForEach(TaskSidebarSection.allCases, id: \.self) { section in
                TaskSidebarNavButton(
                    section: section,
                    isSelected: selectedSection == section,
                    strings: strings
                ) {
                    onOpenSection(section)
                }
            }
        }
    }

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField(strings.taskHistorySearchPlaceholder, text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($isSearchFocused)
                    .accessibilityIdentifier("TaskHistorySearchInput")

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                        isSearchFocused = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityLabel(strings.clearSearch)
                    .accessibilityIdentifier("TaskHistorySearchClearButton")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color(uiColor: .secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))

            if store.isLoadingSnapshot && store.conversations.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(strings.refreshing)
                        .foregroundStyle(.secondary)
                }
                .font(.footnote)
            } else if filteredConversations.isEmpty {
                Text(strings.noTasks)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let pinnedConversation {
                TaskSidebarSectionLabel(title: strings.taskHistoryPinnedTitle)
                conversationButton(pinnedConversation)
            }

            TaskSidebarSectionLabel(title: strings.taskHistoryRecentsTitle)
            ForEach(recentConversations) { conversation in
                conversationButton(conversation)
            }

            if store.hasMoreConversations {
                Button(strings.loadMore) {
                    store.showMoreConversations()
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var pinnedConversation: ConversationSummary? {
        filteredConversations.first
    }

    private var recentConversations: [ConversationSummary] {
        guard pinnedConversation != nil else {
            return filteredConversations
        }
        return Array(filteredConversations.dropFirst())
    }

    private var isSearchingTasks: Bool {
        isSearchFocused || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder
    private func conversationButton(_ conversation: ConversationSummary) -> some View {
        Button {
            onOpenConversation(conversation.id)
        } label: {
            ConversationRow(conversation: conversation, strings: strings)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("TaskSidebarConversation-\(conversation.id)")
    }

    private var filteredConversations: [ConversationSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return store.visibleConversations
        }

        return store.visibleConversations.filter { conversation in
            conversation.title.localizedCaseInsensitiveContains(query)
                || conversation.lastMessagePreview.localizedCaseInsensitiveContains(query)
        }
    }

}

private struct TaskSidebarNavButton: View {
    let section: TaskSidebarSection
    let isSelected: Bool
    let strings: AppStrings
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 14) {
                Image(systemName: section.icon)
                    .font(.body.weight(.medium))
                    .frame(width: 24)
                Text(section.title(strings: strings))
                    .font(.title3.weight(.medium))
                Spacer()
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(isSelected ? Color(uiColor: .secondarySystemBackground) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("TaskSidebar\(section.accessibilitySuffix)")
    }
}

private struct TaskSidebarSectionLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 6)
    }
}

private struct TaskProjectsMainView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @Binding var selectedProjectId: String?
    let onOpenArtifact: (DesktopArtifactSummary) -> Void

    var body: some View {
        if let project = selectedProject {
            VStack(spacing: 0) {
                TaskMainBackButton(title: strings.projects, strings: strings) {
                    selectedProjectId = nil
                }
                ProjectDetailView(
                    project: project,
                    artifacts: relatedArtifacts(for: project),
                    strings: strings,
                    onOpenArtifact: onOpenArtifact
                )
            }
        } else {
            List {
                Section(strings.projects) {
                    if store.isLoadingSnapshot && store.projects.isEmpty {
                        HStack {
                            ProgressView()
                            Text(strings.refreshing)
                                .foregroundStyle(.secondary)
                        }
                    } else if store.visibleProjects.isEmpty {
                        Text(strings.taskSidebarEmptyProjects)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(store.visibleProjects) { project in
                        Button {
                            selectedProjectId = project.id
                        } label: {
                            ProjectRow(project: project, strings: strings)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("TaskMainProject-\(project.id)")
                    }

                    if store.hasMoreProjects {
                        Button(strings.loadMore) {
                            store.showMoreProjects()
                        }
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private var selectedProject: DesktopProjectSummary? {
        guard let selectedProjectId else {
            return nil
        }
        return store.projects.first { $0.id == selectedProjectId }
    }

    private func relatedArtifacts(for project: DesktopProjectSummary) -> [DesktopArtifactSummary] {
        store.artifacts.filter { artifact in
            artifact.source == project.id || artifact.source == project.name
        }
    }
}

private struct TaskArtifactsMainView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    let onOpenArtifact: (DesktopArtifactSummary) -> Void

    var body: some View {
        List {
            Section(strings.artifactsTitle) {
                if store.artifacts.isEmpty {
                    Text(strings.noFiles)
                        .foregroundStyle(.secondary)
                }

                ForEach(store.artifacts) { artifact in
                    Button {
                        onOpenArtifact(artifact)
                    } label: {
                        ArtifactRow(artifact: artifact, strings: strings)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("TaskMainArtifact-\(artifact.id)")
                }
            }
        }
        .listStyle(.plain)
    }
}

private struct TaskKnowledgeMainView: View {
    let strings: AppStrings

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(strings.knowledgeTitle)
                    .font(.title2.weight(.semibold))
                CardSection {
                    Text(strings.knowledgeEmptyTitle)
                        .font(.headline)
                    Text(strings.knowledgeEmptyMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
    }
}

private struct TaskAutomationsMainView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @Binding var selectedAutomationId: String?

    var body: some View {
        if let loop = selectedAutomation {
            VStack(spacing: 0) {
                TaskMainBackButton(title: strings.automationsTitle, strings: strings) {
                    selectedAutomationId = nil
                }
                List {
                    Section(strings.automationsTitle) {
                        LoopRow(loop: loop, strings: strings)
                    }
                }
                .listStyle(.plain)
            }
        } else {
            List {
                Section(strings.automationsTitle) {
                    if store.loops.isEmpty {
                        Text(strings.taskSidebarEmptyAutomations)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(store.loops) { loop in
                        Button {
                            selectedAutomationId = loop.id
                        } label: {
                            LoopRow(loop: loop, strings: strings)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("TaskMainAutomation-\(loop.id)")
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private var selectedAutomation: LoopSummary? {
        guard let selectedAutomationId else {
            return nil
        }
        return store.loops.first { $0.id == selectedAutomationId }
    }
}

private struct TaskApprovalsMainView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings

    var body: some View {
        List {
            if store.approvals.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(strings.approvalEmptyTitle)
                        .font(.headline)
                    Text(strings.approvalEmptyMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 8)
                .accessibilityElement(children: .combine)
            }

            ForEach(store.approvals) { approval in
                ApprovalRow(
                    approval: approval,
                    strings: strings,
                    isResponding: store.respondingApprovalIds.contains(approval.id),
                    onApprove: {
                        Task {
                            await store.respondToApproval(id: approval.id, decision: .approve)
                        }
                    },
                    onReject: {
                        Task {
                            await store.respondToApproval(id: approval.id, decision: .reject)
                        }
                    }
                )
            }
        }
        .listStyle(.plain)
    }
}

private struct TaskSettingsMainView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @State private var gatewayDraft = ""
    @State private var showsPairingScanner = false

    var body: some View {
        Form {
            Section(strings.desktopConnection) {
                HStack {
                    Text(store.desktopName)
                    Spacer()
                    Text(strings.desktopHealth(store.health))
                        .foregroundStyle(store.isDesktopConnected ? .green : .secondary)
                }

                TextField(strings.gatewayURLPlaceholder, text: $gatewayDraft)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .accessibilityIdentifier("GatewayURLInput")

                Button {
                    guard store.updateGatewayURL(gatewayDraft) else {
                        return
                    }

                    Task {
                        await store.loadInitialSnapshot()
                    }
                } label: {
                    Label(strings.connectToDesktop, systemImage: "link")
                }
                .accessibilityIdentifier("ConnectToDesktopButton")

                Button {
                    showsPairingScanner = true
                } label: {
                    Label(strings.scanPairingQRCode, systemImage: "qrcode.viewfinder")
                }
                .accessibilityIdentifier("ScanPairingQRCodeButton")

                Text(strings.connectionHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let errorMessage = store.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            Section(strings.language) {
                Picker(strings.language, selection: languageBinding) {
                    Text(strings.systemLanguage).tag(AppLanguage.system)
                    Text(strings.simplifiedChinese).tag(AppLanguage.simplifiedChinese)
                    Text(strings.english).tag(AppLanguage.english)
                }
                .pickerStyle(.segmented)
            }

            Section(strings.diagnostics) {
                LabeledContent(strings.currentGateway, value: store.gatewayURLString)
                LabeledContent(strings.currentRoute, value: strings.connectionRoute(store.connectionRoute))
            }
        }
        .onAppear {
            gatewayDraft = store.gatewayURLString
        }
        .onChange(of: store.gatewayURLString) { _, value in
            gatewayDraft = value
        }
        .sheet(isPresented: $showsPairingScanner) {
            PairingScannerSheet(store: store, strings: strings)
        }
    }

    private var languageBinding: Binding<AppLanguage> {
        Binding(
            get: { store.language },
            set: { store.updateLanguage($0) }
        )
    }
}

private struct TaskMainBackButton: View {
    let title: String
    let strings: AppStrings
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: "chevron.left")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(strings.back)
        .accessibilityIdentifier("TaskMainBackButton")
    }
}

private extension TaskSidebarSection {
    var accessibilitySuffix: String {
        switch self {
        case .tasks:
            "Tasks"
        case .projects:
            "Projects"
        case .artifacts:
            "Artifacts"
        case .approvals:
            "Approvals"
        case .knowledge:
            "Knowledge"
        case .automations:
            "Automations"
        case .settings:
            "Settings"
        }
    }
}

private struct ProjectDetailView: View {
    let project: DesktopProjectSummary
    let artifacts: [DesktopArtifactSummary]
    let strings: AppStrings
    let onOpenArtifact: (DesktopArtifactSummary) -> Void

    var body: some View {
        List {
            Section(strings.projectDetails) {
                if let goal = project.nonEmptyGoal {
                    ProjectTextBlock(title: strings.goal, text: goal)
                }
                if let requirements = project.nonEmptyRequirements {
                    ProjectTextBlock(title: strings.requirements, text: requirements)
                }
                if let summary = project.nonEmptySummary {
                    ProjectTextBlock(title: strings.summary, text: summary)
                }
                LabeledContent(strings.progress) {
                    Text(project.progress, format: .percent.precision(.fractionLength(0)))
                }
                ProgressView(value: project.progress)
                LabeledContent(strings.activeTasks(project.activeTasks), value: strings.projectStatus(project.status))
                if let taskCount = project.taskCount {
                    LabeledContent(strings.projectTaskStats(project.doneCount ?? 0, taskCount, project.stoppedCount ?? 0), value: strings.projectStatus(project.status))
                }
                HStack {
                    Text(strings.artifactsTitle)
                    Spacer()
                    Text(strings.artifactCount(resolvedArtifactCount))
                        .foregroundStyle(.secondary)
                }
                LabeledContent(strings.lastUpdated, value: project.updatedAt.formatted(date: .abbreviated, time: .shortened))
            }

            Section(strings.artifactsTitle) {
                if artifacts.isEmpty {
                    Text(strings.noFiles)
                        .foregroundStyle(.secondary)
                }

                ForEach(artifacts) { artifact in
                    Button {
                        onOpenArtifact(artifact)
                    } label: {
                        ArtifactRow(artifact: artifact, strings: strings)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle(project.name)
    }

    private var resolvedArtifactCount: Int {
        max(project.artifactCount ?? 0, artifacts.count)
    }
}

private struct ProjectTextBlock: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(text)
                .font(.body)
                .textSelection(.enabled)
        }
    }
}

private extension DesktopProjectSummary {
    var nonEmptyGoal: String? {
        goal?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyPrefix(maxLength: 600)
    }

    var nonEmptyRequirements: String? {
        requirements?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyPrefix(maxLength: 900)
    }

    var nonEmptySummary: String? {
        summary?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmptyPrefix(maxLength: 900)
    }
}

private struct ArtifactPreviewRoute: Identifiable {
    let id = UUID()
    let artifact: DesktopArtifactSummary
}

private struct ArtifactPreviewSheet: View {
    @ObservedObject var store: XiaokAppStore
    let artifact: DesktopArtifactSummary
    let strings: AppStrings
    @Environment(\.dismiss) private var dismiss
    @State private var preview: ArtifactPreview?
    @State private var previewFileURL: URL?
    @State private var sharePayload: ArtifactSharePayload?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            previewBody
            .navigationTitle(strings.artifactPreviewTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(strings.done) {
                        dismiss()
                    }
                }
            }
            .task(id: artifact.id) {
                await loadPreview()
            }
            .sheet(item: $sharePayload) { payload in
                ActivityView(activityItems: payload.items)
            }
        }
    }

    @ViewBuilder
    private var previewBody: some View {
        if isLoading {
            VStack(spacing: 12) {
                ProgressView()
                Text(strings.refreshing)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let preview {
            ArtifactPreviewContent(
                preview: preview,
                fileURL: previewFileURL,
                strings: strings,
                onShare: {
                    sharePayload = ArtifactSharePayload(items: shareItems(for: preview))
                }
            )
        } else {
            Text(errorMessage ?? strings.artifactPreviewUnavailable)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
        }
    }

    private func loadPreview() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loadedPreview = try await store.fetchArtifactPreview(id: artifact.id)
            preview = loadedPreview
            previewFileURL = writePreviewFileIfNeeded(loadedPreview)
            errorMessage = nil
        } catch {
            errorMessage = strings.artifactPreviewUnavailable
        }
    }

    private func writePreviewFileIfNeeded(_ preview: ArtifactPreview) -> URL? {
        guard let dataBase64 = preview.dataBase64,
              let data = Data(base64Encoded: dataBase64) else {
            return nil
        }
        let rawName = preview.fileName ?? ArtifactDisplayName.displayName(for: preview.artifact, strings: strings)
        let safeName = rawName
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("xiaok-mobile-preview-\(preview.artifact.id)-\(safeName)")
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private func shareItems(for preview: ArtifactPreview) -> [Any] {
        if let previewFileURL {
            return [previewFileURL]
        }
        let name = ArtifactDisplayName.displayName(for: preview.artifact, strings: strings)
        return ["\(name)\n\(preview.artifact.kind.displayText)\n\(preview.contentType)"]
    }
}

private struct ArtifactPreviewContent: View {
    let preview: ArtifactPreview
    let fileURL: URL?
    let strings: AppStrings
    let onShare: () -> Void

    var body: some View {
        Group {
            if isHTMLPreview, let html = preview.text, !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                HTMLArtifactPreview(html: html)
                    .ignoresSafeArea(edges: .bottom)
            } else if let fileURL, shouldUseSystemPreview {
                QuickLookArtifactPreview(fileURL: fileURL)
                    .ignoresSafeArea(edges: .bottom)
            } else if isTextPreview,
                      let text = preview.text,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ScrollView {
                    MessageBodyView(text: text, strings: strings)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ArtifactFileInfoView(
                    preview: preview,
                    strings: strings,
                    onShare: onShare
                )
            }
        }
    }

    private var isHTMLPreview: Bool {
        preview.artifact.kind == .html || preview.contentType == "text/html"
    }

    private var isTextPreview: Bool {
        preview.artifact.kind == .markdown
            || preview.artifact.kind == .text
            || preview.contentType.hasPrefix("text/")
    }

    private var shouldUseSystemPreview: Bool {
        preview.artifact.kind == .pdf
            || preview.artifact.kind == .pptx
            || preview.artifact.kind == .image
            || preview.contentType == "application/pdf"
            || preview.contentType.hasPrefix("image/")
            || preview.contentType.contains("officedocument")
    }
}

private struct ArtifactFileInfoView: View {
    let preview: ArtifactPreview
    let strings: AppStrings
    let onShare: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: iconName)
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 76, height: 76)
                .background(Color(uiColor: .secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            Text(strings.artifactFileInfoTitle)
                .font(.title3.weight(.semibold))

            Text(ArtifactDisplayName.displayName(for: preview.artifact, strings: strings))
                .font(.body.weight(.medium))
                .multilineTextAlignment(.center)

            Text("\(preview.artifact.kind.displayText) · \(preview.contentType)")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Text(strings.artifactFileInfoMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                onShare()
            } label: {
                Label(strings.openOrSaveArtifact, systemImage: "square.and.arrow.up")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("OpenOrSaveArtifactButton")
            .padding(.horizontal)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var iconName: String {
        switch preview.artifact.kind {
        case .pdf:
            "doc.richtext"
        case .pptx:
            "rectangle.on.rectangle.angled"
        case .image:
            "photo"
        case .html:
            "chevron.left.forwardslash.chevron.right"
        case .markdown, .text:
            "doc.text"
        case .other:
            "doc"
        }
    }
}

private struct HTMLArtifactPreview: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.backgroundColor = .systemBackground
        webView.isOpaque = false
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        webView.loadHTMLString(html, baseURL: nil)
    }
}

private struct QuickLookArtifactPreview: UIViewControllerRepresentable {
    let fileURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(fileURL: fileURL)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.fileURL = fileURL
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var fileURL: URL

        init(fileURL: URL) {
            self.fileURL = fileURL
        }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
            1
        }

        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            fileURL as NSURL
        }
    }
}

private struct ActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct ArtifactSharePayload: Identifiable {
    let id = UUID()
    let items: [Any]
}

private struct PairingScannerSheet: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var successMessage: String?

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                QRCodeScannerView(
                    onCodeScanned: handleScannedCode,
                    onUnavailable: {
                        errorMessage = strings.pairingScannerUnavailable
                    }
                )
                .ignoresSafeArea()

                VStack {
                    Spacer()
                    Color.clear
                        .frame(width: 240, height: 240)
                        .overlay(
                            RoundedRectangle(cornerRadius: 18)
                                .stroke(.white, lineWidth: 3)
                        )
                        .shadow(radius: 6)
                        .accessibilityElement()
                        .accessibilityIdentifier("PairingQRCodeFrame")
                        .accessibilityLabel(strings.pairingQRCodeFrameLabel)
                    Spacer()
                }
                .padding(.bottom, 80)

                VStack(alignment: .leading, spacing: 8) {
                    Text(strings.pairingQRCodeFrameLabel)
                        .font(.footnote.weight(.medium))
                    Text(strings.pairingQRCodeHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let successMessage {
                        Label(successMessage, systemImage: "checkmark.circle.fill")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.green)
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.red)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.thinMaterial)
            }
            .navigationTitle(strings.pairingQRCodeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(strings.done) {
                        dismiss()
                    }
                }
            }
        }
    }

    private func handleScannedCode(_ code: String) {
        guard let url = URL(string: code), store.applyPairingURL(url) else {
            successMessage = nil
            errorMessage = strings.invalidPairingQRCode
            return
        }

        errorMessage = nil
        successMessage = strings.pairingSucceededMessage
        Task {
            await store.loadInitialSnapshot()
            try? await Task.sleep(nanoseconds: 700_000_000)
            dismiss()
        }
    }
}

private struct QRCodeScannerView: UIViewControllerRepresentable {
    let onCodeScanned: (String) -> Void
    let onUnavailable: () -> Void

    func makeUIViewController(context: Context) -> QRCodeScannerViewController {
        QRCodeScannerViewController(onCodeScanned: onCodeScanned, onUnavailable: onUnavailable)
    }

    func updateUIViewController(_ uiViewController: QRCodeScannerViewController, context: Context) {}
}

private final class QRCodeScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "xiaok.mobile.qr-scanner")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private let onCodeScanned: (String) -> Void
    private let onUnavailable: () -> Void
    private var didScan = false
    private var didReportUnavailable = false

    init(onCodeScanned: @escaping (String) -> Void, onUnavailable: @escaping () -> Void) {
        self.onCodeScanned = onCodeScanned
        self.onUnavailable = onUnavailable
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        if let testCode = Self.testScannedQRCode {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.emitScannedCode(testCode)
            }
            return
        }
        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !didScan,
              let code = metadataObjects
                .compactMap({ $0 as? AVMetadataMachineReadableCodeObject })
                .first(where: { $0.type == .qr })?
                .stringValue else {
            return
        }

        emitScannedCode(code)
    }

    deinit {
        sessionQueue.async { [session] in
            if session.isRunning {
                session.stopRunning()
            }
        }
    }

    private func configureSession() {
        guard let device = AVCaptureDevice.default(for: .video) else {
            reportUnavailable()
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else {
                reportUnavailable()
                return
            }
            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                reportUnavailable()
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]

            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            view.layer.addSublayer(layer)
            previewLayer = layer

            sessionQueue.async { [session] in
                session.startRunning()
            }
        } catch {
            reportUnavailable()
        }
    }

    private func emitScannedCode(_ code: String) {
        guard !didScan else {
            return
        }
        didScan = true
        sessionQueue.async { [session] in
            if session.isRunning {
                session.stopRunning()
            }
        }
        onCodeScanned(code)
    }

    private func reportUnavailable() {
        guard !didReportUnavailable else {
            return
        }
        didReportUnavailable = true
        onUnavailable()
    }

    private static var testScannedQRCode: String? {
        let environment = ProcessInfo.processInfo.environment
        guard environment["XIAOK_MOBILE_TEST_MODE"] == "1" else {
            return nil
        }
        let value = environment["XIAOK_MOBILE_TEST_SCANNED_QR_CODE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }
}

private struct SettingsView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @State private var gatewayDraft = ""
    @State private var showsPairingScanner = false

    var body: some View {
        NavigationStack {
            Form {
                Section(strings.desktopConnection) {
                    HStack {
                        Text(store.desktopName)
                        Spacer()
                        Text(strings.desktopHealth(store.health))
                            .foregroundStyle(store.isDesktopConnected ? .green : .secondary)
                    }

                    TextField(strings.gatewayURLPlaceholder, text: $gatewayDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .accessibilityIdentifier("GatewayURLInput")

                    Button {
                        guard store.updateGatewayURL(gatewayDraft) else {
                            return
                        }

                        Task {
                            await store.loadInitialSnapshot()
                        }
                    } label: {
                        Label(strings.connectToDesktop, systemImage: "link")
                    }
                    .accessibilityIdentifier("ConnectToDesktopButton")

                    Button {
                        showsPairingScanner = true
                    } label: {
                        Label(strings.scanPairingQRCode, systemImage: "qrcode.viewfinder")
                    }
                    .accessibilityIdentifier("ScanPairingQRCodeButton")

                    Text(strings.connectionHint)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let errorMessage = store.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section(strings.language) {
                    Picker(strings.language, selection: languageBinding) {
                        Text(strings.systemLanguage).tag(AppLanguage.system)
                        Text(strings.simplifiedChinese).tag(AppLanguage.simplifiedChinese)
                        Text(strings.english).tag(AppLanguage.english)
                    }
                    .pickerStyle(.segmented)
                }

                Section(strings.diagnostics) {
                    LabeledContent(strings.currentGateway, value: store.gatewayURLString)
                    LabeledContent(strings.currentRoute, value: strings.connectionRoute(store.connectionRoute))
                }
            }
            .navigationTitle(strings.settingsTitle)
            .onAppear {
                gatewayDraft = store.gatewayURLString
            }
            .onChange(of: store.gatewayURLString) { _, value in
                gatewayDraft = value
            }
            .sheet(isPresented: $showsPairingScanner) {
                PairingScannerSheet(store: store, strings: strings)
            }
        }
    }

    private var languageBinding: Binding<AppLanguage> {
        Binding(
            get: { store.language },
            set: { store.updateLanguage($0) }
        )
    }
}

private struct ConnectionRequiredBanner: View {
    let strings: AppStrings
    let openSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(strings.connectToDesktop)
                .font(.headline)
            Text(strings.connectionHint)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button(action: openSettings) {
                Label(strings.openConnectionSettings, systemImage: "gearshape")
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("OpenConnectionSettingsButton")
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct SummaryTile: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ConversationRow: View {
    let conversation: ConversationSummary
    let strings: AppStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(conversation.title)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Text(strings.conversationStatus(conversation.status))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(statusColor)
            }

            if !conversation.lastMessagePreview.isEmpty {
                Text(conversation.lastMessagePreview)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Text(strings.messageCount(conversation.messageCount))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var statusColor: Color {
        switch conversation.status {
        case .running: .blue
        case .waiting: .orange
        case .completed: .secondary
        case .failed: .red
        }
    }
}

private struct MessageRow: View {
    let message: ChatMessage
    let strings: AppStrings

    var body: some View {
        Group {
            switch message.role {
            case .user:
                HStack {
                    Spacer(minLength: 48)
                    MessageBodyView(text: message.text, strings: strings)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(Color(uiColor: .secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .frame(maxWidth: 310, alignment: .leading)
                }
            case .assistant:
                VStack(alignment: .leading, spacing: 8) {
                    MessageBodyView(text: message.text, strings: strings)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    AssistantMessageActions(text: message.text, strings: strings)
                }
            case .system:
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "info.circle")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 24, height: 24)
                    MessageBodyView(text: message.text, strings: strings)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(12)
                .background(Color(uiColor: .secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
        .padding(.vertical, message.role == .assistant ? 8 : 3)
    }
}

private struct MessageDisplayRow: View {
    let item: MessageDisplayItem
    let strings: AppStrings

    var body: some View {
        switch item.kind {
        case .chat(let message):
            MessageRow(message: message, strings: strings)
        case .activity(let activity):
            MessageActivityCard(activity: activity, strings: strings)
        }
    }
}

private struct MessageActivityCard: View {
    let activity: MessageActivity
    let strings: AppStrings
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: iconName)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(statusColor)
                        .frame(width: 24, height: 24)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(activity.title)
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(2)
                        Text(strings.messageActivityStatus(activity.status))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isExpanded ? strings.hideActivityDetails : strings.showActivityDetails)
            .accessibilityIdentifier("MessageActivity-\(activity.id)")

            if isExpanded {
                Text(activity.detail)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.secondary.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier("MessageActivityDetails-\(activity.id)")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.vertical, 3)
    }

    private var iconName: String {
        switch activity.kind {
        case .skill:
            "sparkles"
        case .bash:
            "terminal"
        case .tool:
            "wrench.and.screwdriver"
        }
    }

    private var statusColor: Color {
        switch activity.status {
        case .running:
            .blue
        case .completed:
            .green
        case .failed:
            .red
        case .unknown:
            .secondary
        }
    }
}

private struct AssistantMessageActions: View {
    let text: String
    let strings: AppStrings

    var body: some View {
        HStack(spacing: 14) {
            Button {
                UIPasteboard.general.string = text
            } label: {
                Image(systemName: "doc.on.doc")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(strings.copyMessage)
            .accessibilityIdentifier("CopyMessageButton")

            Spacer(minLength: 0)
        }
        .padding(.top, 2)
    }
}

private struct MessageBodyView: View {
    let text: String
    let strings: AppStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parseMessageContent(text)) { part in
                switch part.kind {
                case .markdown:
                    MarkdownText(part.text)
                case .mermaid:
                    MermaidDiagramCard(code: part.text, strings: strings)
                }
            }
        }
    }

    private func parseMessageContent(_ text: String) -> [MessageContentPart] {
        MessageContentParser.parse(text)
    }
}

struct MessageContentPart: Identifiable, Equatable {
    enum Kind {
        case markdown
        case mermaid
    }

    let id: Int
    let kind: Kind
    let text: String

    init(id: Int = 0, kind: Kind, text: String) {
        self.id = id
        self.kind = kind
        self.text = text
    }

    static func == (lhs: MessageContentPart, rhs: MessageContentPart) -> Bool {
        lhs.kind == rhs.kind && lhs.text == rhs.text
    }
}

enum MessageContentParser {
    static func parse(_ text: String) -> [MessageContentPart] {
        var parts: [MessageContentPart] = []
        var markdownLines: [String] = []
        var mermaidLines: [String]?

        func appendPart(kind: MessageContentPart.Kind, text: String) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                return
            }
            parts.append(MessageContentPart(id: parts.count, kind: kind, text: trimmed))
        }

        func flushMarkdown() {
            appendPart(kind: .markdown, text: markdownLines.joined(separator: "\n"))
            markdownLines.removeAll()
        }

        func flushMermaid() {
            appendPart(kind: .mermaid, text: (mermaidLines ?? []).joined(separator: "\n"))
            mermaidLines = nil
        }

        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if mermaidLines == nil, trimmed.hasPrefix("```mermaid") {
                flushMarkdown()
                mermaidLines = []
                continue
            }
            if mermaidLines != nil, trimmed.hasPrefix("```") {
                flushMermaid()
                continue
            }

            if mermaidLines != nil {
                mermaidLines?.append(line)
            } else {
                markdownLines.append(line)
            }
        }

        if mermaidLines != nil {
            markdownLines.append("```mermaid")
            markdownLines.append(contentsOf: mermaidLines ?? [])
        }
        flushMarkdown()
        return parts.isEmpty ? [MessageContentPart(id: 0, kind: .markdown, text: text)] : parts
    }
}

private struct MarkdownText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(MarkdownBlockParser.parse(text)) { block in
                switch block.kind {
                case let .heading(level, value):
                    InlineMarkdownText(value)
                        .font(level == 1 ? .title3.weight(.semibold) : .headline)
                case let .paragraph(value):
                    InlineMarkdownText(value)
                        .font(.body)
                case let .bullet(value):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•")
                            .font(.body.weight(.semibold))
                        InlineMarkdownText(value)
                            .font(.body)
                    }
                case let .code(_, value):
                    Text(value)
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.secondary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

private struct InlineMarkdownText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        let segments = MarkdownInlineParser.parse(text)
        if segments.containsLink {
            WrappingHStack(alignment: .firstTextBaseline, horizontalSpacing: 0, verticalSpacing: 4) {
                ForEach(segments) { segment in
                    switch segment.kind {
                    case .text:
                        formattedText(segment.text)
                    case let .link(url):
                        Link(segment.text, destination: url)
                            .accessibilityAddTraits(.isLink)
                    }
                }
            }
        } else {
            formattedText(text)
                .textSelection(.enabled)
        }
    }

    @ViewBuilder
    private func formattedText(_ value: String) -> some View {
        if let attributed = try? AttributedString(markdown: value) {
            Text(attributed)
        } else {
            Text(value)
        }
    }
}

private struct WrappingHStack<Content: View>: View {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat
    @ViewBuilder let content: Content

    init(
        alignment _: VerticalAlignment = .center,
        horizontalSpacing: CGFloat = 0,
        verticalSpacing: CGFloat = 4,
        @ViewBuilder content: () -> Content
    ) {
        self.horizontalSpacing = horizontalSpacing
        self.verticalSpacing = verticalSpacing
        self.content = content()
    }

    var body: some View {
        FlowLayout(horizontalSpacing: horizontalSpacing, verticalSpacing: verticalSpacing) {
            content
        }
    }
}

private struct FlowLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let positions = layoutPositions(proposal: proposal, subviews: subviews)
        return positions.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let positions = layoutPositions(proposal: proposal, subviews: subviews)
        for (index, origin) in positions.origins.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                proposal: .unspecified
            )
        }
    }

    private func layoutPositions(proposal: ProposedViewSize, subviews: Subviews) -> (origins: [CGPoint], size: CGSize) {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        var origins: [CGPoint] = []
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var measuredWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let nextX = cursorX == 0 ? size.width : cursorX + horizontalSpacing + size.width
            if cursorX > 0, nextX > maxWidth {
                measuredWidth = max(measuredWidth, cursorX)
                cursorY += rowHeight + verticalSpacing
                cursorX = 0
                rowHeight = 0
            }

            if cursorX > 0 {
                cursorX += horizontalSpacing
            }

            origins.append(CGPoint(x: cursorX, y: cursorY))
            cursorX += size.width
            rowHeight = max(rowHeight, size.height)
        }

        measuredWidth = max(measuredWidth, cursorX)
        let measuredHeight = cursorY + rowHeight
        return (
            origins,
            CGSize(width: proposal.width ?? measuredWidth, height: measuredHeight)
        )
    }
}

struct MarkdownInlineSegment: Identifiable, Equatable {
    enum Kind: Equatable {
        case text
        case link(URL)
    }

    let id: Int
    let kind: Kind
    let text: String

    init(id: Int = 0, kind: Kind, text: String) {
        self.id = id
        self.kind = kind
        self.text = text
    }

    static func == (lhs: MarkdownInlineSegment, rhs: MarkdownInlineSegment) -> Bool {
        lhs.kind == rhs.kind && lhs.text == rhs.text
    }
}

private extension Array where Element == MarkdownInlineSegment {
    var containsLink: Bool {
        contains { segment in
            if case .link = segment.kind {
                return true
            }
            return false
        }
    }
}

enum MarkdownInlineParser {
    static func parse(_ text: String) -> [MarkdownInlineSegment] {
        guard text.contains("["),
              let regex = try? NSRegularExpression(pattern: #"\[([^\]\n]+)\]\((https?://[^\s\)]+)\)"#) else {
            return [MarkdownInlineSegment(kind: .text, text: text)]
        }

        let source = text as NSString
        let fullRange = NSRange(location: 0, length: source.length)
        let matches = regex.matches(in: text, range: fullRange)
        guard !matches.isEmpty else {
            return [MarkdownInlineSegment(kind: .text, text: text)]
        }

        var segments: [MarkdownInlineSegment] = []
        var cursor = 0

        func appendSegment(kind: MarkdownInlineSegment.Kind, text: String) {
            guard !text.isEmpty else {
                return
            }
            segments.append(MarkdownInlineSegment(id: segments.count, kind: kind, text: text))
        }

        for match in matches {
            guard match.numberOfRanges == 3,
                  match.range.location >= cursor else {
                continue
            }

            if match.range.location > cursor {
                appendSegment(
                    kind: .text,
                    text: source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
                )
            }

            let label = source.substring(with: match.range(at: 1))
            let urlText = source.substring(with: match.range(at: 2))
            if let url = URL(string: urlText) {
                appendSegment(kind: .link(url), text: label)
            } else {
                appendSegment(kind: .text, text: source.substring(with: match.range))
            }
            cursor = NSMaxRange(match.range)
        }

        if cursor < source.length {
            appendSegment(
                kind: .text,
                text: source.substring(with: NSRange(location: cursor, length: source.length - cursor))
            )
        }

        return segments.isEmpty ? [MarkdownInlineSegment(kind: .text, text: text)] : segments
    }
}

private struct MarkdownBlock: Identifiable {
    enum Kind {
        case heading(level: Int, text: String)
        case paragraph(String)
        case bullet(String)
        case code(language: String?, text: String)
    }

    let id: Int
    let kind: Kind
}

private enum MarkdownBlockParser {
    static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraphLines: [String] = []
        var codeLines: [String]?
        var codeLanguage: String?

        func append(_ kind: MarkdownBlock.Kind) {
            blocks.append(MarkdownBlock(id: blocks.count, kind: kind))
        }

        func flushParagraph() {
            let paragraph = paragraphLines
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !paragraph.isEmpty {
                append(.paragraph(paragraph))
            }
            paragraphLines.removeAll()
        }

        func flushCode() {
            let code = (codeLines ?? []).joined(separator: "\n").trimmingCharacters(in: .newlines)
            if !code.isEmpty {
                append(.code(language: codeLanguage, text: code))
            }
            codeLines = nil
            codeLanguage = nil
        }

        for line in markdown.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if codeLines != nil {
                if trimmed.hasPrefix("```") {
                    flushCode()
                } else {
                    codeLines?.append(line)
                }
                continue
            }

            if trimmed.hasPrefix("```") {
                flushParagraph()
                codeLanguage = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
                codeLines = []
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if let heading = parseHeading(trimmed) {
                flushParagraph()
                append(.heading(level: heading.level, text: heading.text))
                continue
            }

            if let bullet = parseBullet(trimmed) {
                flushParagraph()
                append(.bullet(bullet))
                continue
            }

            paragraphLines.append(line)
        }

        if codeLines != nil {
            flushCode()
        }
        flushParagraph()
        return blocks.isEmpty ? [MarkdownBlock(id: 0, kind: .paragraph(markdown))] : blocks
    }

    private static func parseHeading(_ line: String) -> (level: Int, text: String)? {
        let markerCount = line.prefix { $0 == "#" }.count
        guard markerCount > 0, markerCount <= 6 else {
            return nil
        }
        let rest = line.dropFirst(markerCount)
        guard rest.first == " " else {
            return nil
        }
        return (markerCount, String(rest).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func parseBullet(_ line: String) -> String? {
        for marker in ["- ", "* "] where line.hasPrefix(marker) {
            return String(line.dropFirst(marker.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }
}

private struct MermaidDiagramCard: View {
    let code: String
    let strings: AppStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(strings.mermaidDiagram)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let diagram = MermaidDiagramParser.parse(code) {
                MermaidFlowchartView(diagram: diagram)
            } else {
                Text(code)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.background.opacity(0.7))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(10)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct MermaidDiagram: Equatable {
    enum Direction: Equatable {
        case topDown
        case leftToRight
    }

    struct Node: Identifiable, Equatable {
        let id: String
        let label: String
    }

    struct Edge: Identifiable, Equatable {
        let id: String
        let from: Node
        let to: Node
    }

    let direction: Direction
    let nodes: [Node]
    let edges: [Edge]
}

enum MermaidDiagramParser {
    static func parse(_ code: String) -> MermaidDiagram? {
        let lines = code.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("%%") }
        guard let header = lines.first else {
            return nil
        }

        let headerParts = header.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard headerParts.count >= 2,
              ["graph", "flowchart"].contains(headerParts[0].lowercased()) else {
            return nil
        }

        let direction = parseDirection(headerParts[1])
        var nodeById: [String: MermaidDiagram.Node] = [:]
        var nodeOrder: [String] = []
        var edges: [MermaidDiagram.Edge] = []

        func remember(_ node: MermaidDiagram.Node) -> MermaidDiagram.Node {
            if let existing = nodeById[node.id] {
                return existing
            }
            nodeById[node.id] = node
            nodeOrder.append(node.id)
            return node
        }

        for line in lines.dropFirst() {
            guard let edgeParts = splitEdge(line),
                  let fromNode = parseNode(edgeParts.from),
                  let toNode = parseNode(edgeParts.to) else {
                continue
            }
            let from = remember(fromNode)
            let to = remember(toNode)
            edges.append(MermaidDiagram.Edge(
                id: "\(edges.count)-\(from.id)-\(to.id)",
                from: from,
                to: to
            ))
        }

        guard !edges.isEmpty else {
            return nil
        }

        let nodes = nodeOrder.compactMap { nodeById[$0] }
        return MermaidDiagram(direction: direction, nodes: nodes, edges: edges)
    }

    private static func parseDirection(_ value: String) -> MermaidDiagram.Direction {
        switch value.uppercased() {
        case "LR", "RL":
            return .leftToRight
        default:
            return .topDown
        }
    }

    private static func splitEdge(_ rawLine: String) -> (from: String, to: String)? {
        let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: ";").union(.whitespacesAndNewlines))
        let arrows = ["-.->", "==>", "-->", "---"]
        var match: Range<String.Index>?
        for arrow in arrows {
            guard let range = line.range(of: arrow) else {
                continue
            }
            if let existing = match {
                match = range.lowerBound < existing.lowerBound ? range : existing
            } else {
                match = range
            }
        }
        guard let match else {
            return nil
        }

        let from = String(line[..<match.lowerBound])
        var to = String(line[match.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if to.hasPrefix("|"), let close = to.dropFirst().firstIndex(of: "|") {
            to = String(to[to.index(after: close)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return (from, to)
    }

    private static func parseNode(_ rawToken: String) -> MermaidDiagram.Node? {
        let token = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else {
            return nil
        }

        let delimiters: [(Character, Character)] = [("[", "]"), ("(", ")"), ("{", "}")]
        for delimiter in delimiters {
            guard let open = token.firstIndex(of: delimiter.0),
                  let close = token.lastIndex(of: delimiter.1),
                  open < close else {
                continue
            }
            let id = String(token[..<open]).trimmingCharacters(in: .whitespacesAndNewlines)
            let label = String(token[token.index(after: open)..<close])
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'").union(.whitespacesAndNewlines))
            guard !id.isEmpty, !label.isEmpty else {
                return nil
            }
            return MermaidDiagram.Node(id: id, label: label)
        }

        let id = token.trimmingCharacters(in: CharacterSet(charactersIn: "\"'").union(.whitespacesAndNewlines))
        guard !id.isEmpty else {
            return nil
        }
        return MermaidDiagram.Node(id: id, label: id)
    }
}

private struct MermaidFlowchartView: View {
    let diagram: MermaidDiagram

    var body: some View {
        switch diagram.direction {
        case .leftToRight:
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    orderedNodeSequence
                }
                .padding(2)
            }
        case .topDown:
            VStack(spacing: 8) {
                orderedNodeSequence
            }
        }
    }

    @ViewBuilder
    private var orderedNodeSequence: some View {
        let nodes = linearizedNodes
        ForEach(Array(nodes.enumerated()), id: \.element.id) { index, node in
            MermaidNodeView(node: node)
            if index < nodes.count - 1 {
                Image(systemName: diagram.direction == .leftToRight ? "arrow.right" : "arrow.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
        }
    }

    private var linearizedNodes: [MermaidDiagram.Node] {
        var seen = Set<String>()
        var nodes: [MermaidDiagram.Node] = []
        for edge in diagram.edges {
            if seen.insert(edge.from.id).inserted {
                nodes.append(edge.from)
            }
            if seen.insert(edge.to.id).inserted {
                nodes.append(edge.to)
            }
        }
        return nodes
    }
}

private struct MermaidNodeView: View {
    let node: MermaidDiagram.Node

    var body: some View {
        Text(node.label)
            .font(.footnote.weight(.medium))
            .multilineTextAlignment(.center)
            .lineLimit(3)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(minWidth: 86)
            .background(.background.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(.secondary.opacity(0.2), lineWidth: 1)
            )
    }
}

private struct CardSection<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ProjectRow: View {
    let project: DesktopProjectSummary
    let strings: AppStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(project.name)
                    .font(.body.weight(.semibold))
                Spacer()
                Text(strings.projectStatus(project.status))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(project.status == .blocked ? .orange : .secondary)
            }

            ProgressView(value: project.progress)

            Text(strings.activeTasks(project.activeTasks))
                .font(.caption)
                .foregroundStyle(.secondary)
            if let artifactCount = project.artifactCount {
                Text(strings.artifactCount(artifactCount))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct LoopRow: View {
    let loop: LoopSummary
    let strings: AppStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(loop.name)
                    .font(.body.weight(.semibold))
                Spacer()
                Text(strings.loopStatus(loop.status))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(loop.status == .running ? .blue : .secondary)
            }

            Text(strings.lastRun(strings.loopRunStatus(loop.lastRunStatus)))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(loop.nextRunSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct ApprovalRow: View {
    let approval: ApprovalRequest
    let strings: AppStrings
    let isResponding: Bool
    let onApprove: () -> Void
    let onReject: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(approval.title)
                        .font(.body.weight(.semibold))
                    Text(approval.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(strings.approvalStatus(approval.status))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
            }

            Text(strings.risk(strings.approvalRisk(approval.risk)))
                .font(.caption)
                .foregroundStyle(.secondary)

            if approval.status == .pending {
                HStack {
                    Button(strings.approve, action: onApprove)
                        .buttonStyle(.borderedProminent)
                        .disabled(isResponding)
                        .accessibilityLabel("\(strings.approve) \(approval.id)")
                    Button(strings.reject, action: onReject)
                        .buttonStyle(.bordered)
                        .disabled(isResponding)
                        .accessibilityLabel("\(strings.reject) \(approval.id)")
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch approval.status {
        case .pending:
            .orange
        case .approved:
            .green
        case .rejected:
            .red
        }
    }
}

private enum ArtifactDisplayName {
    static func displayName(for artifact: DesktopArtifactSummary, strings: AppStrings) -> String {
        let trimmedName = artifact.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty, !looksInternalArtifactIdentifier(trimmedName) {
            return trimmedName
        }
        return strings.artifactFallbackName(artifact.kind)
    }

    private static func looksInternalArtifactIdentifier(_ value: String) -> Bool {
        let lowercased = value.lowercased()
        return lowercased == "artifact"
            || lowercased.hasPrefix("artifact:")
            || lowercased.hasPrefix("artifact_")
            || lowercased.hasPrefix("artifact-")
            || lowercased.hasPrefix("artifact_call_")
            || lowercased.hasPrefix("kswarm:")
    }
}

private struct ArtifactRow: View {
    let artifact: DesktopArtifactSummary
    let strings: AppStrings

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(displayName)
                    .font(.body.weight(.semibold))
                Spacer()
                Text(artifact.kind.displayText)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Text(strings.artifactStatus(artifact.status))
                .font(.caption)
                .foregroundStyle(artifact.status == .ready ? .green : .secondary)
        }
        .padding(.vertical, 4)
    }

    private var displayName: String {
        ArtifactDisplayName.displayName(for: artifact, strings: strings)
    }
}

#Preview {
    ContentView(store: XiaokAppStore(client: MockMobileGatewayClient()))
}
