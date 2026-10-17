// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const processMocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('node:child_process', async load => ({ ...await load<typeof import('node:child_process')>(), spawnSync: processMocks.sync }));
vi.mock('cross-spawn', () => ({ default: { sync: processMocks.sync } }));
import { getSkillCatalogVersion, onSkillCatalogChanged } from '../../electron/skill-catalog-invalidation.js';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { registerDesktopIpc } from '../../electron/ipc.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
import { isTrustedDesktopRendererUrl } from '../../electron/security.js';
import { IPC_SCHEMA_REGISTRY, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
const roots: string[] = [], cleanups: Array<() => Promise<void>> = [];
let previousConfig: string | undefined;
beforeEach(() => { previousConfig = process.env['XIAOK_CONFIG_DIR']; resetIpcSchemaRegistryForTests(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); if (previousConfig === undefined) delete process.env['XIAOK_CONFIG_DIR']; else process.env['XIAOK_CONFIG_DIR'] = previousConfig; vi.useRealTimers(); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skills-readonly-owned-')), data = join(root, 'data'); roots.push(root); mkdirSync(data); processMocks.sync.mockReset(); processMocks.sync.mockReturnValue({ status: 0, error: undefined, stdout: '', stderr: '' }); process.env['XIAOK_CONFIG_DIR'] = join(root, 'config');
  const sdk = { start: async () => {}, stop: async () => {}, restart: async () => {}, getStatus: () => ({ running: false, port: 4400, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {}, request: async () => Response.json({}) };
  const service = createDesktopServices({ dataRoot: data, kswarmService: sdk as never, runner: async () => { throw Error('readonly_must_not_execute_task'); } });
  cleanups.push(async () => { await service.closeTaskSourceWritersForMigration(); await service.disposeMultiAgent(); });
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'authorizeDesktopInvoke'); expect(declaration).toBeDefined();
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href }, recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const code = ts.transpileModule("let mainWindow=initialMain,meetingRecorderController=initialRecorder;\n" + declaration!.getText(ast) + "\nreturn { authorize:authorizeDesktopInvoke,setMain(v){mainWindow=v;} };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const authority = compileFunction(code, ['initialMain', 'initialRecorder', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process'])({ webContents: sender, isDestroyed: () => false }, { ownsWebContents: (v: unknown) => v === recorder }, isTrustedDesktopRendererUrl, join, dirname, { env: {} });
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), ipc = new ShutdownAwareIpcMain({ handle: (name, listener) => { expect(listeners.has(name)).toBe(false); listeners.set(name, listener); } }, gate, authority.authorize);
  await registerDesktopIpc(ipc, { isDestroyed: () => false, webContents: { send() {}, id: 1 } } as never, service);
  const broadcast = ast.statements.length && (() => {
    let statement: ts.ExpressionStatement | undefined;
    const visit = (n: ts.Node) => { if (ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(ast) === 'onSkillCatalogChanged') statement = n; ts.forEachChild(n, visit); }; visit(ast);
    expect(statement).toBeDefined();
    const sent = vi.fn();
    const code = ts.transpileModule('return ' + statement!.expression.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const unsubscribe = compileFunction(code, ['onSkillCatalogChanged', 'mainWindow'])(onSkillCatalogChanged, { isDestroyed: () => false, webContents: { send: sent } });
    cleanups.push(async () => unsubscribe()); return sent;
  })();
  return { root, data, service, broadcast, frame, recorderFrame, sender, recorder, authority, gate, listeners, invoke: (method: string, ...args: unknown[]) => Reflect.apply(listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}

// Copy to desktop/tests/main/skill-mutation-controls.test.ts BEFORE applying proposal.patch.
// All RED expectations invoke the real registerDesktopIpc / createDesktopServices.
const methods = ['installSkill', 'uninstallSkill'] as const;
it.each(methods)('qualifies %s as an exact one-argument typed tuple', async method => {
  await fixture(); expect(IPC_SCHEMA_REGISTRY.get('desktop:' + method)).toMatchObject({ payloadMode: 'tuple', rolloutRound: 34 });
});
it.each(methods)('%s preserves clawhub command/deadline/cwd and invalidates+broadcasts once on success', async method => {
  const f = await fixture(), version = getSkillCatalogVersion();
  const result = await f.invoke(method, 'owned-skill'); expect(result.success).toBe(true);
  expect(processMocks.sync).toHaveBeenCalledExactlyOnceWith('clawhub', [method === 'installSkill' ? 'install' : 'uninstall', 'owned-skill'], { encoding: 'utf-8', timeout: method === 'installSkill' ? 60000 : 30000, cwd: process.cwd() });
  expect(getSkillCatalogVersion()).toBe(version + 1); expect(f.broadcast).toHaveBeenCalledExactlyOnceWith('desktop:skillsChanged'); expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s does not invalidate/broadcast on process errors, signal, timeout or nonzero exit', async method => {
  const f = await fixture();
  for (const failure of [{ status: 1, stderr: 'owned_failure', stdout: '' }, { status: null, signal: 'SIGTERM', stderr: '', stdout: '' }, { error: Error('ENOENT'), status: null }, { error: Error('ETIMEDOUT'), status: null }]) {
    const version = getSkillCatalogVersion(); processMocks.sync.mockReturnValueOnce(failure);
    expect((await f.invoke(method, 'owned-skill')).success).toBe(false); expect(getSkillCatalogVersion()).toBe(version);
  }
  expect(f.broadcast).not.toHaveBeenCalled(); expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s preserves bounded stderr/stdout fallback rather than a success ACK', async method => {
  const f = await fixture(); processMocks.sync.mockReturnValueOnce({ status: 3, stderr: ' x'.repeat(400), stdout: 'ignored' });
  expect(await f.invoke(method, 'owned-skill')).toEqual({ success: false, message: ' x'.repeat(400).trim().slice(0, 500) });
  processMocks.sync.mockReturnValueOnce({ status: 1, stderr: '', stdout: 'stdout-failure' }); expect((await f.invoke(method, 'owned-skill')).message).toBe('stdout-failure');
});
it.each(methods)('%s rejects missing/extra/source/path/option input before the actual OS boundary', async method => {
  const f = await fixture();
  for (const args of [[], ['owned', { requestSource: 'user' }], [42], [''], [' owned '], ['--force'], ['../escape'], ['C:\\escape'], ['C:escape'], ['\\\\server\\share'], ['/absolute'], ['.'], ['..'], ['bad\0name']]) {
    await expect(async () => f.invoke(method, ...args)).rejects.toThrow('skill_mutation_input_invalid');
  }
  expect(processMocks.sync).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled();
});
it.each(methods)('%s retains Unicode, namespace and interior-space caller names as one operand', async method => {
  const f = await fixture(); for (const name of ['报告技能', 'team:owned-skill', 'owned skill', 'a.b_c-1']) expect((await f.invoke(method, name)).success).toBe(true);
  expect(processMocks.sync.mock.calls.map(call => call[1][1])).toEqual(['报告技能', 'team:owned-skill', 'owned skill', 'a.b_c-1']);
});
it.each(methods)('%s captures input before toJSON/accessors or result logging can execute', async method => {
  const f = await fixture(); let reads = 0;
  for (const value of [Object.defineProperty({}, 'skill', { enumerable: true, get() { reads++; return 'owned'; } }), { toJSON() { reads++; return 'owned'; } }]) await expect(async () => f.invoke(method, value)).rejects.toThrow('skill_mutation_input_invalid');
  expect(reads).toBe(0); expect(processMocks.sync).not.toHaveBeenCalled();
});
it.each(methods)('%s enforces user source inside the real service, including omitted and accessor source', async method => {
  const f = await fixture(); const mutate = f.service[method] as unknown as (name: unknown, context?: unknown) => Promise<unknown>;
  let reads = 0; const accessor = Object.defineProperty({}, 'requestSource', { enumerable: true, get() { reads++; return 'user'; } });
  for (const context of [undefined, { requestSource: 'agent' }, { requestSource: 'scheduler' }, accessor]) await expect(async () => mutate('owned-skill', context)).rejects.toThrow('skill_mutation_source_forbidden');
  expect(reads).toBe(0); expect(processMocks.sync).not.toHaveBeenCalled();
  expect(await mutate('owned-skill', { requestSource: 'user' })).toMatchObject({ success: true });
});
it.each(methods)('%s validates names inside the real service even without IPC', async method => {
  const f = await fixture(); const mutate = f.service[method] as unknown as (name: unknown, context: unknown) => Promise<unknown>;
  await expect(async () => mutate('../escape', { requestSource: 'user' })).rejects.toThrow('skill_mutation_input_invalid'); expect(processMocks.sync).not.toHaveBeenCalled();
});
it.each(methods)('%s validates producer output before result getter/toJSON/unknown ACK', async method => {
  const f = await fixture(); let reads = 0;
  const accessor = Object.defineProperty({ message: 'owned' }, 'success', { enumerable: true, get() { reads++; return true; } });
  for (const value of [accessor, { success: true, message: 'owned', toJSON() { reads++; return {}; } }, undefined, { success: 'yes', message: 'owned' }]) {
    f.service[method] = (() => Promise.resolve(value)) as never;
    await expect(async () => f.invoke(method, 'owned')).rejects.toThrow('skill_mutation_output_invalid');
  }
  expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s rejects unsafe thenables without invoking their then accessor', async method => {
  const f = await fixture(); let reads = 0; const value = Object.defineProperty({}, 'then', { get() { reads++; return () => {}; } });
  f.service[method] = (() => value) as never; await expect(async () => f.invoke(method, 'owned')).rejects.toThrow('skill_mutation_output_invalid'); expect(reads).toBe(0);
});
it.each(methods)('%s detaches producer metadata and preserves business failure shape', async method => {
  const f = await fixture(), value = { success: false, message: 'owned_failure', future: { retained: true } }; f.service[method] = (() => Promise.resolve(value)) as never;
  const result = await f.invoke(method, 'owned'); expect(result).toEqual(value); expect(result).not.toBe(value); expect(result.future).not.toBe(value.future);
});
it.each(methods)('%s retains producer throw/reject identity and releases the original token', async method => {
  const f = await fixture(), failure = Error('owned_service_failure');
  f.service[method] = (() => { throw failure; }) as never; await expect(async () => f.invoke(method, 'owned')).rejects.toBe(failure);
  f.service[method] = (() => Promise.reject(failure)) as never; await expect(async () => f.invoke(method, 'owned')).rejects.toBe(failure); expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('%s denies unknown/old/subframe/bad-URL sender before input capture', async method => {
  const f = await fixture(); let reads = 0; const input = Object.defineProperty({}, 'field', { enumerable: true, get() { reads++; return 'owned'; } });
  const invokeAs = (sender: unknown, senderFrame: unknown) => Reflect.apply(f.listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame }, input]);
  await expect(async () => invokeAs({ ...f.sender }, f.frame)).rejects.toThrow('desktop_user_sender_forbidden');
  await expect(async () => invokeAs(f.sender, { ...f.frame })).rejects.toThrow('desktop_user_sender_forbidden');
  const url = f.frame.url; f.frame.url = 'https://untrusted.invalid/'; await expect(async () => invokeAs(f.sender, f.frame)).rejects.toThrow('desktop_user_sender_forbidden'); f.frame.url = url;
  f.authority.setMain({ isDestroyed: () => false, webContents: {} }); await expect(async () => invokeAs(f.sender, f.frame)).rejects.toThrow('desktop_user_sender_forbidden');
  expect(reads).toBe(0); expect(processMocks.sync).not.toHaveBeenCalled();
});
it.each(methods)('%s retains the existing owned Recorder admission population', async method => {
  const f = await fixture(); expect(await Reflect.apply(f.listeners.get('desktop:' + method)!, undefined, [{ sender: f.recorder, senderFrame: f.recorderFrame }, 'owned-skill'])).toMatchObject({ success: true });
});
it.each(methods)('%s holds one original token past shutdown deadline then drains and rejects new calls', async method => {
  const f = await fixture(); let release!: (v: { success: boolean; message: string }) => void;
  f.service[method] = (() => new Promise(resolve => { release = resolve; })) as never;
  vi.useFakeTimers(); const reading = f.invoke(method, 'owned'); await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  try { f.gate.close(); const drain = f.gate.drain(5000); await vi.advanceTimersByTimeAsync(5001); expect(await drain).toBe(false); expect(f.gate.outstanding).toBe(1); await expect(async () => f.invoke(method, 'other')).rejects.toThrow('shutting_down'); }
  finally { release({ success: true, message: 'owned' }); await reading; }
  expect(f.gate.outstanding).toBe(0);
});
