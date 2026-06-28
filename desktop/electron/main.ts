import { app, BrowserWindow, ipcMain, session, shell, nativeImage, Menu, powerMonitor } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createDesktopServices, resumeOneScriptWorkflow } from './desktop-services.js';
import { registerDesktopIpc } from './ipc.js';
import {
  buildBrowserWindowOptions,
  isAllowedNavigationUrl,
  isAllowedShellExternalUrl,
  resolveLocalFileOpenPath,
} from './security.js';
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
import { TimedActionStore } from './timed-action-store.js';
import { ThreadMetaStore } from './thread-meta-store.js';
import { TimedActionService } from './timed-action-service.js';
import { TimedActionScheduler } from './timed-action-scheduler.js';
import { createDesktopTimedActionExecutors } from './timed-action-executors.js';
import { createElectronDesktopNotificationPort } from './desktop-notifications.js';
import { createDesktopLoopRuntime } from './loop-executor.js';
import { createDesktopLoopLLMPort } from './loop-llm-port-impl.js';
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
} from './mobile-relay.js';
import {
  buildMobileSnapshotFromSources,
  resolveMobileApprovalAnswer,
  type KSwarmProjectLike,
} from './mobile-snapshot.js';
import type { TaskSnapshot } from '../../src/runtime/task-host/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function debugMain(message: string, extra?: unknown): void {
  const suffix = extra === undefined ? '' : ` ${JSON.stringify(extra)}`;
  const line = `[main-debug] ${message}${suffix}`;
  try {
    const logDir = join(app.getPath('userData'), 'logs');
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, 'main-debug.log'), `${new Date().toISOString()} ${line}\n`);
  } catch {}
  console.log(line);
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

