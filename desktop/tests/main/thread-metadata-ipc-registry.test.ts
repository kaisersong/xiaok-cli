// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ThreadMetaStore } from '../../electron/thread-meta-store.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';

const names = ['getThreadLabels', 'setThreadLabel', 'unsetThreadLabel', 'moveThreadLabel', 'getAppFlag', 'setAppFlag', 'migrateLegacyThreadMeta'];
const cleanups: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) close(); });
/** Execute unchanged actual Main registration statements, never a test implementation of their business logic. */
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-thread-meta-ipc-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new ThreadMetaStore(join(root, 'thread-meta.sqlite'));
  cleanups.push(() => store.close());
  const handlers = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate();
  const ipc = new ShutdownAwareIpcMain({ handle(channel, listener) { expect(handlers.has(channel)).toBe(false); handlers.set(channel, listener); } }, gate);
  const events: Array<{ channel: string; data: unknown }> = [];
  const source = readFileSync(resolve(process.cwd(), 'electron/main.ts'), 'utf8');
  const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements: ts.Statement[] = [];
  let raw = 0, delegated = 0, broadcasts = 0;
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'broadcastThreadMeta')) {
      statements.push(node); broadcasts++;
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression, target = call.expression, channel = call.arguments[0];
      if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && target.expression.text === 'shutdownAwareIpc'
          && target.name.text === 'handle' && channel && ts.isStringLiteral(channel)
          && names.some(name => channel.text === 'desktop:' + name)) {
        statements.push(node); raw++;
      }
      if (ts.isIdentifier(target) && target.text === 'registerThreadMetadataIpc') { statements.push(node); delegated++; }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  expect(broadcasts).toBe(1);
  expect(raw === 7 && delegated === 0 || raw === 0 && delegated === 1).toBe(true);
  let registerThreadMetadataIpc: unknown;
  if (delegated) {
    const entry = resolve(process.cwd(), 'electron/thread-metadata-typed-ipc.ts');
    expect(existsSync(entry)).toBe(true);
    registerThreadMetadataIpc = (await import(/* @vite-ignore */ entry)).registerThreadMetadataIpc;
  }
  const snippet = statements.sort((a, b) => a.pos - b.pos).map(node => node.getText(parsed)).join('\n');
  const code = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { shutdownAwareIpc: ipc, threadMetaStore: store, registerThreadMetadataIpc,
    mainWindow: { isDestroyed: () => false, webContents: { send(channel: string, data: unknown) { events.push({ channel, data }); } } } });
  expect([...handlers.keys()].sort()).toEqual(names.map(name => 'desktop:' + name).sort());
  return { root, store, handlers, gate, events, invoke: (name: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get('desktop:' + name)!({} as never, ...args)) };
}

it('characterizes all seven actual Main handlers with real SQLite, broadcasts and one-shot migration', async () => {
  const f = await fixture();
  expect(await f.invoke('getThreadLabels')).toEqual({ inbox: [], todo: [], waiting: [], someday: [], archived: [], pinned: [], gtdEnabled: false });
  expect(await f.invoke('setThreadLabel', '线程😀', 'pinned')).toEqual({ ok: true });
  expect((await f.invoke('getThreadLabels') as { pinned: string[] }).pinned).toEqual(['线程😀']);
  expect(await f.invoke('unsetThreadLabel', '线程😀', 'pinned')).toEqual({ ok: true });
  expect(await f.invoke('setThreadLabel', '线程😀', 'inbox')).toEqual({ ok: true });
  expect(await f.invoke('moveThreadLabel', '线程😀', 'inbox', 'waiting')).toEqual({ ok: true });
  expect(f.store.getAll()).toMatchObject({ inbox: [], waiting: ['线程😀'] });
  expect(await f.invoke('getAppFlag', 'gtd-enabled')).toBeNull();
  expect(await f.invoke('setAppFlag', 'gtd-enabled', 'true')).toEqual({ ok: true });
  expect(await f.invoke('getAppFlag', 'gtd-enabled')).toBe('true');
  expect(await f.invoke('setAppFlag', 'unknown-old-key', 'value')).toEqual({ ok: false });
  expect(await f.invoke('getAppFlag', 'unknown-old-key')).toBeNull();
  expect(await f.invoke('migrateLegacyThreadMeta', { gtdEnabled: false, pinned: ['迁移', '迁移'], inbox: [''] })).toEqual({ ok: true, migrated: true });
  expect(f.store.getAll()).toMatchObject({ pinned: ['迁移'], inbox: [''], waiting: [], gtdEnabled: false });
  expect(await f.invoke('migrateLegacyThreadMeta', {})).toEqual({ ok: true, migrated: false, reason: 'already_done' });
  expect(f.events).toHaveLength(7);
  expect(f.events.every(event => event.channel === 'desktop:threadMetaChanged')).toBe(true);
  expect(f.gate.outstanding).toBe(0);
});

