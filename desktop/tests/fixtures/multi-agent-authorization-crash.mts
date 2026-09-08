// Separate real main owner. Exits without dispose, so boot recovery is not
// simulated by editing boot_owners or pretending the current PID died.
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopMultiAgentIpc, type MultiAgentIpcEvent } from '../../electron/desktop-multi-agent-ipc.js';
import type { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

const [root, mode] = process.argv.slice(2);
if (!root || !['committed-deny', 'uncommitted-deny', 'retired-receipt'].includes(mode)) throw new Error('invalid crash fixture arguments');
process.env.XIAOK_CONFIG_DIR = join(root, 'config');
const kswarmService = {
  start: async () => {}, stop: async () => {}, restart: async () => {},
  getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
  onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }),
} as unknown as KSwarmService;
const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'),
  kswarmService, workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [] });
const boundary = services.multiAgent!; await boundary.ready;
const mainFrame = {}, sender = Object.assign(new EventEmitter(), { id: 1, mainFrame, isDestroyed: () => false, send: () => {} });
const handlers = new Map<string, (event: MultiAgentIpcEvent, input: unknown) => unknown>();
registerDesktopMultiAgentIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, boundary, {
  authorize: event => event.sender === sender && event.senderFrame === mainFrame ? { actorId: `desktop-user:${boundary.profileId}` } : null,
});
type State = { bootId: string; permissionRevision: number; executionAllowed: boolean; persistenceState: string };
const invoke = async <T,>(key: string, input: unknown): Promise<T> => {
  const handler = handlers.get(`desktop:${key}`);
  if (!handler) throw new Error(`missing production semantic IPC desktop:${key}`);
  return await handler({ sender, senderFrame: mainFrame }, input) as T;
};
const prior = await invoke<State>('getLocalExecutionAuthorization', {});
const request = { operationId: `exec-auth:${prior.bootId}:${prior.permissionRevision}:crash-original`,
  expectedPermissionRevision: prior.permissionRevision, executionAllowed: false, confirm: true };
let faults = 0;
if (mode === 'uncommitted-deny') {
  const store = (boundary.service as unknown as { options: { store: DesktopMultiAgentStore } }).options.store;
  const db = (store as unknown as { db: DatabaseSync & { setAuthorizer(callback: (action: number, table: string | null) => number): void } }).db;
  let touched = false; const exec = db.exec.bind(db);
  db.setAuthorizer((action, table) => { if ((action === 18 || action === 23) && table === 'workspace_execution_authorizations') touched = true; return 0; });
  db.exec = sql => {
    if (/^\s*BEGIN\b/i.test(sql)) touched = false;
    if (!faults && /^\s*COMMIT\b/i.test(sql) && touched) { faults++; throw Object.assign(new Error('uncommitted crash fixture'), { code: 'ERR_SQLITE_ERROR' }); }
    return exec(sql);
  };
}
const receipt = await invoke('setLocalExecutionAuthorization', request);
if (mode === 'retired-receipt') {
  const denied = await invoke<State>('getLocalExecutionAuthorization', {});
  await invoke('setLocalExecutionAuthorization', { operationId: `exec-auth:${denied.bootId}:${denied.permissionRevision}:retiring-grant`,
    expectedPermissionRevision: denied.permissionRevision, executionAllowed: true, confirm: true });
}
const beforeExit = await invoke<State>('getLocalExecutionAuthorization', {});
// Write synchronously so exit never races the evidence pipe flush.
const { writeSync } = await import('node:fs');
writeSync(1, `FIXTURE_RESULT ${JSON.stringify({ prior, request, receipt, beforeExit, faults })}\n`);
process.exit(0);
