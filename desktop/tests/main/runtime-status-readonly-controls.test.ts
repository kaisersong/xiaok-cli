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
  return { ipc, root, data, service, frame, recorderFrame, sender, recorder, authority, gate, listeners, invoke: (method: string, ...args: unknown[]) => Reflect.apply(listeners.get('desktop:' + method)!, undefined, [{ sender, senderFrame: frame }, ...args]) };
}



async function statusFixture(method:'getComputerUseCapabilityStatus'|'kswarm:getStatus'){
 const f=await fixture();const row={running:false,port:4400,pid:null,restartCount:0,lastError:null,terminalDegraded:true,persistenceFailStopCount:2,lastPersistenceFailStop:'owned-failure',future:{kept:['owned']}};const produce=vi.fn(()=>row);
 if(method==='kswarm:getStatus'){
  const source=readFileSync(new URL('../../electron/main.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);let declaration:ts.ExpressionStatement|undefined;function visit(node:ts.Node){if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)){const call=node.expression,name=call.expression.getText(ast);if(name==='registerKswarmStatusReadonlyIpc'||name==='shutdownAwareIpc.handle'&&call.arguments[0]&&ts.isStringLiteral(call.arguments[0])&&call.arguments[0].text==='desktop:kswarm:getStatus')declaration=node;}ts.forEachChild(node,visit);}visit(ast);expect(declaration).toBeDefined();
  const isTyped=source.includes('registerKswarmStatusReadonlyIpc');const register=isTyped?(await import('../../electron/runtime-status-readonly-typed-ipc.js')).registerKswarmStatusReadonlyIpc:undefined;
  const code=ts.transpileModule(declaration!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;compileFunction(code,['shutdownAwareIpc','kswarmService','registerKswarmStatusReadonlyIpc'])(f.ipc,{getStatus:produce},register);
 }else vi.spyOn(f.service,'getComputerUseCapabilityStatus').mockImplementation(produce as never);
 return{...f,row,produce,invoke:(...args:unknown[])=>f.invoke(method,...args)};
}
it.each(['getComputerUseCapabilityStatus','kswarm:getStatus']as const)('rejects actual %s extra transport input before cached getter',async method=>{const f=await statusFixture(method);await expect(async()=>f.invoke({})).rejects.toThrow('runtime_status_input_invalid');expect(f.produce).not.toHaveBeenCalled();});
it.each(['getComputerUseCapabilityStatus','kswarm:getStatus']as const)('rejects actual %s malformed successful producer value',async method=>{const f=await statusFixture(method);f.produce.mockReturnValue({}as never);await expect(async()=>f.invoke()).rejects.toThrow('runtime_status_projection_unavailable');expect(f.produce).toHaveBeenCalledTimes(1);});
it.each(['unknown','old-main','subframe'])('denies %s before status producer and payload getters',async kind=>{const f=await statusFixture('kswarm:getStatus'),old=f.sender;if(kind==='old-main')f.authority.setMain({webContents:{mainFrame:f.frame,isDestroyed:()=>false},isDestroyed:()=>false});const sender=kind==='unknown'?{mainFrame:f.frame,isDestroyed:()=>false}:old,frame=kind==='subframe'?{url:f.frame.url}:f.frame;let reads=0;const input=Object.defineProperty({},'owned',{enumerable:true,get(){reads++;return'owned'}});await expect(async()=>Reflect.apply(f.listeners.get('desktop:kswarm:getStatus')!,undefined,[{sender,senderFrame:frame},input])).rejects.toThrow('desktop_user_sender_forbidden');expect(reads).toBe(0);expect(f.produce).not.toHaveBeenCalled();});
it('detaches all8 SDK fields and future metadata on each actual Main source invocation',async()=>{const f=await statusFixture('kswarm:getStatus'),a=await f.invoke(),b=await f.invoke();expect(a).toEqual(f.row);expect(a).not.toBe(f.row);expect(a).not.toBe(b);expect(a.future.kept).not.toBe(f.row.future.kept);expect(a.terminalDegraded).toBe(true);expect(a.persistenceFailStopCount).toBe(2);expect(f.gate.outstanding).toBe(0);});