it('rejects a migration getter before touching actual SQLite or invoking the getter', async () => {
  const f = await fixture(); f.store.addThreadToLabel('preserve', 'pinned');
  let reads = 0; const data = Object.defineProperty({}, 'inbox', { enumerable: true, get() { reads++; return ['injected']; } });
  let failure: unknown; try { await f.invoke('migrateLegacyThreadMeta', data); } catch (error) { failure = error; }
  expect(reads).toBe(0);
  expect((failure as Error)?.message).toBe('thread_meta_input_invalid');
  expect(f.store.getFlag('gtd_migration_v1')).toBeNull();
  expect(f.store.getAll().pinned).toEqual(['preserve']);
  expect(f.events).toHaveLength(0);
});

it('retains a real committed label but rejects output accessors without executing them or reporting success', async () => {
  const f = await fixture(), original = f.store.addThreadToLabel.bind(f.store);
  let reads = 0;
  vi.spyOn(f.store, 'addThreadToLabel').mockImplementation((thread, label) => {
    original(thread, label);
    return Object.defineProperty({}, 'ok', { enumerable: true, get() { reads++; return true; } }) as { ok: boolean };
  });
  let failure: unknown; try { await f.invoke('setThreadLabel', 'committed', 'pinned'); } catch (error) { failure = error; }
  expect(reads).toBe(0);
  expect((failure as Error)?.message).toBe('thread_meta_operation_unknown');
  expect(f.store.getAll().pinned).toEqual(['committed']);
  expect(f.store.addThreadToLabel).toHaveBeenCalledTimes(1);
  expect(f.events).toHaveLength(0);
});

it('captures the actual synchronous result before an alias can mutate it after the handler yields', async () => {
  const f = await fixture(), original = f.store.addThreadToLabel.bind(f.store);
  vi.spyOn(f.store, 'addThreadToLabel').mockImplementation((thread, label) => {
    const result = original(thread, label); queueMicrotask(() => { result.ok = false; }); return result;
  });
  expect(await f.invoke('setThreadLabel', 'snapshot', 'pinned')).toEqual({ ok: true });
  expect(f.store.getAll().pinned).toEqual(['snapshot']);
  expect(f.events).toHaveLength(1);
});

async function production() { return import(/* @vite-ignore */ resolve(process.cwd(), 'electron/thread-metadata-typed-ipc.ts')); }

