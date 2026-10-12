// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
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

it.each(['listChannels', 'listMCPInstalls'] as const)('readonly %s rejects extra arguments before service execution', async method => {
  const f = await fixture(), read = vi.spyOn(f.service, method);
  await expect(async () => f.invoke(method, {})).rejects.toThrow('channel_mcp_input_invalid'); expect(read).not.toHaveBeenCalled();
});
it('bad MCP JSON rejects through actual registered service instead of a successful empty list', async () => {
  const f = await fixture(); writeFileSync(join(f.data, 'mcp-installs.json'), '{'); await expect(async () => f.invoke('listMCPInstalls')).rejects.toThrow();
});
it('bad channel config rejects without modifying the real owned file or creating a backup', async () => {
  const f = await fixture(), config = join(f.root, 'config'); mkdirSync(config, {recursive:true}); const path = join(config, 'config.json'); writeFileSync(path, '{');
  await expect(async () => f.invoke('listChannels')).rejects.toThrow(); expect(readFileSync(path, 'utf8')).toBe('{'); expect(existsSync(path + '.bak')).toBe(false);
});
it('actual existing MCP creation output passes the readonly schema with original command and args', async () => {
  const f = await fixture(), created = await f.service.createMCPInstall({ name:'owned',source:'local',command:'C:\\owned\\command',args:['--owned',''] });
  const rows = await f.invoke('listMCPInstalls'); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject(created); expect(rows[0].args).toEqual(['--owned','']);
});
it('preserves real absent file success for both readonly facts', async () => { const f = await fixture(); expect(await f.invoke('listChannels')).toEqual([]); expect(await f.invoke('listMCPInstalls')).toEqual([]); });

it.each([null, 'text', false, [], {name:7}, {enabled:'bad'}, {webhookUrl:7}] as const)('rejects malformed channel row %j as an unavailable complete table', async value => {
  const f = await fixture(), config = join(f.root,'config'); mkdirSync(config,{recursive:true}); writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:2,providers:{},models:[],channels:{owned:value}}));
  await expect(async()=>f.invoke('listChannels')).rejects.toThrow();
});
it.each(['listChannels','listMCPInstalls'] as const)('rejects %s getter input before producer/getter execution', async method=>{
 const f=await fixture(),read=vi.spyOn(f.service,method);let getters=0;const payload=Object.defineProperty({},'owned',{enumerable:true,get(){getters++;return true}});
 await expect(async()=>f.invoke(method,payload)).rejects.toThrow('channel_mcp_input_invalid');expect(getters).toBe(0);expect(read).not.toHaveBeenCalled();
});
it.each(['listChannels','listMCPInstalls'] as const)('preserves %s producer rejection identity', async method=>{
 const f=await fixture(),failure=Error('owned_read_failure');f.service[method]=(()=>{throw failure})as never;await expect(async()=>f.invoke(method)).rejects.toBe(failure);
 f.service[method]=(()=>Promise.reject(failure))as never;await expect(async()=>f.invoke(method)).rejects.toBe(failure);
});
it('registers exactly the two readonly round32 tuple contracts',async()=>{
 await fixture();for(const method of ['listChannels','listMCPInstalls'])expect(IPC_SCHEMA_REGISTRY.get('desktop:'+method)).toMatchObject({rolloutRound:32,payloadMode:'tuple',inputStage:'beforeHandler',riskTags:['fs-read'],sourceFile:'desktop/electron/channel-mcp-readonly-typed-ipc.ts'});
});

