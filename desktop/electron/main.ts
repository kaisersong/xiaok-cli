import { app, BrowserWindow, ipcMain, session, shell, nativeImage, Menu, powerMonitor, screen } from 'electron';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import {
  createDesktopServices,
  getDesktopMemoryBackend,
  getDesktopMemoryStore,
  resumeOneScriptWorkflow,
} from './desktop-services.js';
import { onSkillCatalogChanged } from './skill-catalog-invalidation.js';
import { registerDesktopIpc } from './ipc.js';
import {
  buildBrowserWindowOptions,
  isAllowedNavigationUrl,
  isAllowedShellExternalUrl,
  isTrustedDesktopRendererUrl,
  resolveLocalFileOpenPath,
} from './security.js';
import {
  readMediaTypesFromPermissionDetails,
  shouldAllowDesktopRendererPermission,
} from './desktop-permission-policy.js';
import {
  findIntentBrokerProtocolUrl,
  registerIntentBrokerProtocolClient,
} from './intent-broker-protocol.js';
import { resolveDesktopDockIconPath, resolveDesktopWindowIconPath } from './window-icon.js';
import {
  attachCloseToMinimize,
  attachWindowRepaintHandlers,
  removeWindowsWindowMenu,
  restoreExistingWindow,
} from './window-lifecycle.js';
import { setupMenuBar, destroyMenuBar } from './menubar.js';
import { setupAutoUpdater, checkForUpdates, quitAndInstall, getUpdateStatus } from './updater.js';
import { createKSwarmService, resolveKSwarmServiceLogRoot } from './kswarm-service.js';
import { deployBundledPlugins } from './deploy-bundled-plugins.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain } from './shutdown-aware-ipc-main.js';
import { DesktopShutdownCoordinator } from './desktop-shutdown-coordinator.js';
import { PluginProviderRuntimeFacade } from './plugin-provider-runtime-facade.js';
import { UpdaterHandoffStateMachine } from './updater-handoff.js';
import { TimedActionStore } from './timed-action-store.js';
import { ThreadMetaStore } from './thread-meta-store.js';
import { TimedActionService } from './timed-action-service.js';
import { TimedActionScheduler } from './timed-action-scheduler.js';
import { createDesktopTimedActionExecutors } from './timed-action-executors.js';
import { createElectronDesktopNotificationPort } from './desktop-notifications.js';
import {
  createMeetingRecorderWindowController,
  type MeetingRecorderSessionState,
  type MeetingRecorderWindowController,
  type MeetingRecorderWindowMode,
} from './meeting-recorder-window.js';
import { createDesktopLoopRuntime } from './loop-executor.js';
import { createDesktopLoopLLMPort } from './loop-llm-port-impl.js';
import { DesktopExecutionCoordinator } from './desktop-execution-coordinator.js';
import { AssistantService } from './assistant-service.js';
import { AssistantController } from './assistant-controller.js';
import { listLatestMorningSuggestions } from './assistant-morning-suggestions.js';
import { buildAssistantMorningContext } from './assistant-morning-context.js';
import { ASSISTANT_EVENING_LOOP_ID, ASSISTANT_MORNING_LOOP_ID } from './assistant-types.js';
import { createAssistantRuntime } from './assistant-runtime.js';
import { createAssistantDesktopSnapshotReader } from './assistant-desktop-snapshot.js';
import { createLoopExecutionAdapter } from './loop-execution-adapter.js';
import { createKSwarmTeamService } from './kswarm-team-service.js';
import {
  createKSwarmSemanticService,
  createProjectCapabilityNeedsProposalPort,
} from './kswarm-semantic-service.js';
import { registerSemanticDesktopIpc } from './semantic-ipc.js';
import { createCollaborationRoomService } from './collaboration-room-service.js';
import { createCollaborationRoomBrokerClient } from './collaboration-room-broker-client.js';
import { createRoomProjectSagaJournal } from './collaboration-room-saga-journal.js';
import { createCollaborationRoomWakeDispatcher } from './collaboration-room-wake-dispatcher.js';
import { buildAutomationOverviewSnapshot, buildAutomationRunHistory } from './automation-overview.js';
import { attachDesktopContextMenu } from './context-menu.js';
import {
  createKSwarmRuntimeBridge,
  createKSwarmRuntimeBridgeBrokerClient,
  submitKSwarmRuntimeResultToBroker,
  submitKSwarmWorkflowNodeResultToBroker,
} from './kswarm-runtime-bridge.js';
import { XIAOK_DESKTOP_HOST_PARTICIPANT_ID, XIAOK_WORKER_SEED_ID } from '../shared/kswarm-seed-contract.js';
import { KSwarmStreamBridge } from './kswarm-stream-bridge.js';
import { registerKSwarmProxy } from './kswarm-ipc-proxy.js';
import { configureDefaultRemoteDebugging } from './remote-debugging.js';
import {
  buildMobilePairingPayload,
  createMobileBonjourAdvertiser,
  createMobileGateway,
  loadOrCreateMobileIdentity,
  type MobileApprovalDecision,
  type MobileArtifactPreview,
  type MobileChatMessage,
} from './mobile-gateway.js';
import {
  createMobileRelayBridge,
  loadMobileRelayConfig,
  type MobileRelayStatus,
} from './mobile-relay.js';
import {
  buildMobileSnapshotFromSources,
  collectKSwarmProjectArtifacts,
  resolveMobileApprovalAnswer,
  type KSwarmProjectLike,
  type MobileProjectArtifactRecord,
} from './mobile-snapshot.js';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';
import { configureSafeCrashCapture } from '../../src/utils/crash-reporter.js';

// K3 reasoning is task-local heap state. Disable Electron Crashpad before
// app readiness so it cannot be copied into a minidump.
app.commandLine.appendSwitch('disable-crash-reporter');
app.commandLine.appendSwitch('disable-breakpad');
configureSafeCrashCapture();

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 必须在任何 `app.setName()` 之前解析，且全进程只解析一次。
 *
 * Chromium 的 PathService 缓存 `DIR_USER_DATA`：首次读取即固化。而下面
 * `app.setName('xiaok')` 会把它改成 `~/Library/Application Support/xiaok`，
 * 那个目录在真实机器上已被另一个应用占用。在钉住之前，路径还正确的唯一原因是
 * 一句模块作用域的 `debugMain()` 恰好先读了它 —— 也就是删掉一行日志就会搬走
 * 用户的知识库和会话数据。`tests/main/user-data-path-invariant.test.ts` 守这条。
 */
const USER_DATA_DIR = app.getPath('userData');
let mainWindow: BrowserWindow | null = null;
let meetingRecorderController: MeetingRecorderWindowController | null = null;
/**
 * Design v58 §5.5: the only holder of the raw Electron `ipcMain`. Every invoke
 * — reads included — takes a shutdown-gate token, so no hand-maintained
 * mutation allowlist can miss an entry point.
 */
const desktopShutdownGate = new DesktopShutdownGate();
const shutdownAwareIpc = new ShutdownAwareIpcMain(ipcMain, desktopShutdownGate);

/**
 * Design v58 §4: created synchronously before any service or gateway, never
 * replaced. Static gateways capture this identity and get a structured
 * unavailable result until `start()` runs.
 */
const pluginProviderRuntime = new PluginProviderRuntimeFacade();

/**
 * Design v58 §5.5: the only Xiaok-owned `before-quit` owner. Registered at module
 * scope so a quit during startup is still ordered; the lifetime disposer is
 * attached once `createWindow()` has built the per-process resources.
 */
const desktopLifetimeSteps: Array<{ name: string; run: () => Promise<void> }> = [];
function registerLifetimeDisposerStep(name: string, run: () => Promise<void>): void {
  desktopLifetimeSteps.push({ name, run });
}
const desktopShutdownCoordinator = new DesktopShutdownCoordinator({
  gate: desktopShutdownGate,
  providerRuntime: pluginProviderRuntime,
  ingressOwners: [],
  durableStores: [],
  destroyWindows: () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.destroy();
    }
  },
  disposeLifetimeResources: async () => {
    // Each step runs at most once, in registration order; a failing step never
    // skips the rest (design §5.5 phase ⑥ independent cleanup).
    for (const step of desktopLifetimeSteps.splice(0)) {
      try {
        await step.run();
      } catch (error) {
        debugMain(`lifetime disposer step failed: ${step.name}`, error instanceof Error ? error.message : String(error));
      }
    }
  },
  releaseMainSourcePin: async () => {
    // Stage 3 wiring: the trusted source resolver installs the real release here
    // once it owns a pin; before that there is nothing to release.
  },
  continuation: () => {
    app.quit();
  },
});
/**
 * Two-phase install handoff. `platformClass` follows the real electron-updater
 * class: darwin instantiates `MacUpdater` (sticky pending, no retry once the
 * wrapper was entered), every other installer goes through `BaseUpdater`.
 */
