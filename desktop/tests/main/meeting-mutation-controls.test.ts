// UNREVIEWED RED CANDIDATE. Copy to desktop/tests/main/meeting-mutation-controls.test.ts.
// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'meeting-mutation-owned-')), data = join(root, 'data'); roots.push(root); mkdirSync(data); process.env['XIAOK_CONFIG_DIR'] = join(root, 'config');
  const sdk = { start: async () => {}, stop: async () => {}, restart: async () => {}, getStatus: () => ({ running: false, port: 4400, pid: null, restartCount: 0, lastError: null }), onStatusChange: () => () => {}, request: async () => Response.json({}) };
  const service = createDesktopServices({ dataRoot: data, kswarmService: sdk as never, runner: async () => { throw Error('readonly_must_not_execute_task'); } });
  cleanups.push(async () => { await service.closeTaskSourceWritersForMigration(); await service.disposeMultiAgent(); });
  const source = readFileSync(new URL('../../electron/main.ts', import.meta.url), 'utf8'), ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'authorizeDesktopInvoke'); expect(declaration).toBeDefined();
  const dirname = resolve('dist/main/desktop/electron'), frame = { url: pathToFileURL(join(dirname, '../../../renderer/index.html')).href }, recorderFrame = { url: frame.url + '#/meeting-recorder/owned' };
  const sender = { mainFrame: frame, isDestroyed: () => false }, recorder = { mainFrame: recorderFrame, isDestroyed: () => false };
  const code = ts.transpileModule("let mainWindow=initialMain,meetingRecorderController=initialRecorder;\n" + declaration!.getText(ast) + "\nreturn { authorize:authorizeDesktopInvoke,setMain(v){mainWindow=v;},setRecorder(v){meetingRecorderController=v;} };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const authority = compileFunction(code, ['initialMain', 'initialRecorder', 'isTrustedDesktopRendererUrl', 'join', '__dirname', 'process'])({ webContents: sender, isDestroyed: () => false }, { ownsWebContents: (v: unknown) => v === recorder }, isTrustedDesktopRendererUrl, join, dirname, { env: {} });
  const listeners = new Map<string, IpcHandlerListener>(), gate = new DesktopShutdownGate(), ipc = new ShutdownAwareIpcMain({ handle: (name, listener) => { expect(listeners.has(name)).toBe(false); listeners.set(name, listener); } }, gate, authority.authorize);
  await registerDesktopIpc(ipc, { isDestroyed: () => false, webContents: { send() {}, id: 1 } } as never, service);
  return { root, data, service, frame, recorderFrame, sender, recorder, authority, gate, listeners, invoke: (method: string, ...args: unknown[]) => Reflect.apply(listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}


// Fixture above is copied from the accepted readonly3 real-entry test. Main
// authorizeDesktopInvoke is extracted from production, not reimplemented here.
const methods = ['requestMicrophonePermission', 'saveAsrConfig', 'downloadModel', 'uninstallModel'] as const;
it.each(methods)('registers actual %s with captured tuple metadata', async method => {
  await fixture(); const entry = IPC_SCHEMA_REGISTRY.get('desktop:meeting:' + method);
  expect(entry).toMatchObject({ payloadMode: 'tuple', inputStage: 'beforeHandler', sourceFile: 'desktop/electron/meeting-mutation-typed-ipc.ts' });
});
it.each([
  ['requestMicrophonePermission', [{}]],
  ['saveAsrConfig', [{ defaultProvider: 'invented' }]],
  ['saveAsrConfig', [{ aliyun: { apiKey: 'owned-fixture-marker', clearApiKey: 'yes' } }]],
  ['saveAsrConfig', [{ aliyun: { unknownField: true } }]],
  ['saveAsrConfig', [{}, {}]],
  ['downloadModel', [42]], ['downloadModel', ['../outside']], ['downloadModel', ['never-a-registry-id', {}]],
  ['uninstallModel', [{}]], ['uninstallModel', ['never-a-registry-id', {}]],
] as [string, unknown[]][])('rejects %s invalid tuple without fabricating an ACK', async (method, args) => {
  const f = await fixture(); await expect(async () => f.invoke('meeting:' + method, ...args)).rejects.toThrow('meeting_mutation_input_invalid');
  expect(existsSync(join(f.root, 'config', 'config.json'))).toBe(false); expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('captures %s input before reading caller accessors', async method => {
  const f = await fixture(); let getters = 0;
  const payload = Object.defineProperty({}, method === 'saveAsrConfig' ? 'aliyun' : 'toString', { enumerable: true, get() { getters++; return method === 'saveAsrConfig' ? {} : () => 'never-a-registry-id'; } });
  await expect(async () => f.invoke('meeting:' + method, payload)).rejects.toThrow('meeting_mutation_input_invalid');
  expect(getters).toBe(0); expect(existsSync(join(f.root, 'config', 'config.json'))).toBe(false);
});
it.each(methods.flatMap(method => ['unknown', 'old-main', 'subframe', 'bad-url', 'retired-recorder'].map(kind => [method, kind])))('source gate rejects %s / %s before payload inspection', async (method, kind) => {
  const f = await fixture(); let getters = 0;
  if (kind === 'old-main') f.authority.setMain({ webContents: { mainFrame: f.frame, isDestroyed: () => false }, isDestroyed: () => false });
  if (kind === 'bad-url') f.frame.url = 'file:///never-owned/index.html';
  if (kind === 'retired-recorder') f.authority.setRecorder({ ownsWebContents: () => false });
  const sender = kind === 'unknown' ? { mainFrame: f.frame, isDestroyed: () => false } : kind === 'retired-recorder' ? f.recorder : f.sender;
  const frame = kind === 'subframe' ? { url: f.frame.url } : kind === 'retired-recorder' ? f.recorderFrame : f.frame;
  const payload = Object.defineProperty({}, 'aliyun', { enumerable: true, get() { getters++; return {}; } });
  await expect(async () => Reflect.apply(f.listeners.get('desktop:meeting:' + method)!, undefined, [{ sender, senderFrame: frame }, payload])).rejects.toThrow('desktop_user_sender_forbidden');
  expect(getters).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it.each(methods)('closed shutdown gate rejects %s before payload or work', async method => {
  const f = await fixture(); f.gate.close(); let reads = 0;
  const payload = Object.defineProperty({}, 'aliyun', { enumerable: true, get() { reads++; return {}; } });
  await expect(async () => f.invoke('meeting:' + method, payload)).rejects.toThrow('shutting_down'); expect(reads).toBe(0); expect(f.gate.outstanding).toBe(0);
});
it('save keeps actual credentials private and preserves explicit clear / blank semantics', async () => {
  const f = await fixture(); const path = join(f.root, 'config', 'config.json');
  const dto = await f.invoke('meeting:saveAsrConfig', { defaultProvider: 'aliyun-asr', aliyun: { apiKey: 'owned-fixture-not-a-real-key', baseUrl: 'https://owned.invalid/', model: 'owned-model' } });
  expect(dto.aliyun).toMatchObject({ configured: true, apiKeyConfigured: true, baseUrl: 'https://owned.invalid', model: 'owned-model' });
  expect(JSON.stringify(dto)).not.toContain('owned-fixture-not-a-real-key'); expect(JSON.parse(readFileSync(path, 'utf8')).meeting.asr.aliyun.apiKey).toBe('owned-fixture-not-a-real-key');
  await f.invoke('meeting:saveAsrConfig', { aliyun: { apiKey: '   ' } });
  expect(JSON.parse(readFileSync(path, 'utf8')).meeting.asr.aliyun.apiKey).toBe('owned-fixture-not-a-real-key');
  const cleared = await f.invoke('meeting:saveAsrConfig', { aliyun: { clearApiKey: true, apiKey: 'ignored-owned-marker' } });
  expect(cleared.aliyun.apiKeyConfigured).toBe(false); expect(JSON.parse(readFileSync(path, 'utf8')).meeting.asr.aliyun.apiKey).toBeUndefined();
});
it.each([[], [null], [undefined], [{}]].map(args => ({ args })))('keeps original nullish / empty save input behavior: %j', async ({ args }) => {
  const f = await fixture(); const dto = await f.invoke('meeting:saveAsrConfig', ...args);
  expect(dto.defaultProvider).toBe('sherpa-onnx-paraformer'); expect(existsSync(join(f.root, 'config', 'config.json'))).toBe(true);
});
it('corrupt actual config cannot be repaired into a successful save ACK or credential-bearing error', async () => {
  const f = await fixture(), dir = join(f.root, 'config'); mkdirSync(dir, { recursive: true });
  const path = join(dir, 'config.json'), raw = '{"meeting":{"asr":{"aliyun":{"apiKey":owned-private-marker}}}}'; writeFileSync(path, raw);
  await expect(async () => f.invoke('meeting:saveAsrConfig', { defaultProvider: 'whisper' })).rejects.toThrow('meeting_mutation_save_failed');
  expect(readFileSync(path, 'utf8')).toBe(raw); expect(existsSync(path + '.bak')).toBe(false);
});
it('a real filesystem save failure rejects with a fixed credential-free code', async () => {
  const f = await fixture(), dir = join(f.root, 'config'); mkdirSync(dir, { recursive: true }); mkdirSync(join(dir, 'config.json'));
  const error = await Promise.resolve().then(() => f.invoke('meeting:saveAsrConfig', { aliyun: { apiKey: 'owned-private-marker' } })).catch(e => e);
  expect(error).toBeInstanceOf(Error); expect(error.message).toBe('meeting_mutation_save_failed'); expect(String(error)).not.toContain('owned-private-marker');
});
it('two real saves in one turn retain edits to both providers', async () => {
  const f = await fixture(); await Promise.all([
    f.invoke('meeting:saveAsrConfig', { aliyun: { apiKey: 'owned-ali' } }),
    f.invoke('meeting:saveAsrConfig', { volcengine: { appKey: 'owned-volc' } }),
  ]);
  const data = JSON.parse(readFileSync(join(f.root, 'config', 'config.json'), 'utf8'));
  expect(data.meeting.asr.aliyun.apiKey).toBe('owned-ali'); expect(data.meeting.asr.volcengine.appKey).toBe('owned-volc');
});
it('current Recorder is a valid save caller through the production Main authorizer', async () => {
  const f = await fixture(); const dto = await Reflect.apply(f.listeners.get('desktop:meeting:saveAsrConfig')!, undefined, [{ sender: f.recorder, senderFrame: f.recorderFrame }, {}]);
  expect(dto.defaultProvider).toBe('sherpa-onnx-paraformer'); expect(f.gate.outstanding).toBe(0);
});

it.each(['https://owned:owned-private-marker@owned.invalid', 'https://owned.invalid/?token=owned-private-marker', 'https://owned.invalid/#owned-private-marker'])('rejects credential-bearing public endpoint %s before saving', async baseUrl => {
  const f = await fixture(); await expect(async () => f.invoke('meeting:saveAsrConfig', { aliyun: { apiKey: 'owned-private-marker', baseUrl } })).rejects.toThrow('meeting_mutation_input_invalid');
  expect(existsSync(join(f.root, 'config', 'config.json'))).toBe(false);
});
