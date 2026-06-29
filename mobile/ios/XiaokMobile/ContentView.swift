import AVFoundation
import SwiftUI
import UIKit

struct ContentView: View {
    @StateObject private var store: XiaokAppStore
    @State private var selectedTab: AppTab = .overview

    init(store: XiaokAppStore) {
        _store = StateObject(wrappedValue: store)
    }

    var body: some View {
        let strings = store.strings

        TabView(selection: $selectedTab) {
            OverviewView(store: store, strings: strings, openSettings: openSettings)
                .tabItem {
                    Label(strings.tabOverview, systemImage: "gauge.with.dots.needle.67percent")
                }
                .tag(AppTab.overview)

            TasksView(store: store, strings: strings, openSettings: openSettings)
                .tabItem {
                    Label(strings.tabTasks, systemImage: "checklist")
                }
                .tag(AppTab.tasks)

            WorkView(store: store, strings: strings)
                .tabItem {
                    Label(strings.tabWork, systemImage: "folder.badge.gearshape")
                }
                .tag(AppTab.work)

            ApprovalsView(store: store, strings: strings)
                .tabItem {
                    Label(strings.tabApprovals, systemImage: "checkmark.shield")
                }
                .tag(AppTab.approvals)

            SettingsView(store: store, strings: strings)
                .tabItem {
                    Label(strings.tabSettings, systemImage: "gearshape")
                }
                .tag(AppTab.settings)
        }
        .environment(\.locale, Locale(identifier: store.language.forcedLocaleIdentifier ?? Locale.autoupdatingCurrent.identifier))
        .task {
            await store.loadInitialSnapshot()
        }
    }

    private func openSettings() {
        selectedTab = .settings
    }
}

private enum AppTab {
    case overview
    case tasks
    case work
    case approvals
    case settings
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
    let openSettings: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var activeConversationId: String?
    @State private var showsTaskHistory = false
    @State private var selectedArtifact: DesktopArtifactSummary?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !store.isDesktopConnected {
                    ConnectionRequiredBanner(strings: strings, openSettings: openSettings)
                        .padding()
                }

                if let conversation = activeConversation {
                    List {
                        taskConversationRows(for: conversation)
                    }
                    .listStyle(.plain)
                    .simultaneousGesture(conversationBackGesture)
                } else {
                    NewTaskComposerView(
                        draft: $draft,
                        strings: strings,
                        isSending: store.isSending,
                        isConnected: store.isDesktopConnected,
                        onSubmit: submitDraft
                    )
                }

                if let errorMessage = store.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                }

                if activeConversation != nil {
                    TaskInputBar(
                        draft: $draft,
                        strings: strings,
                        isSending: store.isSending,
                        isConnected: store.isDesktopConnected,
                        onSubmit: submitDraft
                    )
                }
            }
            .navigationTitle(strings.tasksTitle)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if activeConversation != nil {
                        Button {
                            closeConversation()
                        } label: {
                            Label(strings.back, systemImage: "chevron.left")
                        }
                        .accessibilityIdentifier("ConversationBackButton")
                    }
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        startNewTask()
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel(strings.newTask)
                    .accessibilityIdentifier("NewTaskButton")

                    Button {
                        showsTaskHistory = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                    }
                    .accessibilityLabel(strings.taskHistoryTitle)
                    .accessibilityIdentifier("TaskHistoryButton")
                }
            }
            .sheet(isPresented: $showsTaskHistory) {
                TaskHistorySheet(store: store, strings: strings, onOpenConversation: openConversation)
            }
            .sheet(item: $selectedArtifact) { artifact in
                ArtifactPreviewSheet(store: store, artifact: artifact, strings: strings)
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase != .active else {
                    return
                }
                resetTransientTaskState()
            }
            .onDisappear {
                showsTaskHistory = false
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

    @ViewBuilder
    private func taskConversationRows(for conversation: ConversationSummary) -> some View {
        ConversationRow(conversation: conversation, strings: strings)

        let artifacts = store.artifacts(for: conversation.id)
        if !artifacts.isEmpty {
            Section(strings.artifactsTitle) {
                ForEach(artifacts) { artifact in
                    Button {
                        selectedArtifact = artifact
                    } label: {
                        ArtifactRow(artifact: artifact, strings: strings)
                    }
                    .buttonStyle(.plain)
                }
            }
        }

        let messages = store.visibleMessages(for: conversation.id)
        ForEach(messages) { message in
            MessageRow(message: message, strings: strings)
        }
        if store.hasMoreMessages(for: conversation.id) {
            Button(strings.loadMore) {
                store.showMoreMessages(for: conversation.id)
            }
        }
    }

    private func openConversation(_ conversationId: String) {
        activeConversationId = conversationId
        showsTaskHistory = false
        store.selectConversation(conversationId)
    }

    private func closeConversation() {
        activeConversationId = nil
        showsTaskHistory = false
    }

    private func startNewTask() {
        activeConversationId = nil
        showsTaskHistory = false
    }

    private func resetTransientTaskState() {
        activeConversationId = nil
        showsTaskHistory = false
    }

    private func submitDraft() {
        let text = draft
        draft = ""
        Task { @MainActor in
            await store.sendMessage(text)
            if let selectedConversationId = store.selectedConversationId {
                activeConversationId = selectedConversationId
                showsTaskHistory = false
            }
        }
    }
}