const updaterHandoff = new UpdaterHandoffStateMachine({
  platformClass: process.platform === 'darwin' ? 'mac' : 'base',
  invokeWrapper: () => {
    quitAndInstall();
  },
});

app.on('before-quit', (event) => {
  // A real before-quit is the only transition into irreversible cleanup.
  updaterHandoff.commitHandoffOnBeforeQuit();
  const { preventDefault } = desktopShutdownCoordinator.onBeforeQuit();
  if (preventDefault) event.preventDefault();
});

let isQuitting = false;
const MAX_MOBILE_ARTIFACT_FILE_BYTES = 20 * 1024 * 1024;

function debugMain(message: string, extra?: unknown): void {
  const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`;
  const line = `[main-debug] ${message}${suffix}`;
  try {
    const logDir = join(USER_DATA_DIR, 'logs');
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, 'main-debug.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
  console.log(line);
}

function registerDesktopPermissionHandlers(options: {
  devServer?: string;
  rendererFile: string;
}): void {
  const isTrustedMainRenderer = (webContents: Electron.WebContents | null): boolean => (
    webContents === mainWindow?.webContents
      && isTrustedDesktopRendererUrl(webContents?.getURL() ?? '', options)
  );
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    return shouldAllowDesktopRendererPermission({
      permission,
      mediaTypes: readMediaTypesFromPermissionDetails(details),
      isMainWindowWebContents: isTrustedMainRenderer(webContents),
      isMeetingRecorderWebContents: meetingRecorderController?.ownsWebContents(webContents) === true,
    });
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(shouldAllowDesktopRendererPermission({
      permission,
      mediaTypes: readMediaTypesFromPermissionDetails(details),
      isMainWindowWebContents: isTrustedMainRenderer(webContents),
      isMeetingRecorderWebContents: meetingRecorderController?.ownsWebContents(webContents) === true,
    }));
  });
}

function readRecentTaskSnapshots(dataRoot: string, limit = 20): TaskSnapshot[] {
  const snapshotDir = join(dataRoot, 'tasks', 'snapshots');
  if (!existsSync(snapshotDir)) return [];
  return readdirSync(snapshotDir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const filePath = join(snapshotDir, name);
      return { filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .flatMap(({ filePath }) => {
      try {
        return [JSON.parse(readFileSync(filePath, 'utf8')) as TaskSnapshot];
      } catch {
        return [];
      }
    });
}

function findMobileArtifactPreview(dataRoot: string, artifactId: string): MobileArtifactPreview | null {
  for (const snapshot of readRecentTaskSnapshots(dataRoot, 30)) {
    for (const artifact of snapshot.result?.artifacts ?? []) {
      if (artifact.artifactId !== artifactId) continue;
      return buildArtifactPreview({
        artifact: {
          id: artifact.artifactId,
          name: artifact.title || artifact.filePath?.split(/[\\/]/).pop() || artifact.artifactId,
          kind: mapMobileArtifactKind(artifact.kind),
          source: snapshot.taskId,
          status: 'ready',
          previewAvailable: artifact.previewAvailable,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
        filePath: artifact.filePath,
        previewAvailable: artifact.previewAvailable,
        mimeType: artifact.mimeType,
        kind: artifact.kind,
      });
    }

    for (const event of snapshot.events) {
      if (event.type !== 'artifact_recorded' || event.artifactId !== artifactId) continue;
      return buildArtifactPreview({
        artifact: {
          id: event.artifactId,
          name: event.label || event.filePath.split(/[\\/]/).pop() || event.artifactId,
          kind: mapMobileArtifactKind(event.kind),
          source: snapshot.taskId,
          status: 'ready',
          previewAvailable: event.previewAvailable,
          mimeType: event.mimeType,
        },
        filePath: event.filePath,
        previewAvailable: event.previewAvailable,
        mimeType: event.mimeType,
        kind: event.kind,
      });
    }
  }
  return null;
}

async function findKSwarmMobileArtifactPreview(
  kswarmService: ReturnType<typeof createKSwarmService>,
  artifactId: string,
): Promise<MobileArtifactPreview | null> {
  const projects = await fetchKSwarmProjectsForMobile(kswarmService).catch(() => []);
  for (const project of projects) {
    for (const artifact of collectKSwarmProjectArtifacts(project)) {
      if (artifact.id !== artifactId) continue;
      const { filePath: _filePath, artifactPath: _artifactPath, ...artifactSummary } = artifact;
      return buildArtifactPreview({
        artifact: artifactSummary,
        filePath: resolveKSwarmArtifactFilePath(project, artifact),
        previewAvailable: artifact.previewAvailable,
        mimeType: artifact.mimeType,
        kind: artifact.kind,
      });
    }
  }
  return null;
}

function buildArtifactPreview(input: {
  artifact: unknown;
  filePath?: string;
  previewAvailable?: boolean;
  mimeType?: string;
  kind: string;
}): MobileArtifactPreview | null {
  const contentType = input.mimeType || contentTypeForArtifactKind(input.kind);
  const fileExists = Boolean(input.filePath && existsSync(input.filePath));
  if (!input.previewAvailable && !fileExists) return null;
  const preview: MobileArtifactPreview = {
    artifact: input.artifact,
    contentType,
  };
  if (!input.filePath || !fileExists) return preview;

  preview.fileName = basename(input.filePath);
  if (isTextPreviewKind(input.kind, contentType)) {
    preview.text = readFileSync(input.filePath, 'utf8').slice(0, 200_000);
    return preview;
  }

  if (isSystemPreviewFileKind(input.kind, contentType)) {
    const size = statSync(input.filePath).size;
    if (size <= MAX_MOBILE_ARTIFACT_FILE_BYTES) {
      preview.dataBase64 = readFileSync(input.filePath).toString('base64');
    }
  }
  return preview;
}

function mapMobileArtifactKind(kind: string): string {
  if (kind === 'pptx' || kind === 'pdf' || kind === 'html' || kind === 'image' || kind === 'text' || kind === 'markdown') {
    return kind;
  }
  return 'other';
}

function contentTypeForArtifactKind(kind: string): string {
  if (kind === 'markdown') return 'text/markdown';
  if (kind === 'html') return 'text/html';
  if (kind === 'text') return 'text/plain';
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return 'application/octet-stream';
}

function isTextPreviewKind(kind: string, contentType: string): boolean {
  return kind === 'markdown'
    || kind === 'text'
    || kind === 'html'
    || contentType.startsWith('text/')
    || contentType === 'application/json';
}

function isSystemPreviewFileKind(kind: string, contentType: string): boolean {
  return kind === 'pdf'
    || kind === 'pptx'
    || kind === 'image'
    || contentType === 'application/pdf'
    || contentType.startsWith('image/')
    || contentType.includes('officedocument');
}

async function fetchKSwarmProjectsForMobile(kswarmService: ReturnType<typeof createKSwarmService>): Promise<KSwarmProjectLike[]> {
  const status = kswarmService.getStatus();
  if (!status.running || !status.port) return [];
  const response = await fetch(`http://127.0.0.1:${status.port}/projects`);
  if (!response.ok) return [];
  const body = await response.json() as { projects?: KSwarmProjectLike[] };
  return Array.isArray(body.projects)
    ? body.projects.map(project => ({
      ...project,
      workspaceArtifacts: [
        ...arrayValue(project.workspaceArtifacts),
        ...readKSwarmWorkspaceArtifacts(project),
      ],
    }))
    : [];
}

