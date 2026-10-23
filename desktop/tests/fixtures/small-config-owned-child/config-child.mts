import {resolve,join} from 'node:path';import {readFileSync,mkdirSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';import {fileURLToPath} from 'node:url';
const desktopRoot=fileURLToPath(new URL('../../../',import.meta.url));
import {createDesktopServices} from '../../../electron/desktop-services.js';
import {DesktopShutdownGate,ShutdownAwareIpcMain} from '../../../electron/shutdown-aware-ipc-main.js';
import {loadConfig} from '../../../../src/utils/config.js';
const root=process.env.XIAOK_SMALL_CONFIG_TEST_HOME!;mkdirSync(join(root,'workspace'));let requests=0;
const sidecar={start:async()=>{},stop:async()=>{},restart:async()=>{},getStatus:()=>({running:false,port:0,pid:null,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},getDesktopMutationToken:()=> 'owned-test-token',request:async()=>{requests++;throw Error('unexpected_network');}};
const services=createDesktopServices({dataRoot:join(root,'data'),workspaceRoot:join(root,'workspace'),knowledgeDbPath:join(root,'knowledge.sqlite'),pluginRootDir:join(root,'plugins'),pluginDependencies:[],kswarmService:sidecar as never});
const names=['getSkillDebugConfig','saveSkillDebugConfig','getKswarmConfig','saveKswarmConfig'];const handlers=new Map<string,Function>();const gate=new DesktopShutdownGate();const ipc=new ShutdownAwareIpcMain({handle:(name,fn)=>handlers.set(name,fn)},gate);
const source=readFileSync(join(desktopRoot,'electron/main.ts'),'utf8');const parsed=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);const statements:ts.Statement[]=[];
function visit(node:ts.Node){if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)){const call=node.expression,target=call.expression,channel=call.arguments[0];if(ts.isPropertyAccessExpression(target)&&ts.isIdentifier(target.expression)&&target.expression.text==='shutdownAwareIpc'&&target.name.text==='handle'&&channel&&ts.isStringLiteral(channel)&&names.some(n=>channel.text==='desktop:'+n))statements.push(node);if(ts.isIdentifier(target)&&target.text==='registerDesktopSmallConfigIpc')statements.push(node);}ts.forEachChild(node,visit);}visit(parsed);
let registerDesktopSmallConfigIpc:unknown;if(statements.length===1)registerDesktopSmallConfigIpc=(await import('../../../electron/desktop-small-config-typed-ipc.js')).registerDesktopSmallConfigIpc;
if(statements.length!==4&&statements.length!==1)throw Error('actual_config_registration_missing');runInNewContext(ts.transpileModule(statements.map(n=>n.getText(parsed)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{shutdownAwareIpc:ipc,services,registerDesktopSmallConfigIpc});
const call=(n:string,...args:unknown[])=>handlers.get('desktop:'+n)!({},...args);const facts:Record<string,unknown>={};
try{await services.multiAgent?.ready;
 facts.initial=[await call(names[0]),await call(names[2])];facts.normal=[await call(names[1],{enabled:true}),await call(names[3],{maxConcurrentTasks:6.8}),await call(names[2])];
 const alias={enabled:true};const pending=call(names[1],alias);alias.enabled=false;try{facts.aliasReply=await pending;}catch(e){facts.aliasError=(e as Error).message;}facts.aliasPersisted=(await loadConfig()).skillDebug;
 let reads=0;const getter=Object.defineProperty({},'enabled',{enumerable:true,get(){reads++;return true;}});try{facts.getterReply=await call(names[1],getter);}catch(e){facts.getterError=(e as Error).message;}facts.getterReads=reads;
 try{await (services.saveSkillDebugConfig as Function)({enabled:false},'agent');facts.agentDenied=false;}catch(e){facts.agentDenied=true;facts.agentError=(e as Error).message;}
 const sourceDenials=[];for(const method of ['saveSkillDebugConfig','saveKswarmConfig'] as const)for(const source of ['agent','scheduler'] as const){let reads=0;const input=Object.defineProperty({},method==='saveSkillDebugConfig'?'enabled':'maxConcurrentTasks',{enumerable:true,get(){reads++;return method==='saveSkillDebugConfig'?false:9;}});let error='';try{await (services[method] as Function)(input,source);}catch(e){error=(e as Error).message;}sourceDenials.push({method,source,reads,error});}facts.sourceDenials=sourceDenials;
 facts.requests=requests;facts.outstanding=gate.outstanding;process.stdout.write('CONFIG_FACTS:'+JSON.stringify(facts)+'\n');
}finally{await services.disposeMultiAgent();}