private struct NewTaskComposerView: View {
    @Binding var draft: String
    let strings: AppStrings
    let isSending: Bool
    let isConnected: Bool
    let onSubmit: () -> Void

    private var suggestions: [String] {
        [
            strings.suggestedPromptStatus,
            strings.suggestedPromptSummarize,
            strings.suggestedPromptPlan
        ]
    }

    var body: some View {
        VStack(spacing: 18) {
            Spacer(minLength: 40)

            VStack(spacing: 8) {
                Text(strings.taskWelcomeTitle)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text(strings.taskWelcomeSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            .padding(.horizontal)

            VStack(spacing: 12) {
                TextField(strings.messagePlaceholder, text: $draft, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.plain)
                    .padding(12)
                    .background(.background)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityIdentifier("MessageInput")

                HStack {
                    Spacer()
                    Button {
                        onSubmit()
                    } label: {
                        Label(strings.send, systemImage: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!isConnected || isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("SendMessageButton")
                }
            }
            .padding()
            .background(.thinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal)

            VStack(spacing: 10) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button {
                        draft = suggestion
                    } label: {
                        Text(suggestion)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal)

            Spacer(minLength: 48)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct TaskInputBar: View {
    @Binding var draft: String
    let strings: AppStrings
    let isSending: Bool
    let isConnected: Bool
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            TextField(strings.messagePlaceholder, text: $draft)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("MessageInput")

            Button {
                onSubmit()
            } label: {
                Image(systemName: "paperplane.fill")
                    .accessibilityLabel(strings.send)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!isConnected || isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("SendMessageButton")
        }
        .padding()
        .background(.bar)
    }
}

private struct WorkView: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    @State private var selectedArtifact: DesktopArtifactSummary?

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
                                    selectedArtifact = artifact
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
                            selectedArtifact = artifact
                        } label: {
                            ArtifactRow(artifact: artifact, strings: strings)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle(strings.workTitle)
            .sheet(item: $selectedArtifact) { artifact in
                ArtifactPreviewSheet(store: store, artifact: artifact, strings: strings)
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

private struct TaskHistorySheet: View {
    @ObservedObject var store: XiaokAppStore
    let strings: AppStrings
    let onOpenConversation: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if store.isLoadingSnapshot && store.conversations.isEmpty {
                    HStack {
                        ProgressView()
                        Text(strings.refreshing)
                            .foregroundStyle(.secondary)
                    }
                } else if store.conversations.isEmpty {
                    Text(strings.noTasks)
                        .foregroundStyle(.secondary)
                }

                ForEach(store.visibleConversations) { conversation in
                    Button {
                        onOpenConversation(conversation.id)
                        dismiss()
                    } label: {
                        ConversationRow(conversation: conversation, strings: strings)
                    }
                    .buttonStyle(.plain)
                }

                if store.hasMoreConversations {
                    Button(strings.loadMore) {
                        store.showMoreConversations()
                    }
                }
            }
            .navigationTitle(strings.taskHistoryTitle)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(strings.done) {
                        dismiss()
                    }
                }
            }
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

private struct ArtifactPreviewSheet: View {
    @ObservedObject var store: XiaokAppStore
    let artifact: DesktopArtifactSummary
    let strings: AppStrings
    @Environment(\.dismiss) private var dismiss
    @State private var preview: ArtifactPreview?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section(strings.artifactPreviewTitle) {
                    ArtifactRow(artifact: preview?.artifact ?? artifact, strings: strings)
                }

                Section {
                    if isLoading {
                        HStack {
                            ProgressView()
                            Text(strings.refreshing)
                                .foregroundStyle(.secondary)
                        }
                    } else if let text = preview?.text,
                              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        MessageBodyView(text: text, strings: strings)
                    } else {
                        Text(errorMessage ?? strings.artifactPreviewUnavailable)
                            .foregroundStyle(.secondary)
                    }
                }
            }
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
        }
    }

    private func loadPreview() async {
        isLoading = true
        defer { isLoading = false }
        do {
            preview = try await store.fetchArtifactPreview(id: artifact.id)
            errorMessage = nil
        } catch {
            errorMessage = strings.artifactPreviewUnavailable
        }
    }
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

        didScan = true
        sessionQueue.async { [session] in
            if session.isRunning {
                session.stopRunning()
            }
        }
        onCodeScanned(code)
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

    private func reportUnavailable() {
        guard !didReportUnavailable else {
            return
        }
        didReportUnavailable = true
        onUnavailable()
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
        VStack(alignment: .leading, spacing: 4) {
            MessageBodyView(text: message.text, strings: strings)
        }
        .padding(.vertical, 4)
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
        let trimmedName = artifact.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty, !Self.looksInternalArtifactIdentifier(trimmedName) {
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

#Preview {
    ContentView(store: XiaokAppStore(client: MockMobileGatewayClient()))
}