function readKSwarmWorkspaceArtifacts(project: KSwarmProjectLike): unknown[] {
  const workFolder = typeof project.workFolder === 'string' && project.workFolder.trim()
    ? project.workFolder.trim()
    : '';
  if (!workFolder) return [];
  const artifactsDir = join(workFolder, 'artifacts');
  if (!existsSync(artifactsDir)) return [];

  try {
    return readdirSync(artifactsDir)
      .sort()
      .flatMap(name => {
        const filePath = join(artifactsDir, name);
        const stats = statSync(filePath);
        if (!stats.isFile()) return [];
        const kind = artifactKindFromFileName(name);
        const mimeType = contentTypeForArtifactKind(kind);
        return [{
          path: `artifacts/${name}`,
          filePath,
          label: name,
          kind,
          mimeType,
          sizeBytes: stats.size,
          previewAvailable: isTextPreviewKind(kind, mimeType),
        }];
      });
  } catch {
    return [];
  }
}

function resolveKSwarmArtifactFilePath(
  project: KSwarmProjectLike,
  artifact: MobileProjectArtifactRecord,
): string | undefined {
  if (artifact.filePath) return artifact.filePath;
  const artifactPath = artifact.artifactPath;
  const workFolder = typeof project.workFolder === 'string' && project.workFolder.trim()
    ? project.workFolder.trim()
    : '';
  if (!artifactPath || !workFolder) return undefined;
  return artifactPath.startsWith('/')
    ? artifactPath
    : join(workFolder, artifactPath);
}

function artifactKindFromFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (/\.(png|jpg|jpeg|webp|gif|svg)$/.test(lower)) return 'image';
  if (/\.(txt|log|json|csv|xml|yaml|yml)$/.test(lower)) return 'text';
  return 'other';
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Suppress EPIPE errors from console.log after stdout pipe closes
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason);
});
process.on('exit', (code) => {
  debugMain('process exit', { code });
});
const remoteDebuggingConfig = configureDefaultRemoteDebugging(app.commandLine, process.argv);
debugMain('remote-debugging:configured', remoteDebuggingConfig);
const singleInstanceDisabled = process.env.XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE === '1';
const singleInstanceLock = singleInstanceDisabled ? true : app.requestSingleInstanceLock();
if (singleInstanceDisabled) {
  debugMain('single-instance-lock:disabled-by-env');
}

