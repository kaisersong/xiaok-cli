import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { CodexNativeService, type NativeServiceOptions } from '../../electron/codex-native-service.js';
import type { NativeOptions, SessionProbe, NativeEvent } from '../../electron/codex-native-transport.js';

export const actor = { requestSource: 'user' as const, actorId: 'cutover-user' };
export class ControlledCodexClient {
  threadId = 'controlled-thread';
  activeTurnId: string | null = null;
  pid = 0; // A transport double, never a Native process/Source proof.
  calls: string[] = [];
  closeGate?: Promise<void>;
  connectGate?: Promise<void>;
  closeTail?:Promise<void>;
  beforeStart?:()=>void;
  afterStart?:()=>void;
  startFailure?: { raw: unknown };
  interruptFailure?: { raw: unknown };
  private sequence = 0;
  constructor(readonly options: NativeOptions) {}
  async connect() { this.calls.push('connect'); await this.connectGate; }
  async create() { this.calls.push('create'); return { thread: { id: this.threadId } }; }
  async resume(id: string) { this.calls.push('resume'); this.threadId = id; }
  async start(_text: string) {
    this.calls.push('start');this.beforeStart?.();
    if (this.startFailure) throw this.startFailure.raw;
    this.activeTurnId = 'controlled-turn-' + ++this.sequence;
    this.emit('turn/started', { turn: { id: this.activeTurnId, status: 'inProgress' } });
    this.afterStart?.();return { turnId: this.activeTurnId };
  }
  async steer(_text: string) { this.calls.push('steer'); return { turnId: this.activeTurnId }; }
  async interrupt() {
    this.calls.push('interrupt');
    if (this.interruptFailure) throw this.interruptFailure.raw;
    this.emit('turn/completed', { turn: { id: this.activeTurnId, status: 'interrupted' } });
    this.activeTurnId = null;
  }
  close() { this.calls.push('close-enter');const raw=(async()=>{await this.closeGate;this.calls.push('close-return');})();if(this.closeTail)Object.defineProperty(raw,Symbol('close-tail'),{value:this.closeTail});return raw; }
  emit(method: string, params: Record<string, unknown>) {
    this.options.onEvent?.({ method, params: { threadId: this.threadId, turnId: this.activeTurnId, ...params } } as NativeEvent);
  }
  approval() {
    this.emit('item/started', { item: { id: 'command', type: 'fileChange', changes: [{ path: 'file', diff: '+line' }] } });
    return this.options.onApproval?.({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: this.threadId, turnId: this.activeTurnId, itemId: 'command', command: 'echo bounded' } });
  }
  fail(error:Error) { this.options.onFailure?.(error); }
}
export function clientFactory(clients: ControlledCodexClient[], before?: (client: ControlledCodexClient) => void): NonNullable<NativeServiceOptions['createClient']> {
  return options => {
    const client = new ControlledCodexClient(options);
    clients.push(client); before?.(client);
    return client as unknown as SessionProbe;
  };
}
export function newNativeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex-writer-cutover-'));
  const clients: ControlledCodexClient[] = [], file = join(root, 'native.sqlite');
  const service = new CodexNativeService({ dbPath: file, profileId: actor.actorId, createClient: clientFactory(clients), approvalTimeoutMs: 40 });
  return { root, file, clients, service };
}
export function rows(file: string, table: 'codex_native_sessions' | 'settings' | 'routes' | 'threads'): unknown[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT * FROM ' + table + ' ORDER BY 1').all(); }
  finally { db.close(); }
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
export async function cleanNative(f: ReturnType<typeof newNativeFixture>) {
  await f.service.dispose();
  rmSync(f.root, { recursive: true, force: true });
}
