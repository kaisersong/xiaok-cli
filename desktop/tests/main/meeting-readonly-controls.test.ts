import { createMeetingAsrConfigSnapshot } from '../../electron/meeting-asr-config.js';
import { DEFAULT_CONFIG } from '../../../src/types.js';
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


it.each(['meeting:getMicrophonePermission','meeting:getAsrConfig','meeting:listModels']as const)('rejects %s extra transport input before producer work',async channel=>{
 const f=await fixture();await expect(async()=>f.invoke(channel,{})).rejects.toThrow('meeting_readonly_input_invalid');
});
it('bad actual owned ASR configuration rejects without repairing the file',async()=>{
 const f=await fixture(),config=join(f.root,'config');mkdirSync(config,{recursive:true});const path=join(config,'config.json');writeFileSync(path,'{');await expect(async()=>f.invoke('meeting:getAsrConfig')).rejects.toThrow();expect(readFileSync(path,'utf8')).toBe('{');expect(existsSync(path+'.bak')).toBe(false);
});
it.each(['unknown','old-main','subframe'])('denies %s before the real meeting readonly payload getter',async kind=>{
 const f=await fixture(),old=f.sender;if(kind==='old-main')f.authority.setMain({webContents:{mainFrame:f.frame,isDestroyed:()=>false},isDestroyed:()=>false});const sender=kind==='unknown'?{mainFrame:f.frame,isDestroyed:()=>false}:old,frame=kind==='subframe'?{url:f.frame.url}:f.frame;let getters=0;const input=Object.defineProperty({},'owned',{enumerable:true,get(){getters++;return 0}});await expect(async()=>Reflect.apply(f.listeners.get('desktop:meeting:getAsrConfig')!,undefined,[{sender,senderFrame:frame},input])).rejects.toThrow('desktop_user_sender_forbidden');expect(getters).toBe(0);
});
it('preserves actual valid ASR public flags and excludes stored credentials',async()=>{
 const f=await fixture(),config=join(f.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:2,providers:{},models:[],meeting:{asr:{defaultProvider:'aliyun-asr',aliyun:{apiKey:'owned-test-not-real-key',baseUrl:'https://owned.invalid',model:'owned-model'}}}}));const dto=await f.invoke('meeting:getAsrConfig');expect(dto.defaultProvider).toBe('aliyun-asr');expect(dto.aliyun).toMatchObject({configured:true,apiKeyConfigured:true,baseUrl:'https://owned.invalid',model:'owned-model'});expect(JSON.stringify(dto)).not.toContain('owned-test-not-real-key');
});

it.each([{meeting:[]},{meeting:{asr:[]}},{meeting:{asr:{defaultProvider:'invented'}}},{meeting:{asr:{volcengine:[]}}},{meeting:{asr:{aliyun:{apiKey:42}}}},{meeting:{asr:{volcengine:{endpoint:false}}}}])('rejects malformed stored ASR shape without normalizing it to default facts: %j',async stored=>{
 const f=await fixture(),config=join(f.root,'config');mkdirSync(config,{recursive:true});const path=join(config,'config.json'),raw=JSON.stringify({schemaVersion:2,providers:{},models:[],...stored});writeFileSync(path,raw);await expect(async()=>f.invoke('meeting:getAsrConfig')).rejects.toThrow('meeting_readonly_projection_unavailable');expect(readFileSync(path,'utf8')).toBe(raw);expect(existsSync(path+'.bak')).toBe(false);
});

it('true ENOENT returns the precise original default ASR snapshot without creating a config file',async()=>{const f=await fixture();expect(await f.invoke('meeting:getAsrConfig')).toEqual(createMeetingAsrConfigSnapshot(JSON.parse(JSON.stringify(DEFAULT_CONFIG))));expect(existsSync(join(f.root,'config/config.json'))).toBe(false);});
it('actual owned ASR file permission failure rejects without chmod or backup',async()=>{const f=await fixture(),dir=join(f.root,'config');mkdirSync(dir);const path=join(dir,'config.json');writeFileSync(path,JSON.stringify({schemaVersion:2,providers:{},models:[]}));chmodSync(path,0);try{await expect(async()=>f.invoke('meeting:getAsrConfig')).rejects.toThrow();}finally{chmodSync(path,0o600);}expect(existsSync(path+'.bak')).toBe(false);});

it('does not expose credential fragments from actual malformed ASR JSON through IPC rejection',async()=>{
 const f=await fixture(),dir=join(f.root,'config');mkdirSync(dir);const path=join(dir,'config.json'),raw='{"meeting":{"asr":{"aliyun":{"apiKey":owned-fake-credential-marker-asr}}}}';writeFileSync(path,raw);const error=await Promise.resolve().then(()=>f.invoke('meeting:getAsrConfig')).catch((value:unknown)=>value);expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('meeting_readonly_projection_unavailable');expect(String(error)).not.toContain('owned-fake');expect(readFileSync(path,'utf8')).toBe(raw);expect(existsSync(path+'.bak')).toBe(false);
});