async function createWindow(): Promise<BrowserWindow> {
  debugMain('createWindow:start');
  const preloadPath = join(__dirname, 'preload.cjs');
  const rendererFile = join(__dirname, '../../../renderer/index.html');
  const devServer = process.env['XIAOK_DESKTOP_DEV_SERVER'];
  const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath, {
    platform: process.platform,
    iconPath: resolveDesktopWindowIconPath(__dirname, process.platform),
  }));
  debugMain('createWindow:browserWindow-created');
  removeWindowsWindowMenu(window, process.platform);
  attachDesktopContextMenu(window, Menu);
  mainWindow = window;
  meetingRecorderController ??= createMeetingRecorderWindowController({
    BrowserWindow,
    getMainWindow: () => mainWindow,
    notificationPort: createElectronDesktopNotificationPort(),
    platform: process.platform,
    preloadPath,
    rendererFile,
    devServer,
    screen,
  });
  registerDesktopPermissionHandlers({ rendererFile, devServer });
  const isMainWindowSender = (sender: Electron.WebContents): boolean => sender === window.webContents;
  const isRecorderWindowSender = (sender: Electron.WebContents): boolean => (
    meetingRecorderController?.ownsWebContents(sender) === true
  );
  shutdownAwareIpc.handle('desktop:meetingOpenRecorderWindow', (event, input: { collectionId?: unknown }) => {
    if (!isMainWindowSender(event.sender)) return { ok: false, error: 'unauthorized_sender' };
    if (typeof input?.collectionId !== 'string' || !input.collectionId.trim()) {
      return { ok: false, error: 'collection_id_required' };
    }
    return meetingRecorderController!.open({ collectionId: input.collectionId });
  });
  shutdownAwareIpc.handle('desktop:meetingSetRecorderWindowMode', (event, input: { mode?: unknown }) => {
    if (!isRecorderWindowSender(event.sender)) return { ok: false, error: 'unauthorized_sender' };
    const mode = input?.mode;
    if (mode !== 'workbench' && mode !== 'compact' && mode !== 'summary') {
      return { ok: false, error: 'invalid_mode' };
    }
    return meetingRecorderController!.setMode(mode as MeetingRecorderWindowMode);
  });
  shutdownAwareIpc.handle('desktop:meetingSetRecorderSessionState', (event, input: { state?: unknown }) => {
    if (!isRecorderWindowSender(event.sender)) return { ok: false, error: 'unauthorized_sender' };
    const state = input?.state;
    if (state !== 'idle' && state !== 'recording' && state !== 'processing' && state !== 'summary') {
      return { ok: false, error: 'invalid_state' };
    }
    return meetingRecorderController!.setSessionState(state as MeetingRecorderSessionState);
  });
  shutdownAwareIpc.handle('desktop:meetingNotifyRecorderSummaryReady', (event, input: { title?: unknown }) => {
    if (!isRecorderWindowSender(event.sender)) return { ok: false, error: 'unauthorized_sender' };
    return meetingRecorderController!.notifySummaryReady({
      title: typeof input?.title === 'string' ? input.title : '',
    });
  });
  shutdownAwareIpc.handle('desktop:meetingNotifyRecordingSaved', (event, input: { collectionId?: unknown }) => {
    if (!isRecorderWindowSender(event.sender)) return { ok: false, error: 'unauthorized_sender' };
    if (typeof input?.collectionId !== 'string' || !input.collectionId.trim()) {
      return { ok: false, error: 'collection_id_required' };
    }
    return meetingRecorderController!.notifySaved({ collectionId: input.collectionId });
  });
  shutdownAwareIpc.handle('desktop:meetingCloseRecorderWindow', (event) => {
    if (!isRecorderWindowSender(event.sender)) return { ok: false, error: 'unauthorized_sender' };
    return meetingRecorderController!.close();
  });
  // KSwarm service — manages kswarm server as a child process
  const kswarmService = createKSwarmService();
  const kswarmStartPromise = kswarmService.start().catch((err) => {
    console.error('[main] Failed to start kswarm service:', err);
  });
  shutdownAwareIpc.handle('desktop:kswarm:getStatus', () => kswarmService.getStatus());
  shutdownAwareIpc.handle('desktop:kswarm:start', () => kswarmService.start());
  shutdownAwareIpc.handle('desktop:kswarm:stop', () => kswarmService.stop());
  shutdownAwareIpc.handle('desktop:kswarm:restart', () => kswarmService.restart());
  shutdownAwareIpc.handle('desktop:kswarm:resumeWorkflowRun', (_event, input) =>
    resumeOneScriptWorkflow(kswarmService, input?.projectId, input?.workflowRunId));
  let restartRuntimeBridgeService: () => Promise<void> = async () => {};
  shutdownAwareIpc.handle('desktop:services:getStatus', async () => {
    const snapshot = await kswarmService.getServiceStatus();
    return {
      ...snapshot,
      services: [
        ...snapshot.services,
        {
          id: 'runtime-bridge',
          label: 'Runtime Bridge',
          running: runtimeBridgeStarted,
          reachable: runtimeBridgeStarted,
          port: 0,
          pid: null,
          restartCount: 0,
          lastError: null,
          detail: runtimeBridgeStarted ? `${runtimeBridgeClients.length} client(s) registered` : 'not started',
        },
      ],
    };
  });
  shutdownAwareIpc.handle('desktop:services:restart', (_event, serviceId) => (
    serviceId === 'runtime-bridge'
      ? restartRuntimeBridgeService()
      : kswarmService.restartRelatedService(serviceId)
  ));
  kswarmService.onStatusChange((status) => {
    window.webContents.send('desktop:kswarm:statusChange', status);
  });

  const kswarmStreamBridge = new KSwarmStreamBridge('ws://127.0.0.1:4400/ws');
  kswarmStreamBridge.start();
  registerKSwarmProxy(shutdownAwareIpc, kswarmStreamBridge, kswarmService);

  const { getConfigDir, loadConfig, saveConfig } = await import('../../src/utils/config.js');
  const dataRoot = getConfigDir('desktop');
  const executionCoordinator = new DesktopExecutionCoordinator();
  const services = createDesktopServices({
    dataRoot,
    kswarmService,
    // Design v58 §4/§9.3: the facade exists before services, so every static
    // gateway captures one stable identity instead of a temporary runtime.
    pluginProviderRuntime,
    executionCoordinator,
  });
  let loopStoreRef: import('./loop-store.js').LoopStore | undefined;
  const mobileIdentity = loadOrCreateMobileIdentity(dataRoot);
  const mobileBonjourAdvertiser = createMobileBonjourAdvertiser();
  const mobileMessages: MobileChatMessage[] = [];
  const getMobileSnapshot = async () => {
    const activeTask = await services.getActiveTask().catch(() => null);
    const snapshots = readRecentTaskSnapshots(dataRoot);
    if (activeTask && !snapshots.some(snapshot => snapshot.taskId === activeTask.taskId)) {
      const recovered = await services.recoverTask(activeTask.taskId).catch(() => null);
      if (recovered?.snapshot) snapshots.unshift(recovered.snapshot);
    }
    const loopDefinitions = loopStoreRef?.listLoopDefinitions() ?? [];
    const loopRunsByLoopId = new Map(loopDefinitions.map(definition => [
      definition.id,
      loopStoreRef?.listLoopRuns(definition.id, 1) ?? [],
    ]));
    return buildMobileSnapshotFromSources({
      desktopName: 'Xiaok Desktop',
      activeTaskId: activeTask?.taskId ?? null,
      mobileMessages,
      snapshots,
      kswarmProjects: await fetchKSwarmProjectsForMobile(kswarmService).catch(() => []),
      loopDefinitions,
      userLoopTemplates: loopStoreRef?.listUserLoopTemplates() ?? [],
      loopRunsByLoopId,
    });
  };
  const sendMobileMessage = async (text: string) => {
    const created = await services.createTask({ prompt: text, materials: [] });
    const sequence = Date.now();
    const userMessage = {
      id: `mobile-user-${sequence}`,
      conversationId: created.taskId,
      role: 'user' as const,
      text,
      createdAt: new Date(sequence).toISOString(),
      deliveryStatus: 'sent' as const,
    };
    mobileMessages.push(userMessage);
    mobileMessages.splice(0, Math.max(0, mobileMessages.length - 30));
    return [
      {
        type: 'chat.message_appended' as const,
        sequence,
        message: userMessage,
      },
      {
        type: 'turn.started' as const,
        sequence: sequence + 1,
        turn: {
          id: created.taskId,
          title: text.slice(0, 80) || 'Mobile message',
          status: 'running' as const,
        },
      },
      { type: 'snapshot.required' as const, sequence: sequence + 2 },
    ];
  };
  const respondMobileApproval = async (input: { id: string; decision: MobileApprovalDecision }) => {
    const [taskId, questionId] = input.id.split(':');
    if (!taskId || !questionId) throw new Error('invalid_mobile_approval_id');
    const recovered = await services.recoverTask(taskId);
    const event = recovered.snapshot.events.find(candidate => (
      candidate.type === 'needs_user' && candidate.question.questionId === questionId
    ));
    if (!event || event.type !== 'needs_user') throw new Error('mobile_approval_not_found');
    const answer = resolveMobileApprovalAnswer(event.question, input.decision);
    if (!answer) throw new Error('mobile_approval_not_resolvable');
    await services.answerQuestion({ taskId, answer });
    return {
      id: input.id,
      title: event.question.prompt.slice(0, 80),
      detail: event.question.choices?.map(choice => choice.label).join(' / ') ?? event.question.kind,
      risk: 'low',
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      createdAt: new Date().toISOString(),
    };
  };
  const getMobileArtifactPreview = async (artifactId: string) => (
    findMobileArtifactPreview(dataRoot, artifactId)
      ?? await findKSwarmMobileArtifactPreview(kswarmService, artifactId)
  );
  const mobileGateway = createMobileGateway({
    host: process.env.XIAOK_MOBILE_GATEWAY_HOST ?? '0.0.0.0',
    port: Number(process.env.XIAOK_MOBILE_GATEWAY_PORT ?? '47891'),
    desktopName: 'Xiaok Desktop',
    desktopId: mobileIdentity.desktopId,
    mobileAccessToken: mobileIdentity.mobileAccessToken,
    getSnapshot: getMobileSnapshot,
    sendMessage: sendMobileMessage,
    respondToApproval: respondMobileApproval,
    getArtifactPreview: getMobileArtifactPreview,
    onRequest: (event) => {
      debugMain('mobile-gateway:request', event);
    },
  });
  const mobileRelayConfig = loadMobileRelayConfig();
  /**
   * Kept so the renderer can ask for the current relay state at any time. When no
   * credentials file exists at all, there is no bridge to report status, so we
   * synthesise the `missing` state rather than showing nothing.
   */
  let latestMobileRelayStatus: MobileRelayStatus = mobileRelayConfig
    ? {
      running: false,
      connected: false,
      relayUrl: mobileRelayConfig.relayUrl,
      roomId: '',
      lastError: null,
      credentialState: 'ok',
      requiresUserReauth: false,
    }
    : {
      running: false,
      connected: false,
      relayUrl: '',
      roomId: '',
      lastError: 'no relay credentials found; sign in to enable mobile access',
      credentialState: 'missing',
      requiresUserReauth: true,
    };
  shutdownAwareIpc.handle('desktop:mobile:getRelayStatus', () => latestMobileRelayStatus);
  /**
   * Deliberately not a generic "open any URL" bridge: the renderer can only ask
   * for the relay's own sign-in page, and the URL is derived here from the relay
   * config rather than accepted from the caller.
   */
  shutdownAwareIpc.handle('desktop:mobile:openRelaySignIn', () => {
    const relayUrl = mobileRelayConfig?.relayUrl ?? latestMobileRelayStatus.relayUrl;
    if (!relayUrl) return { ok: false as const, error: 'relay_url_unknown' };
    const signInUrl = `${relayUrl.replace(/^ws/, 'http').replace(/\/ws$/, '')}/auth/login`;
    void shell.openExternal(signInUrl);
    debugMain('mobile-relay:sign-in-opened', { signInUrl });
    return { ok: true as const, url: signInUrl };
  });
  shutdownAwareIpc.handle('desktop:mobile:getPairingInfo', () => buildMobilePairingPayload({
    desktopName: 'Xiaok Desktop',
    identity: mobileIdentity,
    gatewayStatus: mobileGateway.getStatus(),
    relayUrl: mobileRelayConfig?.relayUrl,
    relayJwt: mobileRelayConfig?.relayJwt,
  }));
  const mobileRelayBridge = mobileRelayConfig
    ? createMobileRelayBridge({
      identity: mobileIdentity,
      desktopName: 'Xiaok Desktop',
      relayUrl: mobileRelayConfig.relayUrl,
      relayJwt: mobileRelayConfig.relayJwt,
      getHello: () => ({
        desktopId: mobileIdentity.desktopId,
        desktopName: 'Xiaok Desktop',
        protocol: 'mobile-v1',
        health: 'online',
        reachableURLs: mobileGateway.getStatus().reachableURLs,
      }),
      getSnapshot: getMobileSnapshot,
      sendMessage: sendMobileMessage,
      respondToApproval: respondMobileApproval,
      getArtifactPreview: getMobileArtifactPreview,
      onStatus: (status) => {
        debugMain('mobile-relay:status', {
          running: status.running,
          connected: status.connected,
          relayUrl: status.relayUrl,
          roomId: status.roomId,
          credentialState: status.credentialState,
          ...(status.credentialExpiresAt ? { credentialExpiresAt: status.credentialExpiresAt } : {}),
          requiresUserReauth: status.requiresUserReauth,
          lastError: status.lastError,
        });
        // A credential problem is terminal until the user signs in again, so say
        // exactly that once instead of repeating a bare 401 every 30 seconds.
        if (status.requiresUserReauth) {
          debugMain('mobile-relay:reauth-required', {
            credentialState: status.credentialState,
            credentialExpiresAt: status.credentialExpiresAt ?? null,
            action: `open ${status.relayUrl.replace(/^ws/, 'http').replace(/\/ws$/, '')}/auth/login to sign in again`,
          });
        }
        latestMobileRelayStatus = status;
        if (!window.isDestroyed()) {
          window.webContents.send('desktop:mobileRelayStatus', status);
        }
      },
    })
    : null;
  mobileGateway.start()
    .then((status) => {
      debugMain('mobile-gateway:started', status);
      mobileBonjourAdvertiser.start({
        name: 'Xiaok Desktop',
        port: status.port,
        txt: { protocol: 'mobile-v1' },
      });
      debugMain('mobile-gateway:bonjour', mobileBonjourAdvertiser.getStatus());
    })
    .catch((err) => debugMain('mobile-gateway:start-failed', err instanceof Error ? err.message : String(err)));
  if (mobileRelayBridge) {
    mobileRelayBridge.start();
  } else {
    debugMain('mobile-relay:disabled', 'missing relay credentials');
  }
  const loopNotificationPort = createElectronDesktopNotificationPort();
  const loopLlmPort = createDesktopLoopLLMPort(executionCoordinator);
  const loopRuntime = createDesktopLoopRuntime({
    dataRoot,
    taskPort: {
      createTask: (input) => services.createTask(input),
      recoverTask: (taskId) => services.recoverTask(taskId),
      cancelTask: (taskId, reason) => services.cancelTask(taskId, reason),
    },
    llmPort: loopLlmPort,
    onConstraintAdded: (constraint) => {
      try {
        const template = loopStoreRef?.getUserLoopTemplate(constraint.loopId);
        const definition = loopStoreRef?.getLoopDefinition(constraint.loopId);
        const loopTitle = definition?.title ?? template?.prompt?.slice(0, 60) ?? constraint.loopId;
        const sourceLabel = constraint.source === 'llm_extraction' ? 'AI 分析' : '规则匹配';
        void loopNotificationPort.show({
          title: `循环改进建议（${sourceLabel}）：${loopTitle}`,
          body: `${constraint.rule}\n点击查看 Automations → 约束规则`,
          silent: false,
          onClick: () => {
            try {
              if (window.isDestroyed()) return;
              if (window.isMinimized()) window.restore();
              window.show();
              window.focus();
              window.webContents.send('desktop:loops:constraintAdded', constraint);
            } catch {
              // ignore window restore failures
            }
          },
        });
      } catch (e) {
        console.warn('[main] loop constraint notification failed:', (e as Error)?.message);
      }
      try {
        if (!window.isDestroyed()) {
          window.webContents.send('desktop:loops:constraintAdded', constraint);
        }
      } catch (e) {
        console.warn('[main] loop constraint IPC send failed:', (e as Error)?.message);
      }
    },
    kswarmHealthProbe: () => kswarmService.getHealthDiagnosticInput(),
    kswarmHealthLogPaths: [
      join(resolveKSwarmServiceLogRoot(USER_DATA_DIR), 'server.log'),
      join(resolveKSwarmServiceLogRoot(USER_DATA_DIR), 'broker.log'),
    ],
  });
  loopStoreRef = loopRuntime.loopStore;

  try {
    await services.recoverStaleTasks();
  } catch (err) {
    console.error('[main] recoverStaleTasks failed (startup continues):', err);
  }
  try {
    await services.reconcileArtifactWorkspace();
  } catch (err) {
    console.error('[main] reconcileArtifactWorkspace failed (startup continues):', err);
  }

  shutdownAwareIpc.handle('desktop:getConnectorsConfig', () => services.getConnectorsConfig());
  shutdownAwareIpc.handle('desktop:saveConnectorsConfig', (_event, input) => services.setConnectorsConfig(input));
  shutdownAwareIpc.handle('desktop:listConnectorRuntimes', () => services.listConnectorRuntimes());
  shutdownAwareIpc.handle('desktop:testConnectorProvider', (_event, kind) => services.testConnectorProvider(kind));

  // Register update IPC handlers
  shutdownAwareIpc.handle('desktop:getUpdateStatus', () => {
    try {
      return { ...getUpdateStatus(), currentVersion: app.getVersion() };
    } catch (e) {
      return { checking: false, available: false, downloading: false, downloaded: false, progress: 0, error: (e as Error).message, currentVersion: app.getVersion() };
    }
  });
  shutdownAwareIpc.handle('desktop:checkForUpdates', async () => {
    try {
      await checkForUpdates();
    } catch (e) {
      // Error already handled in checkForUpdates
    }
  });
  /**
   * Design v58 §5.5 / R28-05: this handler must never write `isQuitting`. On
   * macOS the updater may only register an `update-downloaded` listener and
   * return, and during that wait closing the window must still hide rather than
   * quit. Only the coordinator's real `before-quit` phase ① sets the flag.
   */
  shutdownAwareIpc.handle('desktop:quitAndInstall', () => {
    const outcome = updaterHandoff.begin();
    return { ...outcome, projection: updaterHandoff.projection() };
  });

  let globalBackgroundAutoRunEnabled = (await loadConfig()).automations?.globalBackgroundAutoRunEnabled !== false;
  const automationsConfigSnapshot = () => ({ globalBackgroundAutoRunEnabled });
  shutdownAwareIpc.handle('desktop:automations:getConfig', () => automationsConfigSnapshot());
  shutdownAwareIpc.handle('desktop:automations:setGlobalBackgroundAutoRun', async (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    const config = await loadConfig();
    globalBackgroundAutoRunEnabled = input.enabled;
    config.automations = {
      ...(config.automations ?? {}),
      globalBackgroundAutoRunEnabled,
    };
    await saveConfig(config);
    return automationsConfigSnapshot();
  });

  // Unified timed action daemon: notification reminders and automatic AI tasks share one scheduler.
  const timedActionStore = new TimedActionStore(join(dataRoot, 'timed-actions.sqlite'));
  const timedActionService = new TimedActionService(timedActionStore);
  const threadMetaStore = new ThreadMetaStore(join(dataRoot, 'thread-meta.sqlite'));
  services.registerTimedActionService(timedActionService);
  const assistantService = new AssistantService({
    loopStore: loopRuntime.loopStore,
    timedActionService,
  });
  assistantService.bootstrap();
  const projectCwdById = new Map<string, string>();
  void fetchKSwarmProjectsForMobile(kswarmService).then(projects => {
    for (const project of projects) {
      if (typeof project.id === 'string' && typeof project.workFolder === 'string' && project.workFolder.trim()) {
        projectCwdById.set(project.id, project.workFolder.trim());
      }
    }
  }).catch(() => {});
  const knowledgeBaseStore = services.getKnowledgeBaseStore();
  const assistantSnapshotReader = createAssistantDesktopSnapshotReader({
    listTaskSnapshots: ({ from, to }) => readRecentTaskSnapshots(dataRoot, 100)
      .filter(snapshot => snapshot.updatedAt >= from && snapshot.updatedAt <= to)
      .map(snapshot => ({
        id: snapshot.taskId,
        threadId: snapshot.context?.threadId ?? snapshot.sessionId,
        title: snapshot.understanding?.goal ?? snapshot.prompt.slice(0, 160),
        status: snapshot.status,
        summary: snapshot.result?.summary ?? snapshot.understanding?.nextAction,
        updatedAt: snapshot.updatedAt,
        artifacts: (snapshot.result?.artifacts ?? []).map(artifact => ({
          id: artifact.artifactId,
          title: artifact.title,
          summary: artifact.kind,
          updatedAt: Number.isFinite(Date.parse(artifact.createdAt)) ? Date.parse(artifact.createdAt) : snapshot.updatedAt,
        })),
      })),
    listKSwarmProjects: async ({ from, to }) => {
      const projects = await fetchKSwarmProjectsForMobile(kswarmService);
      return projects.flatMap(project => {
        const id = typeof project.id === 'string' ? project.id : '';
        const name = typeof project.name === 'string' ? project.name : '';
        const updatedAt = typeof project.updatedAt === 'number'
          ? project.updatedAt
          : typeof project.createdAt === 'number' ? project.createdAt : 0;
        if (!id || !name || updatedAt < from || updatedAt > to) return [];
        if (typeof project.workFolder === 'string' && project.workFolder.trim()) {
          projectCwdById.set(id, project.workFolder.trim());
        }
        return [{
          id,
          name,
          status: typeof project.status === 'string' ? project.status : undefined,
          summary: typeof project.summary === 'string' ? project.summary : undefined,
          updatedAt,
        }];
      });
    },
    listTimedActions: ({ from, to }) => timedActionService.getActions().flatMap(action => {
      const dueAt = action.lastDueAt ?? action.nextDueAt;
      const occurrenceAt = typeof dueAt === 'number' && dueAt >= from && dueAt <= to ? dueAt : action.updatedAt;
      if (occurrenceAt < from || occurrenceAt > to) return [];
      return [{
        id: action.id,
        title: action.title,
        status: action.status,
        triggerKind: action.trigger.kind,
        dueAt,
        updatedAt: action.updatedAt,
      }];
    }),
    listMeetingMetadata: ({ from, to }) => knowledgeBaseStore.listMeetings()
      .filter(meeting => meeting.updatedAt >= from && meeting.updatedAt <= to)
      .map(meeting => ({
        id: meeting.id,
        title: meeting.title || meeting.id,
        status: meeting.status,
        summary: meeting.failureReason || undefined,
        updatedAt: meeting.updatedAt,
      })),
    listKnowledgeSourceMetadata: ({ from, to }) => knowledgeBaseStore.listCollections()
      .flatMap(collection => knowledgeBaseStore.listSources(collection.id))
      .filter(source => source.updatedAt >= from && source.updatedAt <= to)
      .map(source => ({
        id: source.id,
        collectionId: source.collectionId,
        title: source.title,
        status: source.parseStatus,
        summary: typeof source.metadata.summary === 'string' ? source.metadata.summary : undefined,
        updatedAt: source.updatedAt,
      })),
  });
  const assistantRuntime = createAssistantRuntime({
    loopStore: loopRuntime.loopStore,
    evidenceStore: loopRuntime.evidenceStore,
    llmPort: loopLlmPort,
    collect: async input => {
      const snapshot = await assistantSnapshotReader.collect(input);
      if (input.kind === 'evening') return snapshot;
      return buildAssistantMorningContext({
        snapshot,
        eveningRun: loopRuntime.loopStore.listLoopRuns(ASSISTANT_EVENING_LOOP_ID, 10)
          .find(run => run.status === 'success'),
        pendingCandidates: loopRuntime.loopStore.listAssistantCandidates({ statuses: ['pending'] }),
        pinnedThreadIds: [...threadMetaStore.getThreadIds('pinned')],
      });
    },
  });
  const assistantAwareRunner = createLoopExecutionAdapter({
    genericRunner: loopRuntime.runner,
    assistantRuntime,
  });
  const assistantController = new AssistantController({
    assistantService,
    candidates: loopRuntime.loopStore,
    memoryStore: getDesktopMemoryStore(dataRoot),
    memoryBackend: getDesktopMemoryBackend(dataRoot),
    kbStore: knowledgeBaseStore,
    resolveProjectCwd: projectId => projectCwdById.get(projectId),
    listMorningSuggestions: () => listLatestMorningSuggestions({
      listRuns: () => loopRuntime.loopStore.listLoopRuns(ASSISTANT_MORNING_LOOP_ID, 10),
      listEvidence: runId => loopRuntime.evidenceStore.listEvidenceForOwner('loop_run', runId),
    }),
  });
  void assistantController.recoverAccepting().catch(error => {
    console.warn('[main] assistant candidate recovery failed:', (error as Error).message);
  });
  const kswarmTeamService = createKSwarmTeamService({
    kswarmService,
    needsProposal: createProjectCapabilityNeedsProposalPort(loopLlmPort),
  });
  const kswarmSemanticService = createKSwarmSemanticService({
    kswarmService,
    teamService: kswarmTeamService,
  });
  const collaborationRoomBrokerClient = createCollaborationRoomBrokerClient({
    token: kswarmService.getIntentBrokerRoomToken(),
  });
  const emitCollaborationRoomEvent = (event: unknown) => {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop:collaborationRoom:event', event);
    }
  };
  const collaborationRoomWakeDispatcher = createCollaborationRoomWakeDispatcher({
    brokerClient: collaborationRoomBrokerClient,
    canExecute: async logicalAgentId => {
      if (logicalAgentId === 'xiaok-po' || logicalAgentId === XIAOK_WORKER_SEED_ID) return true;
      try {
        const response = await kswarmService.request('/agents');
        if (!response.ok) return false;
        const body = await response.json() as { agents?: Array<Record<string, unknown>> };
        const agent = body.agents?.find(candidate => candidate.id === logicalAgentId);
        if (!agent) return false;
        const execution = agent.execution && typeof agent.execution === 'object'
          ? agent.execution as { mode?: unknown; hostParticipantId?: unknown }
          : null;
        return agent.runtimeSource === 'desktop-agent-runtime'
          || (execution?.mode === 'hosted' && execution.hostParticipantId === XIAOK_DESKTOP_HOST_PARTICIPANT_ID);
      } catch {
        return false;
      }
    },
    execute: input => services.runCollaborationRoomAgentTask(input),
    onEvent: emitCollaborationRoomEvent,
  });
  const collaborationRoomService = createCollaborationRoomService({
    brokerClient: collaborationRoomBrokerClient,
    kswarmClient: {
      request: (path, init) => kswarmService.request(path, {
        ...(init as RequestInit | undefined),
        headers: {
          'x-kswarm-mutation-token': kswarmService.getDesktopMutationToken(),
          ...((init as RequestInit | undefined)?.headers ?? {}),
        },
      }),
    },
    sagaJournal: createRoomProjectSagaJournal({
      dbPath: join(USER_DATA_DIR, 'room-project-saga.sqlite'),
    }),
    wakeDispatcher: collaborationRoomWakeDispatcher,
    emitRoomEvent: emitCollaborationRoomEvent,
  });
  registerSemanticDesktopIpc(shutdownAwareIpc, {
    assistant: assistantController,
    kswarm: kswarmSemanticService,
    collaborationRooms: collaborationRoomService,
  });
  await registerDesktopIpc(shutdownAwareIpc, window, services, {
    loopRuntime: { ...loopRuntime, runner: assistantAwareRunner },
  });
  debugMain('createWindow:ipc-registered');
  shutdownAwareIpc.handle('desktop:automations:getOverviewSnapshot', () => buildAutomationOverviewSnapshot({
    loopStore: loopRuntime.loopStore,
    timedActionStore,
    globalBackgroundAutoRunEnabled,
  }));
  shutdownAwareIpc.handle('desktop:automations:getRunHistory', () => buildAutomationRunHistory({
    loopStore: loopRuntime.loopStore,
    timedActionStore,
  }));

  // Register channel tools with AI runner (for sending messages to yunzhijia, discord, etc.)
  services.registerChannelTools();

  // Register skill tools with AI runner (for installing/uninstalling skills)
  services.registerSkillTools();

  // Deploy bundled plugins (report-creator, slide-creator) to ~/.xiaok/plugins/
  const deployResult = await deployBundledPlugins();
  debugMain('createWindow:plugins-deployed', deployResult);
  if (deployResult.venvReady) {
    const venvDir = getConfigDir(join('runtime', 'python-env'));
    process.env.XIAOK_PYTHON_CMD = process.platform === 'win32'
      ? join(venvDir, 'Scripts', 'python.exe')
      : join(venvDir, 'bin', 'python3');
  }

  // Register MCP plugin tools (connects to MCP servers declared in the plugins dir)
  let mcpDispose: (() => void) | undefined;
  const runtimeBridgeClients: Array<{ start(): Promise<void>; stop(): void }> = [];
  let runtimeBridgeStarted = false;
  let runtimeBridgeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const stopRuntimeBridge = () => {
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    for (const client of runtimeBridgeClients.splice(0)) client.stop();
    runtimeBridgeStarted = false;
  };
  const startRuntimeBridge = () => {
    if (runtimeBridgeStarted) return;
    runtimeBridgeStarted = true;
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    void kswarmStartPromise.then(async () => {
      const { loadConfig } = await import('../../src/utils/config.js');
      const cfg = await loadConfig();
      const rawConcurrency = cfg.kswarm?.maxConcurrentTasks ?? 3;
      const maxConcurrentTasks = Math.max(1, Math.min(10, rawConcurrency));
      const brokerUrl = 'http://127.0.0.1:4318';
      const kswarmHandoffRoots = [join(app.getPath('home'), '.kswarm', 'handoff-packages')];
      const runtimeBridge = {
        ...createKSwarmRuntimeBridge({
        allowedRoots: kswarmHandoffRoots,
        runDesktopTask: (input) => services.runKSwarmHandoffTask(input),
        runWorkflowNode: (input) => services.runKSwarmWorkflowNode(input),
        submitResult: (input) => submitKSwarmRuntimeResultToBroker({
          brokerUrl,
          participantId: XIAOK_DESKTOP_HOST_PARTICIPANT_ID,
          logicalParticipantId: input.targetParticipantId || XIAOK_WORKER_SEED_ID,
          projectId: input.projectId,
          taskId: input.taskId,
          runId: input.runId,
          result: input.result,
        }),
        submitWorkflowNodeResult: (input) => submitKSwarmWorkflowNodeResultToBroker({
          brokerUrl,
          participantId: XIAOK_DESKTOP_HOST_PARTICIPANT_ID,
          logicalParticipantId: input.targetParticipantId || XIAOK_WORKER_SEED_ID,
          handoff: input.handoff,
          output: input.output,
          reviewDecision: input.reviewDecision,
        }),
        }),
        handleAssignPo: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmAssignPo(input),
        handleReviewSubmission: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmReviewSubmission(input),
        handlePlanApproved: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmPlanApproved(input),
        handleReadinessProbe: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmReadinessProbe(input),
      };
      runtimeBridgeClients.push(
        createKSwarmRuntimeBridgeBrokerClient({
          brokerUrl,
          participantId: XIAOK_DESKTOP_HOST_PARTICIPANT_ID,
          participantKind: 'service',
          alias: 'Xiaok Desktop',
          roles: ['desktop_runtime_host'],
          capabilities: ['research', 'analysis', 'coding', 'testing', 'design', 'planning', 'reporting', 'slides'],
          allowedRoots: kswarmHandoffRoots,
          bridge: runtimeBridge,
          maxConcurrentTasks,
        }),
      );
      for (const client of runtimeBridgeClients) {
        client.start().catch((error) => {
          console.warn('[main] Failed to start kswarm runtime bridge client:', (error as Error).message);
        });
      }
    });
  };
  restartRuntimeBridgeService = async () => {
    stopRuntimeBridge();
    startRuntimeBridge();
  };

  let powerSuspendedAtMs = 0;
  const postRuntimePower = async (path: '/runtime/suspend' | '/runtime/resume', body?: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      await fetch(`http://127.0.0.1:4400${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      console.warn(`[main] kswarm ${path} call failed:`, (error as Error).message);
    } finally {
      clearTimeout(timer);
    }
  };
  powerMonitor.on('suspend', () => {
    powerSuspendedAtMs = Date.now();
    debugMain('powerMonitor:suspend');
    void postRuntimePower('/runtime/suspend');
  });
  powerMonitor.on('resume', () => {
    const sleptMs = powerSuspendedAtMs ? Date.now() - powerSuspendedAtMs : 0;
    powerSuspendedAtMs = 0;
    debugMain('powerMonitor:resume');
    void restartRuntimeBridgeService();
    void postRuntimePower('/runtime/resume', { sleptMs });
  });

  runtimeBridgeFallbackTimer = setTimeout(startRuntimeBridge, 10_000);
  services.registerMcpTools().then(async ({ dispose }) => {
    mcpDispose = dispose;
    // Design v58 §9.3: start the provider runtime only after the reserved MCP
    // connections exist, so activation can verify each server's full operation
    // set instead of committing a half-ready slot.
    const started = await services.startPluginProviderRuntime().catch((error) => {
      debugMain('provider-runtime:start-failed', error instanceof Error ? error.message : String(error));
      return { started: false as const };
    });
    debugMain('provider-runtime:start', started);
    startRuntimeBridge();
  }).catch(() => {
    startRuntimeBridge();
  });
  debugMain('createWindow:mcp-registration-started');

  const timedActionScheduler = new TimedActionScheduler(timedActionStore, {
    executors: createDesktopTimedActionExecutors({
      getMainWindow: () => window,
      loopRuntime,
      assistantRuntime,
      createTask: (input) => services.createTask(input),
    }),
    isGlobalBackgroundAutoRunEnabled: () => globalBackgroundAutoRunEnabled,
    resolveLinkedLoopRun: ({ action, timedActionRunId }) => loopRuntime.resolveTimedActionLoopRun({
      action,
      timedActionRunId,
    }),
    onRunComplete: (event) => {
      if (event.action.executor.kind !== 'agent_task') return;
      if (window.isDestroyed()) return;
      const success = event.status === 'success';
      const title = event.action.title || event.action.id;
      window.webContents.send('desktop:scheduledTaskDue', {
        taskId: event.action.id,
        runtimeTaskId: event.runtimeTaskId,
        completed: true,
        success,
        title,
        lastRunAt: event.action.lastDueAt ?? event.finishedAt,
        nextRunAt: event.action.nextDueAt,
        error: event.error,
      });
      try {
        const notificationPort = createElectronDesktopNotificationPort();
        const notificationTitle = success
          ? `定时任务已完成：${title}`
          : `定时任务失败：${title}`;
        const notificationBody = success
          ? '点击查看运行结果。'
          : (event.error ? `失败原因：${event.error}` : '点击查看失败详情。');
        void notificationPort.show({
          title: notificationTitle,
          body: notificationBody,
          silent: false,
          onClick: () => {
            try {
              if (window.isDestroyed()) return;
              if (window.isMinimized()) window.restore();
              window.show();
              window.focus();
              window.webContents.send('desktop:scheduledTaskFocus', {
                taskId: event.action.id,
                runtimeTaskId: event.runtimeTaskId,
              });
            } catch { /* focus is best-effort */ }
          },
        });
      } catch { /* notification is best-effort */ }
    },
  });
  timedActionScheduler.start();

  shutdownAwareIpc.handle('desktop:syncScheduledTasks', (_event, tasks) => {
    // Deprecated compatibility endpoint. Renderer must not replace main state.
    return timedActionService.listScheduledTasks();
  });
  shutdownAwareIpc.handle('desktop:getScheduledTasks', () => {
    return timedActionService.listScheduledTasks();
  });
  shutdownAwareIpc.handle('desktop:createScheduledTask', (_event, input) => {
    return timedActionService.createScheduledTask(input);
  });
  shutdownAwareIpc.handle('desktop:loops:createSchedule', (_event, input) => {
    debugMain('loops:createSchedule', { loopId: (input as any)?.loopId, title: (input as any)?.title });
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('loop schedule input must be an object');
      }
      const record = input as Record<string, unknown>;
      const loopId = typeof record.loopId === 'string' && record.loopId.trim().length > 0
        ? record.loopId
        : '';
      if (!loopId) {
        throw new Error('loopId must be a non-empty string');
      }
      const template = loopRuntime.loopStore.getUserLoopTemplate(loopId);
      if (!template) {
        throw new Error('user loop template does not exist');
      }
      if (!record.trigger || typeof record.trigger !== 'object' || Array.isArray(record.trigger)) {
        throw new Error('trigger must be an object');
      }
      const result = timedActionService.createLoopSchedule({
        id: typeof record.id === 'string' ? record.id : undefined,
        loopId,
        title: typeof record.title === 'string' && record.title.trim().length > 0
          ? record.title
          : loopRuntime.loopStore.getLoopDefinition(loopId)?.title ?? 'Loop schedule',
        description: typeof record.description === 'string' ? record.description : undefined,
        trigger: record.trigger as never,
        source: 'user',
      });
      debugMain('loops:createSchedule ok', { loopId, actionId: (result as any)?.id });
      return result;
    } catch (e) {
      debugMain('loops:createSchedule failed', { error: String(e) });
      throw e;
    }
  });
  shutdownAwareIpc.handle('desktop:loops:getScheduleBindings', () => {
    return timedActionService.listLoopScheduleBindings();
  });
  shutdownAwareIpc.handle('desktop:updateScheduledTask', (_event, input) => {
    return timedActionService.updateScheduledTask(input);
  });
  shutdownAwareIpc.handle('desktop:setScheduledTaskStatus', (_event, id: string, status: 'active' | 'paused') => {
    return timedActionService.setScheduledTaskStatus(id, status) ?? null;
  });
  shutdownAwareIpc.handle('desktop:cancelScheduledTask', (_event, id: string) => {
    return timedActionService.cancelScheduledTask(id);
  });
  shutdownAwareIpc.handle('desktop:getTimedActions', () => {
    return timedActionService.getActions();
  });
  shutdownAwareIpc.handle('desktop:getTimedActionRuns', (_event, actionId: string) => {
    return timedActionService.getRuns(actionId);
  });
  shutdownAwareIpc.handle('desktop:scheduledTasks:clearRunHistory', (_event, actionId: string, statuses?: unknown) => {
    if (typeof actionId !== 'string' || actionId.trim().length === 0) {
      throw new Error('actionId must be a non-empty string');
    }
    const validStatuses = Array.isArray(statuses) && statuses.every((s) => typeof s === 'string')
      ? (statuses as string[])
      : undefined;
    const removed = timedActionStore.clearActionRunHistory(actionId, validStatuses);
    return { ok: true, removed };
  });
  shutdownAwareIpc.handle('desktop:timedAction:approveAuto', (_event, actionId: string) => {
    return timedActionService.approveAuto(actionId) ?? null;
  });
  shutdownAwareIpc.handle('desktop:timedAction:revokeAuto', (_event, actionId: string) => {
    return timedActionService.revokeAuto(actionId) ?? null;
  });

  // Thread meta (GTD / pinned) — persistent via SQLite in main process
  onSkillCatalogChanged(() => {
    if (window.isDestroyed()) return;
    window.webContents.send('desktop:skillsChanged');
  });
  const broadcastThreadMeta = () => {
    if (window.isDestroyed()) return;
    window.webContents.send('desktop:threadMetaChanged', threadMetaStore.getAll());
  };
  shutdownAwareIpc.handle('desktop:getThreadLabels', () => {
    return threadMetaStore.getAll();
  });
  shutdownAwareIpc.handle('desktop:setThreadLabel', (_event, threadId: string, label: string) => {
    const result = threadMetaStore.addThreadToLabel(threadId, label as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  shutdownAwareIpc.handle('desktop:unsetThreadLabel', (_event, threadId: string, label: string) => {
    const result = threadMetaStore.removeThreadFromLabel(threadId, label as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  shutdownAwareIpc.handle('desktop:moveThreadLabel', (_event, threadId: string, from: string, to: string) => {
    const result = threadMetaStore.moveThread(threadId, from as any, to as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  shutdownAwareIpc.handle('desktop:getAppFlag', (_event, key: string) => {
    return threadMetaStore.getFlag(key as any);
  });
  shutdownAwareIpc.handle('desktop:setAppFlag', (_event, key: string, value: string) => {
    const result = threadMetaStore.setFlag(key as any, value);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  shutdownAwareIpc.handle('desktop:migrateLegacyThreadMeta', (_event, data: any) => {
    const result = threadMetaStore.bulkImport(data);
    if (result.ok) broadcastThreadMeta();
    return result;
  });

  // Design v58 §5.5: both former `before-quit` listeners are now steps of the
  // single coordinator-owned lifetime disposer, so each runs at most once and
  // provider close is actually awaited before the process exits.
  registerLifetimeDisposerStep('provider-runtime', () => pluginProviderRuntime.dispose());
  registerLifetimeDisposerStep('kswarm-and-bridges', async () => {
    await kswarmService.stop().catch((err) => {
      debugMain('kswarmService.stop failed', err instanceof Error ? err.message : String(err));
    });
    kswarmStreamBridge.dispose();
    if (runtimeBridgeFallbackTimer) {
      clearTimeout(runtimeBridgeFallbackTimer);
      runtimeBridgeFallbackTimer = null;
    }
    for (const client of runtimeBridgeClients) client.stop();
    timedActionScheduler.stop();
    loopRuntime.close();
    timedActionStore.close();
    mobileBonjourAdvertiser.stop();
    mobileGateway.stop().catch((err) => {
      debugMain('mobileGateway.stop failed', err instanceof Error ? err.message : String(err));
    });
    mobileRelayBridge?.stop();
    mcpDispose?.();
  });

  // Reminder IPC handlers
  shutdownAwareIpc.handle('desktop:createReminder', (_event, input: { content: string; scheduleAt: number; timezone?: string }) => {
    return timedActionService.createReminder(input.content, input.scheduleAt, input.timezone);
  });
  shutdownAwareIpc.handle('desktop:listReminders', () => timedActionService.listReminders());
  shutdownAwareIpc.handle('desktop:cancelReminder', (_event, id: string) => timedActionService.cancelReminder(id));
  shutdownAwareIpc.handle('desktop:getReminderStatus', () => timedActionService.getReminderStatus());

  // Skill debug config IPC handlers
  shutdownAwareIpc.handle('desktop:getSkillDebugConfig', () => services.getSkillDebugConfig());
  shutdownAwareIpc.handle('desktop:saveSkillDebugConfig', (_event, input: { enabled: boolean }) => services.saveSkillDebugConfig(input));

  // KSwarm config IPC handlers
  shutdownAwareIpc.handle('desktop:getKswarmConfig', () => services.getKswarmConfig());
  shutdownAwareIpc.handle('desktop:saveKswarmConfig', (_event, input: { maxConcurrentTasks: number }) => services.saveKswarmConfig(input));

  // Setup menubar with K icon
  setupMenuBar(window);
  debugMain('createWindow:menubar-ready');

  // Setup auto-updater (production only)
  if (process.env.NODE_ENV !== 'development' && !process.env.XIAOK_DESKTOP_DEV_SERVER) {
    setupAutoUpdater(window).catch((err) => {
      debugMain('setupAutoUpdater failed', err instanceof Error ? err.message : String(err));
    });
  }
  debugMain('createWindow:before-load');

  window.on('closed', () => {
    destroyMenuBar();
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  attachCloseToMinimize(window, process.platform, () => !isQuitting);
  attachWindowRepaintHandlers(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    const filePath = resolveLocalFileOpenPath(url);
    if (filePath) {
      void shell.openPath(filePath);
    } else if (isAllowedShellExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      debugMain('external-open:blocked', { url });
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
      if (isAllowedShellExternalUrl(url)) {
        void shell.openExternal(url);
      } else {
        debugMain('navigation-external-open:blocked', { url });
      }
    }
  });

  // CSP — Report-Only mode to observe violations before enforcing
  const isDev = !!devServer;
  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* https:${isDev ? ' ws://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy-Report-Only': [cspDirectives],
        },
      });
    } else {
      callback({});
    }
  });

  if (devServer) {
    await window.loadURL(devServer);
  } else {
    await window.loadFile(rendererFile);
  }
  debugMain('createWindow:loaded');
  return window;
}

function restoreOrCreateWindow(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (window) {
    restoreExistingWindow(window);
    return;
  }
  void createWindow();
}

const packagedKimiSmokeResultPath = process.env.XIAOK_KIMI_PACKAGED_SMOKE_RESULT;

if (packagedKimiSmokeResultPath) {
  app.whenReady().then(async () => {
    const { runPackagedKimiSmoke } = await import('./kimi-packaged-smoke.js');
    await runPackagedKimiSmoke(packagedKimiSmokeResultPath);
    app.exit(0);
  }).catch((error) => {
    console.error('[main] packaged Kimi smoke failed:', error);
    app.exit(1);
  });
} else if (!singleInstanceLock) {
  debugMain('single-instance-lock:failed');
  app.quit();
} else {
  app.whenReady().then(async () => {
    debugMain('app:whenReady');
    const protocolRegistered = registerIntentBrokerProtocolClient(app, {
      platform: process.platform,
      execPath: process.execPath,
    });
    debugMain('intent-broker-protocol:registration', {
      platform: process.platform,
      registered: protocolRegistered,
    });
    const launchProtocolUrl = findIntentBrokerProtocolUrl(process.argv);
    if (launchProtocolUrl) {
      debugMain('intent-broker-protocol:launch', { url: launchProtocolUrl });
    }
    if (process.platform === 'darwin') {
      app.setName('xiaok');
      const iconPath = resolveDesktopDockIconPath(__dirname, process.resourcesPath, process.platform);
      if (iconPath && app.dock) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }
    void createWindow();
  }).catch((error) => {
    console.error('[main] whenReady failed:', error);
  });
  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = findIntentBrokerProtocolUrl(commandLine);
    debugMain('app:second-instance', protocolUrl ? { protocolUrl } : undefined);
    restoreOrCreateWindow();
  });
  // `isQuitting` is now set by the coordinator's synchronous phase ① rather than
  // as a listener side effect.
  registerLifetimeDisposerStep('window-scoped', async () => {
    meetingRecorderController?.dispose();
    destroyMenuBar();
    debugMain('app:before-quit');
  });
  app.on('window-all-closed', () => {
    debugMain('app:window-all-closed', { platform: process.platform });
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('activate', () => {
    debugMain('app:activate');
    restoreOrCreateWindow();
  });
}