it('Channel output rejects new config extras while MCP retains full legitimate metadata and args',async()=>{
 const f=await fixture();f.service.listChannels=(()=>[{id:'',type:'future',name:'',enabled:false,createdAt:0,updatedAt:0,leakedConfig:'owned'}])as never;await expect(async()=>f.invoke('listChannels')).rejects.toThrow('channel_mcp_projection_unavailable');
 const rows=[{id:'',source:'future-source',name:'',command:'',args:['','--owned'],enabled:false,createdAt:0,future:{retained:['owned']}}];f.service.listMCPInstalls=(()=>rows)as never;const a=await f.invoke('listMCPInstalls'),b=await f.invoke('listMCPInstalls');expect(a).toEqual(rows);expect(a).not.toBe(rows);expect(a[0].future).not.toBe(rows[0].future);expect(a[0].args).not.toBe(b[0].args);
});
it('rejects a channels map array rather than claiming the configuration is empty',async()=>{
 const f=await fixture(),config=join(f.root,'config');mkdirSync(config,{recursive:true});writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:2,providers:{},models:[],channels:[]}));await expect(async()=>f.invoke('listChannels')).rejects.toThrow('channel_mcp_projection_unavailable');
});
it.each(['listChannels','listMCPInstalls']as const)('retains the held %s IPC token beyond the original ordinary five seconds',async method=>{
 const f=await fixture();let release!:(value:never[])=>void;const held=new Promise<never[]>(resolve=>{release=resolve});f.service[method]=(()=>held)as never;vi.useFakeTimers();const read=f.invoke(method);await Promise.resolve();expect(f.gate.outstanding).toBe(1);
 try{const drain=f.gate.drain(5000);await vi.advanceTimersByTimeAsync(5001);expect(await drain).toBe(false);expect(f.gate.outstanding).toBe(1);}finally{release([]);await read;}expect(f.gate.outstanding).toBe(0);
});
it.each(['listChannels','listMCPInstalls']as const)('rejects %s proxy input before any trap or service',async method=>{
 const f=await fixture(),read=vi.spyOn(f.service,method);let traps=0;const payload=new Proxy({},{ownKeys(){traps++;throw Error('owned-trap')}});await expect(async()=>f.invoke(method,payload)).rejects.toThrow('channel_mcp_input_invalid');expect(traps).toBe(0);expect(read).not.toHaveBeenCalled();
});
it.each(['unknown','old-main','subframe'])('denies %s before readonly data or payload getter',async kind=>{
 const f=await fixture(),old=f.sender;if(kind==='old-main')f.authority.setMain({webContents:{mainFrame:f.frame,isDestroyed:()=>false},isDestroyed:()=>false});const sender=kind==='unknown'?{mainFrame:f.frame,isDestroyed:()=>false}:old;const frame=kind==='subframe'?{url:f.frame.url}:f.frame;let reads=0;const payload=Object.defineProperty({},'owned',{enumerable:true,get(){reads++;return 0}});const producer=vi.spyOn(f.service,'listChannels');
 await expect(async()=>Reflect.apply(f.listeners.get('desktop:listChannels')!,undefined,[{sender,senderFrame:frame},payload])).rejects.toThrow('desktop_user_sender_forbidden');expect(reads).toBe(0);expect(producer).not.toHaveBeenCalled();
});
it('keeps legal Recorder reading both readonly facts',async()=>{const f=await fixture();for(const method of ['listChannels','listMCPInstalls'])expect(await Reflect.apply(f.listeners.get('desktop:'+method)!,undefined,[{sender:f.recorder,senderFrame:f.recorderFrame}])).toEqual([]);});
it('normal schema1 config remains unchanged by the real readonly query',async()=>{
 const f=await fixture(),config=join(f.root,'config');mkdirSync(config,{recursive:true});const path=join(config,'config.json'),bytes=JSON.stringify({schemaVersion:1,defaultModel:'openai',models:{openai:{}},channels:{owned:{name:'',enabled:false,sendMsgUrl:'https://owned.invalid/legacy'}}});writeFileSync(path,bytes);const rows=await f.invoke('listChannels');expect(rows).toEqual([{id:'owned',type:'owned',name:'owned',enabled:false,webhookUrl:'https://owned.invalid/legacy',createdAt:0,updatedAt:0}]);expect(readFileSync(path,'utf8')).toBe(bytes);expect(existsSync(path+'.bak')).toBe(false);
});

it.each(['listChannels','listMCPInstalls']as const)('rejects %s output accessor before execution',async method=>{
 const f=await fixture();let reads=0;const row=Object.defineProperty({},'name',{enumerable:true,get(){reads++;return 'owned'}});f.service[method]=(()=>[row])as never;await expect(async()=>f.invoke(method)).rejects.toThrow('channel_mcp_projection_unavailable');expect(reads).toBe(0);
});
it.each(['listChannels','listMCPInstalls']as const)('rejects %s proxy output without executing traps',async method=>{
 const f=await fixture();let traps=0;const row=new Proxy({},{ownKeys(){traps++;throw Error('owned-proxy')}});f.service[method]=(()=>[row])as never;await expect(async()=>f.invoke(method)).rejects.toThrow('channel_mcp_projection_unavailable');expect(traps).toBe(0);
});
it.each(['listChannels','listMCPInstalls']as const)('rejects %s serializer output without running serializer',async method=>{
 const f=await fixture();let reads=0;const row={toJSON(){reads++;return {}}};f.service[method]=(()=>[row])as never;await expect(async()=>f.invoke(method)).rejects.toThrow('channel_mcp_projection_unavailable');expect(reads).toBe(0);
});
it.each(['listChannels','listMCPInstalls']as const)('rejects %s cyclic output without retry',async method=>{
 const f=await fixture(),row:{cycle?:unknown}={};row.cycle=row;const read=vi.spyOn(f.service,method).mockImplementation((()=>[row])as never);await expect(async()=>f.invoke(method)).rejects.toThrow('channel_mcp_projection_unavailable');expect(read).toHaveBeenCalledTimes(1);
});
