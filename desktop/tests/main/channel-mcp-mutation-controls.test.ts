// UNREVIEWED RED CANDIDATE. Copy to desktop/tests/main/channel-mcp-mutation-controls.test.ts.
// cd desktop && npm run test -- --run tests/main/channel-mcp-mutation-controls.test.ts
// Production registrar + service + production Main authorizer AST, no reimplemented business logic.
// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
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
  const root = mkdtempSync(join(tmpdir(), 'channel-mcp-mutation-owned-')), data = join(root, 'data'); roots.push(root); mkdirSync(data); process.env['XIAOK_CONFIG_DIR'] = join(root, 'config');
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


const methods = ['createChannel','updateChannel','deleteChannel','testChannel','createMCPInstall','updateMCPInstall','deleteMCPInstall'] as const;
type Method = typeof methods[number];
const legitimate: Record<Method, unknown[]> = {
  createChannel:[{type:'owned',name:'Owned',webhookUrl:'https://owned.invalid/path?token=OWNED_SECRET'}],
  updateChannel:['owned',{enabled:false}],deleteChannel:['owned'],testChannel:['owned'],
  createMCPInstall:[{name:'Owned MCP',source:'local',command:'C:\\owned\\command',args:['--owned','']}],
  updateMCPInstall:['owned',{enabled:false}],deleteMCPInstall:['owned'],
};
function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const config=join(f.root,'config');mkdirSync(config,{recursive:true});
  writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:2,providers:{private:{apiKey:'OWNED_PROVIDER_SECRET'}},models:{},future:{keep:true},channels:{owned:{name:'Owned',sendMsgUrl:'https://owned.invalid/path?token=OWNED_SECRET',enabled:true,appSecret:'OWNED_APP_SECRET',future:{keep:true}}}}));
  writeFileSync(join(f.data,'mcp-installs.json'),JSON.stringify([{id:'owned',name:'Owned MCP',source:'local',command:'owned-command',args:['--owned',''],enabled:true,createdAt:1,future:{keep:true}}]));
}
it('registers all seven tuple contracts at the actual production registrar', async()=>{
  await fixture();for(const method of methods)expect(IPC_SCHEMA_REGISTRY.get('desktop:'+method)).toMatchObject({payloadMode:'tuple',inputStage:'beforeHandler',sourceFile:'desktop/electron/channel-mcp-mutation-typed-ipc.ts'});
});
it.each(methods)('%s rejects surplus tuple arguments before its service',async method=>{
  const f=await fixture();seed(f);const producer=vi.spyOn(f.service,method);
  await expect(f.invoke(method,...legitimate[method],{})).rejects.toThrow('channel_mcp_mutation_input_invalid');expect(producer).not.toHaveBeenCalled();
});
it.each(methods)('%s rejects accessor inputs without invoking getters or service',async method=>{
  const f=await fixture();seed(f);let reads=0;const input=Object.defineProperty({},'name',{enumerable:true,get(){reads++;return 'Owned'}}),producer=vi.spyOn(f.service,method);
  const args=method.startsWith('update')?['owned',input]:[input];
  await expect(f.invoke(method,...args)).rejects.toThrow('channel_mcp_mutation_input_invalid');expect(reads).toBe(0);expect(producer).not.toHaveBeenCalled();
});
it.each(methods)('%s rejects proxy input without traps or service',async method=>{
  const f=await fixture();seed(f);let traps=0;const input=new Proxy({},{ownKeys(){traps++;throw Error('owned')}}),producer=vi.spyOn(f.service,method);
  await expect(f.invoke(method,...(method.startsWith('update')?['owned',input]:[input]))).rejects.toThrow('channel_mcp_mutation_input_invalid');expect(traps).toBe(0);expect(producer).not.toHaveBeenCalled();
});
it.each(methods)('%s denies absent/agent/scheduler source at the actual service, before disk/network',async method=>{
  const f=await fixture();seed(f);const config=join(f.root,'config','config.json'),mcp=join(f.data,'mcp-installs.json'),a=readFileSync(config,'utf8'),b=readFileSync(mcp,'utf8');
  const network=vi.fn(async()=>Response.json({}));vi.stubGlobal('fetch',network);
  try{for(const source of [undefined,'agent','scheduler'])await expect(Reflect.apply(f.service[method],f.service,[...legitimate[method],source])).rejects.toThrow('channel_mcp_mutation_request_source_forbidden');
    expect(network).not.toHaveBeenCalled();expect(readFileSync(config,'utf8')).toBe(a);expect(readFileSync(mcp,'utf8')).toBe(b);
  }finally{vi.unstubAllGlobals();}
});
it.each(methods)('%s is admitted as user only through the real Main binding',async method=>{
  const f=await fixture();seed(f);const producer=vi.spyOn(f.service,method),network=vi.fn(async()=>Response.json({}));vi.stubGlobal('fetch',network);
  try{await f.invoke(method,...legitimate[method]);expect(producer).toHaveBeenCalledExactlyOnceWith(...legitimate[method],'user');}finally{vi.unstubAllGlobals();}
});
it.each(methods)('%s rejects unknown sender/old main/subframe before payload getters',async method=>{
  for(const kind of ['unknown','old-main','subframe']){
    const f=await fixture();seed(f);const old=f.sender;if(kind==='old-main')f.authority.setMain({webContents:{mainFrame:f.frame,isDestroyed:()=>false},isDestroyed:()=>false});
    const sender=kind==='unknown'?{mainFrame:f.frame,isDestroyed:()=>false}:old,frame=kind==='subframe'?{url:f.frame.url}:f.frame;let reads=0;
    const input=Object.defineProperty({},'name',{enumerable:true,get(){reads++;return 'Owned'}}),producer=vi.spyOn(f.service,method);
    await expect(Reflect.apply(f.listeners.get('desktop:'+method)!,undefined,[{sender,senderFrame:frame},input])).rejects.toThrow('desktop_user_sender_forbidden');expect(reads).toBe(0);expect(producer).not.toHaveBeenCalled();
  }
});
it.each(methods)('%s retains legal Recorder caller population',async method=>{
  const f=await fixture();seed(f);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
  try{const result=await Reflect.apply(f.listeners.get('desktop:'+method)!,undefined,[{sender:f.recorder,senderFrame:f.recorderFrame},...legitimate[method]]);if(method.startsWith('delete'))expect(result).toBeUndefined();else expect(result).toBeDefined();}finally{vi.unstubAllGlobals();}
});
it.each(['createChannel','updateChannel','deleteChannel','testChannel'] as const)('%s refuses corrupted config without backup/removal/write/fetch',async method=>{
  const f=await fixture();seed(f);const path=join(f.root,'config','config.json'),bytes='{"OWNED_PRIVATE_CONFIG_SECRET":';writeFileSync(path,bytes);vi.stubGlobal('fetch',vi.fn());
  try{const result=await f.invoke(method,...legitimate[method]).then(()=>null,(error: unknown)=>error);
    expect(result).toBeInstanceOf(Error);expect(result.message).toBe('channel_mcp_mutation_source_unavailable');expect(result.message).not.toContain('OWNED_PRIVATE_CONFIG_SECRET');expect(readFileSync(path,'utf8')).toBe(bytes);expect(existsSync(path+'.bak')).toBe(false);expect(fetch).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
});
it.each(['createMCPInstall','updateMCPInstall','deleteMCPInstall'] as const)('%s refuses corrupted MCP bytes instead of fallback [] overwrite',async method=>{
  const f=await fixture();seed(f);const path=join(f.data,'mcp-installs.json'),bytes='{"OWNED_PRIVATE_MCP_SECRET":';writeFileSync(path,bytes);
  await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_source_unavailable');expect(readFileSync(path,'utf8')).toBe(bytes);
});
it.each(['createMCPInstall','updateMCPInstall','deleteMCPInstall'] as const)('%s rejects a malformed row anywhere in the table without discarding it',async method=>{
  const f=await fixture();seed(f);const path=join(f.data,'mcp-installs.json'),rows=JSON.parse(readFileSync(path,'utf8'));rows.push({id:'bad',args:7});const bytes=JSON.stringify(rows);writeFileSync(path,bytes);
  await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_source_unavailable');expect(readFileSync(path,'utf8')).toBe(bytes);
});
it('same-turn concurrent channel edits and MCP creates preserve both real commits',async()=>{
  const f=await fixture();seed(f);
  await Promise.all([f.invoke('createChannel',{type:'a',name:'A'}),f.invoke('createChannel',{type:'b',name:'B'})]);
  expect(JSON.parse(readFileSync(join(f.root,'config','config.json'),'utf8')).channels).toMatchObject({a:{name:'A'},b:{name:'B'},owned:{appSecret:'OWNED_APP_SECRET'}});
  const created=await Promise.all([f.invoke('createMCPInstall',{name:'A',source:'local',command:'a'}),f.invoke('createMCPInstall',{name:'B',source:'local',command:'b'})]);
  const rows=await f.invoke('listMCPInstalls');expect(rows.map((row:{id:string})=>row.id)).toEqual(expect.arrayContaining(created.map((row:{id:string})=>row.id)));expect(rows).toHaveLength(3);
});
it('real creation persists all currently submitted UI credentials but public ACK/list exclude them',async()=>{
  const f=await fixture();seed(f);const result=await f.invoke('createChannel',{type:'discord',name:'Owned Discord',botToken:'OWNED_BOT_SECRET',chatId:'owned-room'});
  const config=JSON.parse(readFileSync(join(f.root,'config','config.json'),'utf8'));
  expect(config.channels.discord).toMatchObject({botToken:'OWNED_BOT_SECRET',chatId:'owned-room'});expect(config.providers.private.apiKey).toBe('OWNED_PROVIDER_SECRET');expect(config.future).toEqual({keep:true});
  expect(JSON.stringify(result)).not.toContain('OWNED_BOT_SECRET');expect(JSON.stringify(await f.invoke('listChannels'))).not.toContain('OWNED_BOT_SECRET');
});
it('MCP args update and metadata survive real write/read, without installing/spawning',async()=>{
  const f=await fixture();seed(f);const result=await f.invoke('updateMCPInstall','owned',{args:['--new','']});
  expect(result.args).toEqual(['--new','']);const rows=await f.invoke('listMCPInstalls');expect(rows[0]).toMatchObject({args:['--new',''],future:{keep:true}});
});
it('schema1 channel edit preserves legacy provider secrets and unknown fields',async()=>{
  const f=await fixture();seed(f);const path=join(f.root,'config','config.json'),original={schemaVersion:1,defaultModel:'openai',models:{openai:{apiKey:'OWNED_LEGACY_KEY'}},future:{keep:true},channels:{owned:{name:'Old',secret:'OWNED_CHANNEL_KEY'}}};writeFileSync(path,JSON.stringify(original));
  await f.invoke('updateChannel','owned',{name:'New'});const actual=JSON.parse(readFileSync(path,'utf8'));expect(actual).toEqual({...original,channels:{owned:{...original.channels.owned,name:'New'}}});
});
it('channel test returns fixed failure without reading an exception message getter or credential echo',async()=>{
  const f=await fixture();seed(f);let reads=0;const error=Object.defineProperty({},'message',{get(){reads++;return 'OWNED_NETWORK_SECRET'}});vi.stubGlobal('fetch',vi.fn().mockRejectedValue(error));
  try{expect(await f.invoke('testChannel','owned')).toEqual({success:false,error:'channel_mcp_mutation_network_failed'});expect(reads).toBe(0);}finally{vi.unstubAllGlobals();}
});
it('HTTP rejection remains business false; no retry and original webhook POST payload retained',async()=>{
  const f=await fixture();seed(f);const network=vi.fn(async(..._args:unknown[])=>new Response('',{status:403}));vi.stubGlobal('fetch',network);
  try{expect(await f.invoke('testChannel','owned')).toMatchObject({success:false,error:'HTTP 403'});expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0]).toEqual(['https://owned.invalid/path?token=OWNED_SECRET',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({msgtype:'text',text:{content:'xiaok 测试连接 ✅'}})}]);}finally{vi.unstubAllGlobals();}
});
it.each(methods)('%s rejects invalid production output rather than a successful contract-violation envelope',async method=>{
  const f=await fixture();seed(f);f.service[method]=(()=>({ok:false,error:'OWNED_LEAK'}))as never;const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_projection_unavailable');}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
it.each(methods)('%s rejects output accessors without executing them',async method=>{
  const f=await fixture();seed(f);let reads=0;const result=Object.defineProperty({},'success',{enumerable:true,get(){reads++;return true}});f.service[method]=(()=>result)as never;
  await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_projection_unavailable');expect(reads).toBe(0);
});
it.each(methods)('%s keeps original producer rejection identity',async method=>{
  const f=await fixture();seed(f);const error=Error('owned-domain-failure');f.service[method]=(()=>{throw error})as never;await expect(f.invoke(method,...legitimate[method])).rejects.toBe(error);
  f.service[method]=(()=>Promise.reject(error))as never;await expect(f.invoke(method,...legitimate[method])).rejects.toBe(error);
});
it('held actual testChannel network promise retains the original shutdown token beyond five seconds',async()=>{
  const f=await fixture();seed(f);let release!:(response:Response)=>void;const network=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve}));vi.stubGlobal('fetch',network);vi.useFakeTimers();
  const pending=f.invoke('testChannel','owned');await Promise.resolve();await Promise.resolve();
  try{expect(f.gate.outstanding).toBe(1);const drain=f.gate.drain(5000);await vi.advanceTimersByTimeAsync(5001);expect(await drain).toBe(false);expect(f.gate.outstanding).toBe(1);expect(network).toHaveBeenCalledTimes(1);}finally{release(Response.json({}));await pending;vi.unstubAllGlobals();}expect(f.gate.outstanding).toBe(0);
});