function buildArtifactPreview(input: {
  artifact: unknown;
  filePath?: string;
  previewAvailable?: boolean;
  mimeType?: string;
  kind: string;
}): MobileArtifactPreview | null {
  if (!input.previewAvailable) return null;
  const contentType = input.mimeType || contentTypeForArtifactKind(input.kind);
  const preview: MobileArtifactPreview = {
    artifact: input.artifact,
    contentType,
  };
  if (input.filePath && isTextPreviewKind(input.kind, contentType) && existsSync(input.filePath)) {
    preview.text = readFileSync(input.filePath, 'utf8').slice(0, 200_000);
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

async function fetchKSwarmProjectsForMobile(kswarmService: ReturnType<typeof createKSwarmService>): Promise<KSwarmProjectLike[]> {
  const status = kswarmService.getStatus();
  if (!status.running || !status.port) return [];
  const response = await fetch(`http://127.0.0.1:${status.port}/projects`);
  if (!response.ok) return [];
  const body = await response.json() as { projects?: KSwarmProjectLike[] };
  return Array.isArray(body.projects) ? body.projects : [];
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
  const window = new BrowserWindow(buildBrowserWindowOptions(preloadPath, {
    platform: process.platform,
    iconPath: resolveDesktopWindowIconPath(__dirname, process.platform),
  }));
  debugMain('createWindow:browserWindow-created');
  removeWindowsWindowMenu(window, process.platform);
  attachDesktopContextMenu(window, Menu);
  mainWindow = window;
  // KSwarm service — manages kswarm server as a child process
  const kswarmService = createKSwarmService();
  const kswarmStartPromise = kswarmService.start().catch((err) => {
    console.error('[main] Failed to start kswarm service:', err);
  });
  ipcMain.handle('desktop:kswarm:getStatus', () => kswarmService.getStatus());
  ipcMain.handle('desktop:kswarm:start', () => kswarmService.start());
  ipcMain.handle('desktop:kswarm:stop', () => kswarmService.stop());
  ipcMain.handle('desktop:kswarm:restart', () => kswarmService.restart());
  ipcMain.handle('desktop:kswarm:resumeWorkflowRun', (_event, input) =>
    resumeOneScriptWorkflow(kswarmService, input?.projectId, input?.workflowRunId));
  let restartRuntimeBridgeService: () => Promise<void> = async () => {};
  ipcMain.handle('desktop:services:getStatus', async () => {
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
  ipcMain.handle('desktop:services:restart', (_event, serviceId) => (
    serviceId === 'runtime-bridge'
      ? restartRuntimeBridgeService()
      : kswarmService.restartRelatedService(serviceId)
  ));
  kswarmService.onStatusChange((status) => {
    window.webContents.send('desktop:kswarm:statusChange', status);
  });

  const kswarmStreamBridge = new KSwarmStreamBridge('ws://127.0.0.1:4400/ws');
  kswarmStreamBridge.start();
  registerKSwarmProxy(ipcMain, kswarmStreamBridge, kswarmService);

  const { getConfigDir, loadConfig, saveConfig } = await import('../../src/utils/config.js');
  const dataRoot = getConfigDir('desktop');
  const services = createDesktopServices({
    dataRoot,
    kswarmService,
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
  const mobileGateway = createMobileGateway({
    host: process.env.XIAOK_MOBILE_GATEWAY_HOST ?? '0.0.0.0',
    port: Number(process.env.XIAOK_MOBILE_GATEWAY_PORT ?? '47891'),
    desktopName: 'Xiaok Desktop',
    desktopId: mobileIdentity.desktopId,
    mobileAccessToken: mobileIdentity.mobileAccessToken,
    getSnapshot: getMobileSnapshot,
    sendMessage: sendMobileMessage,
    respondToApproval: respondMobileApproval,
    getArtifactPreview: (artifactId) => findMobileArtifactPreview(dataRoot, artifactId),
    onRequest: (event) => {
      debugMain('mobile-gateway:request', event);
    },
  });
  const mobileRelayConfig = loadMobileRelayConfig();
  ipcMain.handle('desktop:mobile:getPairingInfo', () => buildMobilePairingPayload({
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
      getArtifactPreview: (artifactId) => findMobileArtifactPreview(dataRoot, artifactId),
      onStatus: (status) => {
        debugMain('mobile-relay:status', {
          running: status.running,
          connected: status.connected,
          relayUrl: status.relayUrl,
          roomId: status.roomId,
          lastError: status.lastError,
        });
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
  const loopRuntime = createDesktopLoopRuntime({
    dataRoot,
    taskPort: {
      createTask: (input) => services.createTask(input),
      recoverTask: (taskId) => services.recoverTask(taskId),
      cancelTask: (taskId, reason) => services.cancelTask(taskId, reason),
    },
    llmPort: createDesktopLoopLLMPort(),
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
      join(resolveKSwarmServiceLogRoot(app.getPath('userData')), 'server.log'),
      join(resolveKSwarmServiceLogRoot(app.getPath('userData')), 'broker.log'),
    ],
  });
  loopStoreRef = loopRuntime.loopStore;

  await registerDesktopIpc(ipcMain, window, services, { loopRuntime });
  debugMain('createWindow:ipc-registered');

  try {
    await services.recoverStaleTasks();
  } catch (err) {
    console.error('[main] recoverStaleTasks failed (startup continues):', err);
  }

  ipcMain.handle('desktop:getConnectorsConfig', () => services.getConnectorsConfig());
  ipcMain.handle('desktop:saveConnectorsConfig', (_event, input) => services.setConnectorsConfig(input));
  ipcMain.handle('desktop:listConnectorRuntimes', () => services.listConnectorRuntimes());
  ipcMain.handle('desktop:testConnectorProvider', (_event, kind) => services.testConnectorProvider(kind));

  // Register update IPC handlers
  ipcMain.handle('desktop:getUpdateStatus', () => {
    try {
      return { ...getUpdateStatus(), currentVersion: app.getVersion() };
    } catch (e) {
      return { checking: false, available: false, downloading: false, downloaded: false, progress: 0, error: (e as Error).message, currentVersion: app.getVersion() };
    }
  });
  ipcMain.handle('desktop:checkForUpdates', async () => {
    try {
      await checkForUpdates();
    } catch (e) {
      // Error already handled in checkForUpdates
    }
  });
  ipcMain.handle('desktop:quitAndInstall', () => {
    isQuitting = true;
    try {
      quitAndInstall();
    } catch (e) {
      isQuitting = false;
      throw e;
    }
  });

  let globalBackgroundAutoRunEnabled = (await loadConfig()).automations?.globalBackgroundAutoRunEnabled !== false;
  const automationsConfigSnapshot = () => ({ globalBackgroundAutoRunEnabled });
  ipcMain.handle('desktop:automations:getConfig', () => automationsConfigSnapshot());
  ipcMain.handle('desktop:automations:setGlobalBackgroundAutoRun', async (_event, input) => {
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
  services.registerTimedActionService(timedActionService);
  ipcMain.handle('desktop:automations:getOverviewSnapshot', () => buildAutomationOverviewSnapshot({
    loopStore: loopRuntime.loopStore,
    timedActionStore,
    globalBackgroundAutoRunEnabled,
  }));
  ipcMain.handle('desktop:automations:getRunHistory', () => buildAutomationRunHistory({
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

  // Register MCP plugin tools (connects to MCP servers declared in ~/.xiaok/plugins)
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
  services.registerMcpTools().then(({ dispose }) => {
    mcpDispose = dispose;
    startRuntimeBridge();
  }).catch(() => {
    startRuntimeBridge();
  });
  debugMain('createWindow:mcp-registration-started');

  const timedActionScheduler = new TimedActionScheduler(timedActionStore, {
    executors: createDesktopTimedActionExecutors({
      getMainWindow: () => window,
      loopRuntime,
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

  ipcMain.handle('desktop:syncScheduledTasks', (_event, tasks) => {
    // Deprecated compatibility endpoint. Renderer must not replace main state.
    return timedActionService.listScheduledTasks();
  });
  ipcMain.handle('desktop:getScheduledTasks', () => {
    return timedActionService.listScheduledTasks();
  });
  ipcMain.handle('desktop:createScheduledTask', (_event, input) => {
    return timedActionService.createScheduledTask(input);
  });
  ipcMain.handle('desktop:loops:createSchedule', (_event, input) => {
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
  ipcMain.handle('desktop:loops:getScheduleBindings', () => {
    return timedActionService.listLoopScheduleBindings();
  });
  ipcMain.handle('desktop:updateScheduledTask', (_event, input) => {
    return timedActionService.updateScheduledTask(input);
  });
  ipcMain.handle('desktop:setScheduledTaskStatus', (_event, id: string, status: 'active' | 'paused') => {
    return timedActionService.setScheduledTaskStatus(id, status) ?? null;
  });
  ipcMain.handle('desktop:cancelScheduledTask', (_event, id: string) => {
    return timedActionService.cancelScheduledTask(id);
  });
  ipcMain.handle('desktop:getTimedActions', () => {
    return timedActionService.getActions();
  });
  ipcMain.handle('desktop:getTimedActionRuns', (_event, actionId: string) => {
    return timedActionService.getRuns(actionId);
  });
  ipcMain.handle('desktop:scheduledTasks:clearRunHistory', (_event, actionId: string, statuses?: unknown) => {
    if (typeof actionId !== 'string' || actionId.trim().length === 0) {
      throw new Error('actionId must be a non-empty string');
    }
    const validStatuses = Array.isArray(statuses) && statuses.every((s) => typeof s === 'string')
      ? (statuses as string[])
      : undefined;
    const removed = timedActionStore.clearActionRunHistory(actionId, validStatuses);
    return { ok: true, removed };
  });
  ipcMain.handle('desktop:timedAction:approveAuto', (_event, actionId: string) => {
    return timedActionService.approveAuto(actionId) ?? null;
  });
  ipcMain.handle('desktop:timedAction:revokeAuto', (_event, actionId: string) => {
    return timedActionService.revokeAuto(actionId) ?? null;
  });

  // Thread meta (GTD / pinned) — persistent via SQLite in main process
  const threadMetaStore = new ThreadMetaStore(join(dataRoot, 'thread-meta.sqlite'));
  const broadcastThreadMeta = () => {
    if (window.isDestroyed()) return;
    window.webContents.send('desktop:threadMetaChanged', threadMetaStore.getAll());
  };
  ipcMain.handle('desktop:getThreadLabels', () => {
    return threadMetaStore.getAll();
  });
  ipcMain.handle('desktop:setThreadLabel', (_event, threadId: string, label: string) => {
    const result = threadMetaStore.addThreadToLabel(threadId, label as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:unsetThreadLabel', (_event, threadId: string, label: string) => {
    const result = threadMetaStore.removeThreadFromLabel(threadId, label as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:moveThreadLabel', (_event, threadId: string, from: string, to: string) => {
    const result = threadMetaStore.moveThread(threadId, from as any, to as any);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:getAppFlag', (_event, key: string) => {
    return threadMetaStore.getFlag(key as any);
  });
  ipcMain.handle('desktop:setAppFlag', (_event, key: string, value: string) => {
    const result = threadMetaStore.setFlag(key as any, value);
    if (result.ok) broadcastThreadMeta();
    return result;
  });
  ipcMain.handle('desktop:migrateLegacyThreadMeta', (_event, data: any) => {
    const result = threadMetaStore.bulkImport(data);
    if (result.ok) broadcastThreadMeta();
    return result;
  });

  app.on('before-quit', () => {
    kswarmService.stop().catch((err) => {
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
  ipcMain.handle('desktop:createReminder', (_event, input: { content: string; scheduleAt: number; timezone?: string }) => {
    return timedActionService.createReminder(input.content, input.scheduleAt, input.timezone);
  });
  ipcMain.handle('desktop:listReminders', () => timedActionService.listReminders());
  ipcMain.handle('desktop:cancelReminder', (_event, id: string) => timedActionService.cancelReminder(id));
  ipcMain.handle('desktop:getReminderStatus', () => timedActionService.getReminderStatus());

  // Skill debug config IPC handlers
  ipcMain.handle('desktop:getSkillDebugConfig', () => services.getSkillDebugConfig());
  ipcMain.handle('desktop:saveSkillDebugConfig', (_event, input: { enabled: boolean }) => services.saveSkillDebugConfig(input));

  // KSwarm config IPC handlers
  ipcMain.handle('desktop:getKswarmConfig', () => services.getKswarmConfig());
  ipcMain.handle('desktop:saveKswarmConfig', (_event, input: { maxConcurrentTasks: number }) => services.saveKswarmConfig(input));

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

  const devServer = process.env['XIAOK_DESKTOP_DEV_SERVER'];

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
    await window.loadFile(join(__dirname, '../../../renderer/index.html'));
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

if (!singleInstanceLock) {
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
  app.on('before-quit', () => {
    isQuitting = true;
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
