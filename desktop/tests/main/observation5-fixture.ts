// Ordinary fixture support. Copy to desktop/tests/main/observation5-fixture.ts.
// No new production module import; not native/controller qualification.
// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileFunction} from 'node:vm';
import {EventEmitter} from 'node:events';
import ts from 'typescript';
const nativeSurrogate=vi.hoisted(()=>({picker:vi.fn(),confirm:vi.fn(),pickerProducer:undefined as undefined|((...args:any[])=>unknown)}));
export function getNativeSurrogate() { return nativeSurrogate; }
vi.mock('electron',()=>({app:{getPath:()=>'/tmp',getLocale:()=> 'en'},BrowserWindow:{getAllWindows:()=>[],fromWebContents:(sender:any)=>({webContents:sender,isDestroyed:():boolean=>false})},clipboard:{read:vi.fn()},dialog:{showOpenDialog:(...args:any[])=>Reflect.apply(nativeSurrogate.pickerProducer??nativeSurrogate.picker,undefined,args),showMessageBox:nativeSurrogate.confirm},shell:{}}));
import {registerDesktopIpc} from '../../electron/ipc.js';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {consumeDesktopObservationApproval,createDesktopObservationApprovals} from '../../electron/desktop-observation-approval.js';
import {isTrustedDesktopRendererUrl} from '../../electron/security.js';
import {DesktopShutdownGate,ShutdownAwareIpcMain,type IpcHandlerListener} from '../../electron/shutdown-aware-ipc-main.js';
import {IPC_SCHEMA_REGISTRY,resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
const methods=['prepareObservationTask','createObservationTask','getObservationTaskStatus','stopObservationTask','revokeObservationTask'] as const;
const roots:string[]=[],cleanups:Array<()=>Promise<void>>=[];let previousConfig:string|undefined;
beforeEach(()=>{previousConfig=process.env.XIAOK_CONFIG_DIR;resetIpcSchemaRegistryForTests();nativeSurrogate.pickerProducer=undefined;nativeSurrogate.picker.mockReset();nativeSurrogate.confirm.mockReset();});
afterEach(async()=>{for(const fn of cleanups.splice(0))await fn();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});if(previousConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previousConfig;nativeSurrogate.pickerProducer=undefined;vi.restoreAllMocks();});
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
export async function fixture(fine=true) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'observation5-owned-')));roots.push(root);mkdirSync(join(root,'data'));process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const sdk={start:async()=>{},stop:async()=>{},restart:async()=>{},getStatus:()=>({running:false,port:4400,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},request:async()=>{throw Error('fixture_network_forbidden');}};
 const service=createDesktopServices({dataRoot:join(root,'data'),kswarmService:sdk as never,runner:async()=>{throw Error('fixture_task_execution_forbidden');}});
 cleanups.push(async()=>{await service.closeTaskSourceWritersForMigration();await service.disposeMultiAgent();});
 const source=readFileSync(resolve(process.cwd(),'electron/main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const outer=ast.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='authorizeDesktopInvoke');expect(outer).toBeDefined();
 const finer:ts.ArrowFunction[]=[];const walk=(node:ts.Node)=>{if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='multiAgentAuthorize'&&ts.isArrowFunction(node.initializer))finer.push(node.initializer);ts.forEachChild(node,walk);};walk(ast);expect(finer).toHaveLength(1);
 const dirname=resolve('dist/main/desktop/electron'),rendererFile=join(dirname,'../../../renderer/index.html');
 const frame={url:pathToFileURL(rendererFile).href},recorderFrame={url:frame.url+'#/meeting-recorder/owned'};
 const sender=Object.assign(new EventEmitter(),{mainFrame:frame,isDestroyed:():boolean=>false,send(){}}),recorder=Object.assign(new EventEmitter(),{mainFrame:recorderFrame,isDestroyed:():boolean=>false,send(){}});
 const code=ts.transpileModule('let mainWindow=initialMain,meetingRecorderController=initialRecorder;\n'+outer!.getText(ast)+'\nconst finer='+finer[0]!.getText(ast)+';\nreturn {authorize:authorizeDesktopInvoke,finer,setMain(value){mainWindow=value;}};', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 // Compile the two production authorizers verbatim. No locally reimplemented sender predicate.
 const authority=compileFunction(code,['initialMain','initialRecorder','isTrustedDesktopRendererUrl','join','__dirname','process','rendererFile','devServer','services'])({webContents:sender,isDestroyed:():boolean=>false},{ownsWebContents:(value:unknown)=>value===recorder},isTrustedDesktopRendererUrl,join,dirname,{env:{}},rendererFile,undefined,service);
 const listeners=new Map<string,IpcHandlerListener>(),gate=new DesktopShutdownGate();
 const ipc=new ShutdownAwareIpcMain({handle(name,fn){expect(listeners.has(name)).toBe(false);listeners.set(name,fn);}},gate,authority.authorize);
 await registerDesktopIpc(ipc,{webContents:sender,isDestroyed:():boolean=>false,once(){}} as never,service,fine?{multiAgentAuthorize:authority.finer}:{});
 const invoke=(method:string,...args:unknown[])=>Reflect.apply(listeners.get('desktop:'+method)!,undefined,[{sender,senderFrame:frame},...args]) as Promise<any>;
 const policyFile=join(root,'policy.json'),inputFile=join(root,'input.txt');writeFileSync(inputFile,'ordinary fixture');
 writeFileSync(policyFile,JSON.stringify({version:1,environmentId:'deepseek-recipe-0.1.1',model:'deepseek-flash',destination:{provider:'deepseek',url:'https://api.deepseek.com/chat/completions'},localPersistence:true,allowUnclassifiedText:true,allowModelDisclosure:true,allowIncomplete:false,expiresAt:Date.now()+60000,readFileScopes:[{filePath:inputFile,startLine:1}],bashSources:[]}));
 nativeSurrogate.picker.mockResolvedValue({canceled:false,filePaths:[policyFile]});nativeSurrogate.confirm.mockResolvedValue({response:1});
 // Explicit ordinary registrar boundary surrogate: NO actual controller/native permission qualification.
 // Real approval consumption is retained; no real model, material, metadata or native action is executed.
 const installControllerSurrogate=()=>{const control=Object.freeze(Object.create(null)),calls:{input:unknown;authority:unknown}[]=[];const stops:unknown[]=[],revokes:unknown[]=[];
  service.createObservationTask=(async(input,authority)=>{consumeDesktopObservationApproval(authority.approval);calls.push({input,authority});return {taskId:'owned-task',control};}) as typeof service.createObservationTask;
  service.stopObservationTask=((id,context)=>{stops.push({id,context});}) as typeof service.stopObservationTask;
  service.revokeObservationTask=(async(id,context)=>{revokes.push({id,context});}) as typeof service.revokeObservationTask;
  service.observationTaskStatus=async()=> 'active';return {control,calls,stops,revokes};};
 return {root,service,sender,recorder,frame,recorderFrame,authority,gate,listeners,invoke,policyFile,installControllerSurrogate};
}
