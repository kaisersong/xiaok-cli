// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  const root = mkdtempSync(join(tmpdir(), 'skills-readonly-owned-')), data = join(root, 'data'); roots.push(root); mkdirSync(data); process.env['XIAOK_CONFIG_DIR'] = join(root, 'config');
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
  return { root, data, service, frame, recorderFrame, sender, recorder, authority, gate, listeners, invoke: (method: string, ...args: unknown[]) => Reflect.apply(listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}
const record = { id: 'owned', skillNames: ['alpha', 'beta'], taskId: 'owned-task', startTime: 100, endTime: 110, durationMs: 10, status: 'success', inputTokens: 3, outputTokens: 4, prompt: '', triggerType: 'tool_call' };
it('qualifies both zero tuples without dropping any Diagnostics3 member', async () => {
  await fixture(); const list = IPC_SCHEMA_REGISTRY.get('desktop:listSkills'), stats = IPC_SCHEMA_REGISTRY.get('desktop:getSkillStats');
  expect(list).toMatchObject({ rolloutRound: 31, payloadMode: 'tuple' }); expect(stats).toMatchObject({ rolloutRound: 19, payloadMode: 'tuple' });
  expect(stats?.input.description).toContain('qualified-zero-tuple'); expect(IPC_SCHEMA_REGISTRY.has('desktop:diagnose')).toBe(true); expect(IPC_SCHEMA_REGISTRY.has('desktop:trace:export')).toBe(true);
});
it.each(['listSkills', 'getSkillStats'] as const)('rejects %s extra input before invoking the real service', async method => {
  const f = await fixture(); const fn = vi.spyOn(f.service, method).mockResolvedValue([]); await expect(async () => f.invoke(method, {})).rejects.toThrow(method === 'listSkills' ? 'skill_list_input_invalid' : 'diagnostics_input_invalid'); expect(fn).not.toHaveBeenCalled();
});
it.each(['listSkills', 'getSkillStats'] as const)('preserves %s producer error identity rather than a false empty snapshot', async method => {
  const f = await fixture(), failure = Error('owned_read_failure'); f.service[method] = (() => { throw failure; }) as never; await expect(async () => f.invoke(method)).rejects.toBe(failure);
  f.service[method] = (() => Promise.reject(failure)) as never; await expect(async () => f.invoke(method)).rejects.toBe(failure); expect(f.gate.outstanding).toBe(0);
});
it.each(['{', '{}', '[{}]'])('makes real record-file failure unavailable: %s', async content => {
  const f = await fixture(); writeFileSync(join(f.data, 'skill-exec.json'), content); await expect(async () => f.invoke('getSkillStats')).rejects.toThrow();
});
it('keeps actual missing/empty and normal ten-field aggregation plus historical NaN', async () => {
  const f = await fixture(); expect(await f.invoke('getSkillStats')).toEqual([]); writeFileSync(join(f.data, 'skill-exec.json'), '[]'); expect(await f.invoke('getSkillStats')).toEqual([]);
  writeFileSync(join(f.data, 'skill-exec.json'), JSON.stringify([record, { ...record, id: 'cancelled', status: 'cancelled', skillNames: [] }])); const rows = await f.invoke('getSkillStats');
  expect(rows.find((r: { skillName: string }) => r.skillName === 'alpha')).toEqual({ skillName: 'alpha', totalCalls: 1, successCount: 1, errorCount: 0, avgDurationMs: 10, p95DurationMs: 10, totalInputTokens: 3, totalOutputTokens: 4, firstCalledAt: 100, lastCalledAt: 110 });
  expect(rows.find((r: { skillName: string }) => r.skillName === 'unknown')).toMatchObject({ successCount: 0, errorCount: 0 });
  writeFileSync(join(f.data, 'skill-exec.json'), '[{"skillNames":["legacy"],"status":"success","startTime":1,"endTime":2}]'); expect(Number.isNaN((await f.invoke('getSkillStats'))[0].avgDurationMs)).toBe(true);
});
it('does not leave the ineffective two-second stats timer after a successful real read', async () => {
  const f = await fixture(); writeFileSync(join(f.data, 'skill-exec.json'), JSON.stringify([record])); vi.useFakeTimers(); const count = vi.getTimerCount(); await f.invoke('getSkillStats'); expect(vi.getTimerCount()).toBe(count);
});
it.each(['listSkills', 'getSkillStats'] as const)('captures %s output before a getter or serializer can run', async method => {
  const f = await fixture(); let reads = 0; const row = method === 'listSkills' ? { name: 'owned', aliases: [], description: '', source: 'project', tier: 'project' } : { skillName: '', totalCalls: 0, successCount: 0, errorCount: 0, avgDurationMs: NaN, p95DurationMs: 0, totalInputTokens: 0, totalOutputTokens: 0, lastCalledAt: 0, firstCalledAt: 0 };
  Object.defineProperty(row, method === 'listSkills' ? 'description' : 'totalCalls', { enumerable: true, get() { reads++; return 0; } }); f.service[method] = (() => [row]) as never;
  await expect(async () => f.invoke(method)).rejects.toThrow(method === 'listSkills' ? 'skill_list_projection_unavailable' : 'diagnostics_projection_unavailable'); expect(reads).toBe(0);
});
it('detaches the complete list metadata and extras on every invoke', async () => {
  const f = await fixture(), rows = [{ name: '', aliases: ['a'], description: '', source: '', tier: '', future: { keep: true } }]; f.service.listSkills = (() => rows) as never;
  const a = await f.invoke('listSkills'), b = await f.invoke('listSkills'); expect(a).toEqual(rows); expect(a).not.toBe(rows); expect(a).not.toBe(b); expect(a[0]).not.toBe(rows[0]); expect(a[0].aliases).not.toBe(rows[0].aliases);
});
it.each(['unknown', 'old-main', 'subframe'])('denies %s before any readonly payload getter or producer', async mode => {
  const f = await fixture(); let sender = f.sender, frame: unknown = f.frame; if (mode === 'unknown') sender = { ...sender }; if (mode === 'old-main') f.authority.setMain({ isDestroyed: () => false, webContents: {} }); if (mode === 'subframe') frame = { url: f.frame.url };
  let reads = 0; const input = Object.defineProperty({}, 'field', { enumerable: true, get() { reads++; return 'owned'; } }); const fn = vi.spyOn(f.service, 'listSkills');
  await expect(async () => Reflect.apply(f.listeners.get('desktop:listSkills')!, undefined, [{ sender, senderFrame: frame }, input])).rejects.toThrow('desktop_user_sender_forbidden'); expect(reads).toBe(0); expect(fn).not.toHaveBeenCalled();
});
it('keeps the legal Recorder readonly lane', async () => {
  const f = await fixture(); expect(await Reflect.apply(f.listeners.get('desktop:getSkillStats')!, undefined, [{ sender: f.recorder, senderFrame: f.recorderFrame }])).toEqual([]); expect(f.gate.outstanding).toBe(0);
});
it('keeps a held real stats IPC token after the ordinary five-second shutdown deadline', async () => {
  const f = await fixture(); let release!: (value: never[]) => void;
  const held = new Promise<never[]>(resolve => { release = resolve; }); f.service.getSkillStats = () => held;
  vi.useFakeTimers(); const reading = f.invoke('getSkillStats');
  await Promise.resolve(); expect(f.gate.outstanding).toBe(1);
  try {
    const draining = f.gate.drain(5000); await vi.advanceTimersByTimeAsync(5001);
    expect(await draining).toBe(false); expect(f.gate.outstanding).toBe(1);
  } finally { release([]); await reading; }
  expect(f.gate.outstanding).toBe(0);
});