it.each(methods)('%s rejects promise constructor accessors without reading them',async method=>{
  const f=await fixture();seed(f);let reads=0;const result=Promise.resolve(undefined);Object.defineProperty(result,'constructor',{get(){reads++;return Promise}});f.service[method]=(()=>result)as never;
  await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_projection_unavailable');expect(reads).toBe(0);
});
it.each(methods)('%s rejects proxy/cycle/serializer output without traps/serialization/retry',async method=>{
  const f=await fixture();seed(f);let reads=0;const cycle:{self?:unknown}={};cycle.self=cycle;
  for(const output of [new Proxy({},{ownKeys(){reads++;throw Error('owned')}}),cycle,{toJSON(){reads++;return {}}}]){
    const producer=vi.spyOn(f.service,method).mockImplementation((()=>output)as never);
    await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_projection_unavailable');expect(reads).toBe(0);expect(producer).toHaveBeenCalledTimes(1);producer.mockRestore();
  }
});
it.each(['createChannel','updateChannel','deleteChannel','testChannel']as const)('%s rejects invalid channels map before normalization can erase it',async method=>{
  const f=await fixture();seed(f);const path=join(f.root,'config','config.json'),bytes=JSON.stringify({schemaVersion:2,providers:{},models:{},channels:[]});writeFileSync(path,bytes);
  await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_source_unavailable');expect(readFileSync(path,'utf8')).toBe(bytes);
});
const posix = process.platform !== 'win32' && process.getuid?.() !== 0;
it.runIf(posix).each(['createChannel','updateChannel','deleteChannel','testChannel','createMCPInstall','updateMCPInstall','deleteMCPInstall']as const)('%s refuses actual parent EACCES instead of defaults',async method=>{
  const f=await fixture();seed(f);const directory=method.includes('MCP')?f.data:join(f.root,'config'),file=join(directory,method.includes('MCP')?'mcp-installs.json':'config.json'),bytes=readFileSync(file,'utf8');chmodSync(directory,0);
  try{await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_source_unavailable');}finally{chmodSync(directory,0o700);}
  expect(readFileSync(file,'utf8')).toBe(bytes);expect(existsSync(file+'.bak')).toBe(false);
});
it.runIf(posix).each(['createChannel','createMCPInstall']as const)('%s ACK waits for real write completion and refuses unwritable missing target',async method=>{
  const f=await fixture();seed(f);const directory=method.includes('MCP')?f.data:join(f.root,'config'),file=join(directory,method.includes('MCP')?'mcp-installs.json':'config.json');unlinkSync(file);chmodSync(directory,0o500);
  try{await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_write_failed');}finally{chmodSync(directory,0o700);}expect(existsSync(file)).toBe(false);
});

it.each(['createMCPInstall','updateMCPInstall','deleteMCPInstall']as const)('%s rejects JSON null/scalar/object rather than treating them as a missing MCP file',async method=>{
 const f=await fixture();seed(f);const path=join(f.data,'mcp-installs.json');
 for(const bytes of ['null','false','42','{}']){writeFileSync(path,bytes);await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_source_unavailable');expect(readFileSync(path,'utf8')).toBe(bytes);}
});
it.each(['createChannel','updateChannel','deleteChannel','testChannel']as const)('%s rejects JSON null/scalar/array config instead of replacing it with defaults',async method=>{
 const f=await fixture();seed(f);const path=join(f.root,'config','config.json');
 for(const bytes of ['null','false','42','[]']){writeFileSync(path,bytes);await expect(f.invoke(method,...legitimate[method])).rejects.toThrow('channel_mcp_mutation_source_unavailable');expect(readFileSync(path,'utf8')).toBe(bytes);expect(existsSync(path+'.bak')).toBe(false);}
});
