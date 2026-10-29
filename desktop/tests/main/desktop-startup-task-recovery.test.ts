// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import { DesktopApplicationWindowOwner } from '../../electron/desktop-application-window-owner.js';
import { startDesktopTaskRecovery } from '../../electron/desktop-startup-task-recovery.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { registerDesktopMultiAgentIpc } from '../../electron/desktop-multi-agent-ipc.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { withDesktopBootstrapWriter } from '../../electron/desktop-bootstrap-writer.js';

it.each([false, true])('keeps actual authenticated agent IPC behind real initialization (failure=%s)', async fail => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-startup-gate-'));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
  const createSession = vi.fn(), runner = vi.fn();
  const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession });
  const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner });
  service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
  // Hold one real recovery IO boundary, then continue through the original host.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const inspect = host.inspectActiveTasks.bind(host);
  host.inspectActiveTasks = async () => { await held; if (fail) throw Error('fixture_recovery_failure'); return inspect(); };
  const ready = service.initialize(host);
  const gate = new DesktopShutdownGate();
  const recovery = startDesktopTaskRecovery(gate, () => ready)!;
  void recovery.catch(() => {});
  const mainFrame = {}, sender = Object.assign(new EventEmitter(), { id: 1, mainFrame, isDestroyed: () => false, send: vi.fn() });
  const handlers = new Map<string, (event: any, input: unknown) => unknown>();
  const disposeIpc = registerDesktopMultiAgentIpc({ handle: (name, handler) => { handlers.set(name, handler); } },
    { service, ready, profileId: 'profile', workspaceId: 'workspace', cwd: root }, { authorize: () => ({ actorId: 'fixture-user' }) });
  const register = vi.spyOn(service, 'registerThreadWithOwnership');
  const followup = vi.spyOn(service, 'userFollowup');
  const request = Promise.resolve().then(() => handlers.get('desktop:listMultiAgentGroups')!({ sender, senderFrame: mainFrame }, { threadId: 'thread' }));
  const execution = Promise.resolve().then(() => handlers.get('desktop:followupAgent')!({ sender, senderFrame: mainFrame },
    { threadId: 'thread', groupId: 'fixture-group', agentId: 'fixture-agent', operationId: 'fixture-operation', expectedTurn: 0, message: 'Fixture' }));
  void request.catch(() => {});
  void execution.catch(() => {});
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(register).not.toHaveBeenCalled();
    expect(followup).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled(); expect(runner).not.toHaveBeenCalled();
    gate.close(); expect(await gate.drain(1)).toBe(false);
    release();
    if (fail) {
      await expect(request).rejects.toThrow('fixture_recovery_failure');
      await expect(recovery).rejects.toThrow('fixture_recovery_failure');
      await expect(execution).rejects.toThrow('fixture_recovery_failure');
      expect(register).not.toHaveBeenCalled();
      expect(followup).not.toHaveBeenCalled();
    } else {
      expect(await request).toEqual({ items: [], nextCursor: null }); await recovery;
      await expect(execution).rejects.toThrow(); // Missing fixture group is checked only after initialization.
      expect(register).toHaveBeenCalledTimes(2);
      expect(followup).toHaveBeenCalledTimes(1);
    }
    expect(await gate.drain(0)).toBe(true);
  } finally {
    release(); await Promise.allSettled([ready, recovery, request, execution]); disposeIpc();
    await host.drain(); await service.dispose(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

it('opens the real window owner while recovery remains owned through shutdown', async () => {
  const gate = new DesktopShutdownGate();
  let release!: () => void;
  const original = new Promise<void>(resolve => { release = resolve; });
  const recover = vi.fn(() => original);
  let recovery: Promise<void> | undefined;
  const window = {};
  const owner = new DesktopApplicationWindowOwner({
    current: () => window,
    bootstrap: async () => { recovery = startDesktopTaskRecovery(gate, recover); return window; },
    createView: vi.fn(async () => window),
  });
  expect(await owner.open()).toBe(window);
  expect(await owner.open()).toBe(window);
  expect(recover).toHaveBeenCalledTimes(1);
  gate.close();
  expect(await gate.drain(1)).toBe(false);
  release(); await recovery;
  expect(await gate.drain(0)).toBe(true);
});

it('preserves the original recovery failure and retires its writer', async () => {
  const gate = new DesktopShutdownGate(), error = Error('fixture_recovery_failure');
  await expect(startDesktopTaskRecovery(gate, async () => { throw error; })).rejects.toBe(error);
  expect(gate.outstanding).toBe(0);
});

it('refuses a recovery producer after shutdown has sealed admission', () => {
  const gate = new DesktopShutdownGate(), recover = vi.fn(async () => {});
  gate.close();
  expect(startDesktopTaskRecovery(gate, recover)).toBeUndefined();
  expect(recover).not.toHaveBeenCalled();
});

it('wires the initial production window after renderer load, with no early recovery await', () => {
  const source = readFileSync(join(__dirname, '../../electron/main.ts'), 'utf8');
  expect(source.indexOf('const taskRecovery = startDesktopTaskRecovery(desktopShutdownGate')).toBeGreaterThan(source.indexOf("debugMain('createWindow:loaded')"));
  const construction = source.indexOf('const services = createDesktopServices(');
  const initialization = source.indexOf('const taskInitialization = startDesktopTaskRecovery(');
  expect(initialization).toBeGreaterThan(construction);
  expect(initialization).toBeLessThan(source.indexOf('await services.reconcileArtifactWorkspace()'));
  expect(source.slice(source.indexOf('const computerUseAppIdentity ='), construction)).toContain('if (!desktopShutdownGate.isOpen) return window;');
  expect(source.match(/await services\.recoverStaleTasks\(\)/g)).toHaveLength(1);
  const replacement = source.slice(source.indexOf('async function createReplacementWindow'), source.indexOf('function createInitialWindow()'));
  expect(replacement).not.toContain('startDesktopTaskRecovery');
});

it.each([[false, false], [false, true], [true, false], [true, true]])(
  'owns real MA initialization after shutdown during renderer load (loadFailure=%s initFailure=%s)', async (loadFailure, initFailure) => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-startup-load-'));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner: vi.fn() });
    let releaseInitialization!: () => void, finishLoad!: () => void;
    const initializationHeld = new Promise<void>(resolve => { releaseInitialization = resolve; });
    const loadError = Error('fixture_load_failure'), initializationError = Error('fixture_initialization_failure');
    const loading = new Promise<void>((resolve, reject) => { finishLoad = () => loadFailure ? reject(loadError) : resolve(); });
    const inspect = host.inspectActiveTasks.bind(host);
    host.inspectActiveTasks = async () => { await initializationHeld; if (initFailure) throw initializationError; return inspect(); };
    const gate = new DesktopShutdownGate(), generic = vi.fn(async () => {}), window = {};
    let ready!: Promise<void>, initialization!: Promise<void>;
    const owner = new DesktopApplicationWindowOwner({ current: () => window, createView: async () => window,
      bootstrap: () => withDesktopBootstrapWriter(gate, async () => {
        ready = service.initialize(host);
        initialization = startDesktopTaskRecovery(gate, () => ready, 'startup-multi-agent-initialization')!;
        void initialization.catch(() => {});
        await loading;
        startDesktopTaskRecovery(gate, generic);
        return window;
      }) });
    const opening = owner.open(); void opening.catch(() => {});
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      gate.close(); finishLoad();
      if (loadFailure) await expect(opening).rejects.toBe(loadError); else expect(await opening).toBe(window);
      expect(generic).not.toHaveBeenCalled();
      expect(await gate.drain(1)).toBe(false);
      releaseInitialization();
      if (initFailure) await expect(initialization).rejects.toBe(initializationError); else await initialization;
      expect(await gate.drain(0)).toBe(true);
    } finally {
      releaseInitialization(); finishLoad(); await Promise.allSettled([opening, ready, initialization]);
      await host.drain(); await service.dispose(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  },
);
