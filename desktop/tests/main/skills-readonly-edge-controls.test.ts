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

it.each(['listSkills', 'getSkillStats'] as const)('rejects %s accessor input without reading it or calling a service', async method => {
  const f = await fixture(), produce = vi.spyOn(f.service, method); let reads = 0;
  const input = Object.defineProperty({}, 'owned', { enumerable: true, get() { reads++; return 'owned'; } });
  await expect(async () => f.invoke(method, input)).rejects.toThrow(method === 'listSkills' ? 'skill_list_input_invalid' : 'diagnostics_input_invalid');
  expect(reads).toBe(0); expect(produce).not.toHaveBeenCalled();
});
it.each(['listSkills', 'getSkillStats'] as const)('rejects %s proxy transport input without executing traps or producer', async method => {
  const f = await fixture(), produce = vi.spyOn(f.service, method); let traps = 0;
  const input = new Proxy({}, { ownKeys() { traps++; throw Error('proxy trap'); }, get() { traps++; throw Error('proxy get'); } });
  await expect(async () => f.invoke(method, input)).rejects.toThrow(method === 'listSkills' ? 'skill_list_input_invalid' : 'diagnostics_input_invalid');
  expect(traps).toBe(0); expect(produce).not.toHaveBeenCalled();
});
it.each(['listSkills', 'getSkillStats'] as const)('rejects %s serializer output without invoking serializer', async method => {
  const f = await fixture(); let serializations = 0;
  const row = { toJSON() { serializations++; return {}; } }; f.service[method] = (() => [row]) as never;
  await expect(async () => f.invoke(method)).rejects.toThrow(method === 'listSkills' ? 'skill_list_projection_unavailable' : 'diagnostics_projection_unavailable');
  expect(serializations).toBe(0);
});
it.each(['listSkills', 'getSkillStats'] as const)('rejects %s cyclic output without retrying producer', async method => {
  const f = await fixture(), row: { cycle?: unknown } = {}; row.cycle = row; const produce = vi.spyOn(f.service, method).mockImplementation((() => [row]) as never);
  await expect(async () => f.invoke(method)).rejects.toThrow(method === 'listSkills' ? 'skill_list_projection_unavailable' : 'diagnostics_projection_unavailable'); expect(produce).toHaveBeenCalledTimes(1);
});
it('detaches complete stats and future metadata for each synchronous invoke', async () => {
  const f = await fixture(), rows = [{skillName: '',totalCalls: 0,successCount: 0,errorCount: 0,avgDurationMs: NaN,p95DurationMs: 0,totalInputTokens: 0,totalOutputTokens: 0,lastCalledAt: 0,firstCalledAt: 0,future: {retained: ['owned']}}]; f.service.getSkillStats = (() => rows) as never;
  const a = await f.invoke('getSkillStats'), b = await f.invoke('getSkillStats'); expect(a).toEqual(rows); expect(a).not.toBe(rows); expect(a).not.toBe(b); expect(a[0].future).not.toBe(rows[0].future); expect(a[0].future.retained).not.toBe(b[0].future.retained);
});