it('denies agent and scheduler in all five mutation service methods before inspecting any DTO', async () => {
  const f = await fixture(), { createThreadMetadataController } = await production();
  const broadcast = vi.fn(), controller = createThreadMetadataController(f.store, broadcast);
  expect(Object.keys(controller).sort()).toEqual([...names].sort());
  let traps = 0; const hostile = new Proxy({}, { get() { traps++; throw Error('must not inspect'); }, ownKeys() { traps++; throw Error('must not enumerate'); } });
  for (const source of ['agent', 'scheduler'] as const) {
    for (const mutate of [
      () => controller.setThreadLabel(hostile, 'pinned', source),
      () => controller.unsetThreadLabel(hostile, 'pinned', source),
      () => controller.moveThreadLabel(hostile, 'inbox', 'todo', source),
      () => controller.setAppFlag('gtd-enabled', hostile, source),
      () => controller.migrateLegacyThreadMeta(hostile, source),
    ]) expect(mutate).toThrow('thread_meta_request_source_forbidden');
  }
  expect(traps).toBe(0); expect(broadcast).not.toHaveBeenCalled();
  expect(f.store.getAll().pinned).toEqual([]); expect(f.store.getFlag('gtd_migration_v1')).toBeNull();
});

it('rejects invalid closed tuples, labels, extra migration authority fields and proxies without effects', async () => {
  const f = await fixture(); let traps = 0;
  const proxy = new Proxy({}, { get() { traps++; throw Error('get trap'); }, ownKeys() { traps++; throw Error('keys trap'); } });
  for (const [method, args] of [
    ['getThreadLabels', ['extra']], ['setThreadLabel', ['thread', 'unknown']],
    ['unsetThreadLabel', ['thread', 'pinned', 'extra']], ['moveThreadLabel', ['thread', 'pinned', 'todo']],
    ['getAppFlag', [proxy]], ['setAppFlag', ['gtd-enabled', true]],
    ['migrateLegacyThreadMeta', [{ pinned: ['thread'], requestSource: 'user' }]],
    ['migrateLegacyThreadMeta', [proxy]], ['migrateLegacyThreadMeta', [{ pinned: [42] }]],
  ] as Array<[string, unknown[]]>) await expect(f.invoke(method, ...args)).rejects.toThrow('thread_meta_input_invalid');
  expect(traps).toBe(0); expect(f.events).toHaveLength(0);
  expect(f.store.getAll().pinned).toEqual([]); expect(f.store.getFlag('gtd_migration_v1')).toBeNull();
});

