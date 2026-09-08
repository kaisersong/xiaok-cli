import { vi, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopMultiAgentIpc, type MultiAgentIpcEvent } from '../../electron/desktop-multi-agent-ipc.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import type { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import { DesktopCapabilityCatalog, type DesktopScopedRegistry } from '../../electron/desktop-multi-agent-capabilities.js';

export const deferred = <T = void,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
export type Authorization = {
  bootId: string; permissionRevision: number; executionAllowed: boolean; persistenceState: 'confirmed' | 'unknown';
  pendingOperation?: AuthorizationRequest;
};
export type AuthorizationRequest = {
  operationId: string; expectedPermissionRevision: number; executionAllowed: boolean; confirm: true;
};
export type AuthorizationReceipt = {
  operationId: string; state: 'applied' | 'unknown'; permissionRevision: number; executionAllowed: boolean;
  persistenceState: 'confirmed' | 'unknown'; outcome?: 'rejected'; error?: string;
};
export type SqliteWithAuthorizer = DatabaseSync & {
  setAuthorizer(callback: ((action: number, name: string | null, column: string | null) => number) | null): void;
};

// Only the network adapter and Electron shell are substituted. The factory,
// default TaskRunner, registry, service, coordinator, store and IPC are real.
export async function authorizationFixture(cleanup: Array<() => void | Promise<void>>, existingRoot?: string) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), 'xiaok-execution-auth-'));
  if (!existingRoot) cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
  const kswarmService = {
    start: async () => {}, stop: async () => {}, restart: async () => {},
    getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }),
  } as unknown as KSwarmService;
  const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'),
    kswarmService, workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [] });
  cleanup.push(() => services.disposeMultiAgent());
  const boundary = services.multiAgent!;
  await boundary.ready;
  await services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture-no-network' });
  const store = (boundary.service as unknown as { options: { store: DesktopMultiAgentStore } }).options.store;
  const db = (store as unknown as { db: SqliteWithAuthorizer }).db;
  const contexts: DesktopAgentExecutionContext[] = [];
  const scopes: Array<{ catalog: DesktopCapabilityCatalog; handle: DesktopScopedRegistry }> = [];
  const createScope = DesktopCapabilityCatalog.prototype.createScopedRegistry;
  vi.spyOn(DesktopCapabilityCatalog.prototype, 'createScopedRegistry').mockImplementation(function(this: DesktopCapabilityCatalog, ...args) {
    const handle = createScope.apply(this, args); scopes.push({ catalog: this, handle }); return handle;
  });
  const activity = boundary.service.recordActivity.bind(boundary.service);
  vi.spyOn(boundary.service, 'recordActivity').mockImplementation((context, fact) => {
    if (!contexts.includes(context)) contexts.push(context);
    return activity(context, fact);
  });
  const started = boundary.service.recordRunStarted.bind(boundary.service);
  vi.spyOn(boundary.service, 'recordRunStarted').mockImplementation((context, message) => {
    if (!contexts.includes(context)) contexts.push(context);
    return started(context, message);
  });
  let generation = 0;
  const sent: Array<{ senderId: number; channel: string; data: unknown }> = [];
  const createSender = () => {
    const id = ++generation, mainFrame = { url: 'file:///fixture/renderer/index.html' };
    let destroyed = false;
    const sender = Object.assign(new EventEmitter(), { id, mainFrame, isDestroyed: () => destroyed,
      send: (channel: string, data: unknown) => { sent.push({ senderId: id, channel, data }); },
      destroy: () => { destroyed = true; sender.emit('destroyed'); },
    });
    return { sender, senderFrame: mainFrame };
  };
  let current = createSender();
  let principal = `desktop-user:${boundary.profileId}`;
  const handlers = new Map<string, (event: MultiAgentIpcEvent, input: unknown) => unknown>();
  cleanup.push(registerDesktopMultiAgentIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, boundary, {
    authorize: candidate => candidate.sender === current.sender && candidate.senderFrame === current.senderFrame ? { actorId: principal } : null,
  }));
  const invoke = async <T = unknown,>(name: string, input: unknown, caller: MultiAgentIpcEvent = current): Promise<T> => {
    const handler = handlers.get(`desktop:${name}`);
    expect(handler, `missing production semantic IPC desktop:${name}; fixture does not implement it`).toBeTypeOf('function');
    return await handler!(caller, input) as T;
  };
  const reload = () => {
    const old = current;
    old.sender.emit('did-start-navigation', {}, 'file:///fixture/reload.html', false, true);
    old.sender.destroy(); current = createSender(); return old;
  };
  return { root, services, boundary, store, db, contexts, scopes, sent, invoke, reload,
    caller: () => current, changePrincipal: (value: string) => { principal = value; },
    getAuthorization: () => invoke<Authorization>('getLocalExecutionAuthorization', {}),
    setAuthorization: (request: AuthorizationRequest) => invoke<AuthorizationReceipt>('setLocalExecutionAuthorization', request),
  };
}

export function authorizationRequest(snapshot: Authorization, executionAllowed: boolean, nonce: string): AuthorizationRequest {
  return { operationId: `exec-auth:${snapshot.bootId}:${snapshot.permissionRevision}:${nonce}`,
    expectedPermissionRevision: snapshot.permissionRevision, executionAllowed, confirm: true };
}

// Faults at the native transaction boundary, not a substitute authorization
// implementation. SQLite still executes all candidate SQL and COMMIT/ROLLBACK.
export function failNextAuthorizationCommit(db: SqliteWithAuthorizer, position: 'before' | 'after') {
  return failNextCommit(db, position, 'workspace_execution_authorizations');
}
export function failNextApprovalCommit(db: SqliteWithAuthorizer, position: 'before' | 'after') {
  return failNextCommit(db, position, 'operations');
}
function failNextCommit(db: SqliteWithAuthorizer, position: 'before' | 'after', table: string) {
  let touched = false, faults = 0, armed = true, writePreparations = 0;
  const original = db.exec.bind(db);
  db.setAuthorizer((action, name) => {
    if ((action === 18 || action === 23) && name === table) { touched = true; writePreparations++; }
    return 0;
  });
  const spy = vi.spyOn(db, 'exec').mockImplementation(sql => {
    if (/^\s*BEGIN\b/i.test(sql)) touched = false;
    if (/^\s*COMMIT\b/i.test(sql) && touched && armed) {
      armed = false; faults++;
      if (position === 'after') original(sql);
      throw Object.assign(new Error(`injected authorization ${position}-commit SQLite fault`), { code: 'ERR_SQLITE_ERROR' });
    }
    return original(sql);
  });
  return { faults: () => faults, writePreparations: () => writePreparations,
    restore: () => { db.setAuthorizer(null); spy.mockRestore(); } };
}