it('keeps original degraded and real SQL rollback migration receipts without success broadcast', async () => {
  const f = await fixture(); f.store.addThreadToLabel('preserve', 'pinned');
  const db = (f.store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
  db.exec("CREATE TEMP TRIGGER migration_fault BEFORE INSERT ON app_flags WHEN NEW.key='gtd_migration_v1' BEGIN SELECT RAISE(ABORT,'SQLITE_FULL'); END");
  let result: unknown; try { result = await f.invoke('migrateLegacyThreadMeta', { inbox: ['new'] }); }
  finally { db.exec('DROP TRIGGER temp.migration_fault'); }
  expect(result).toMatchObject({ ok: false, migrated: false, reason: expect.stringContaining('SQLITE_FULL') });
  expect(f.store.getAll().pinned).toEqual(['preserve']); expect(f.store.getFlag('gtd_migration_v1')).toBeNull();
  expect(f.events).toHaveLength(0);
  const { registerThreadMetadataIpc } = await production();
  const degradedPath = join(f.root, 'invalid.sqlite');
  const { writeFileSync } = await import('node:fs'); writeFileSync(degradedPath, 'not a SQLite database');
  const degradedStore = new ThreadMetaStore(degradedPath); cleanups.push(() => degradedStore.close());
  expect(degradedStore.isDegraded()).toBe(true);
  const handlers = new Map<string, IpcHandlerListener>(), broadcast = vi.fn();
  registerThreadMetadataIpc({ handle(channel: string, listener: IpcHandlerListener) { handlers.set(channel, listener); } }, degradedStore, broadcast);
  const invoke = (method: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get('desktop:' + method)!({} as never, ...args));
  expect(await invoke('getAppFlag', 'gtd-enabled')).toBeNull();
  expect(await invoke('setAppFlag', 'unknown-key', 'x')).toEqual({ ok: false });
  expect(await invoke('setThreadLabel', 'thread', 'pinned')).toEqual({ ok: false, degraded: true });
  expect(await invoke('migrateLegacyThreadMeta', {})).toEqual({ ok: false, degraded: true, migrated: false, reason: 'degraded' });
  expect(await invoke('getThreadLabels')).toEqual({ inbox: [], todo: [], waiting: [], someday: [], archived: [], pinned: [], gtdEnabled: false });
  expect(broadcast).not.toHaveBeenCalled();
});

it('distinguishes unavailable reads from unknown committed writes when the broadcast projection is malformed', async () => {
  const f = await fixture(); const original = f.store.getAll.bind(f.store);
  vi.spyOn(f.store, 'getAll').mockReturnValue({ pinned: [] });
  await expect(f.invoke('getThreadLabels')).rejects.toThrow('thread_meta_projection_unavailable');
  await expect(f.invoke('setThreadLabel', 'committed', 'pinned')).rejects.toThrow('thread_meta_operation_unknown');
  expect(original().pinned).toEqual(['committed']); expect(f.events).toHaveLength(0);
});

it('fixes the first registrar owner, resumes only unsuccessful registrations, and checks absent owners before payloads', async () => {
  const f = await fixture(), { registerThreadMetadataIpc } = await production();
  const attempts = new Map<string, number>(), installed = new Map<string, IpcHandlerListener>();
  let fail = true;
  const registrar = { handle(channel: string, listener: IpcHandlerListener) {
    attempts.set(channel, (attempts.get(channel) ?? 0) + 1);
    if (channel === 'desktop:unsetThreadLabel' && fail) { fail = false; throw Error('original registration failure'); }
    installed.set(channel, listener);
  } };
  const broadcast = vi.fn();
  expect(() => registerThreadMetadataIpc(registrar, f.store, broadcast)).toThrow('original registration failure');
  registerThreadMetadataIpc(registrar, f.store, broadcast); registerThreadMetadataIpc(registrar, f.store, broadcast);
  expect(installed.size).toBe(7);
  expect(attempts.get('desktop:getThreadLabels')).toBe(1); expect(attempts.get('desktop:unsetThreadLabel')).toBe(2);
  expect(() => registerThreadMetadataIpc(registrar, f.store, vi.fn())).toThrow('thread_meta_ipc_registrar_owner_conflict');
  const emptyHandlers = new Map<string, IpcHandlerListener>(), empty = { handle(channel: string, listener: IpcHandlerListener) { emptyHandlers.set(channel, listener); } };
  registerThreadMetadataIpc(empty); registerThreadMetadataIpc(empty);
  let reads = 0; const data = Object.defineProperty({}, 'inbox', { enumerable: true, get() { reads++; throw Error('getter'); } });
  await expect(Promise.resolve().then(() => emptyHandlers.get('desktop:migrateLegacyThreadMeta')!({} as never, data))).rejects.toThrow('thread_meta_runtime_unavailable');
  expect(reads).toBe(0);
});

it('preserves original thrown objects and handles real native Promises without reading a hostile then accessor', async () => {
  const f = await fixture(), marker = { original: 'business failure' };
  const spy = vi.spyOn(f.store, 'getFlag').mockImplementation(() => { throw marker; });
  await expect(f.invoke('getAppFlag', 'gtd-enabled')).rejects.toBe(marker);
  spy.mockRestore();
  f.store.setFlag('gtd-enabled', 'original');
  let reads = 0; const promise = Promise.resolve(f.store.getFlag('gtd-enabled'));
  Object.defineProperty(promise, 'then', { get() { reads++; throw Error('then getter'); } });
  // Tinyspy itself reads then to classify return values, before the production
  // boundary. Return the genuine Promise directly to test that boundary.
  Object.defineProperty(f.store, 'getFlag', { configurable: true, value: () => promise });
  expect(await f.invoke('getAppFlag', 'gtd-enabled')).toBe('original'); expect(reads).toBe(0);
});
