import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,existsSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import type {Tool} from '../../src/types.js';
import {createReadTool} from '../../src/ai/tools/read.js';
import {registerBuiltinToolIdentity,inheritBuiltinToolIdentity} from '../../src/ai/tools/native-tool-identity.js';
import {DesktopOwnedToolRegistry} from './desktop-multi-agent-catalog-bridge.js';
export const READONLY_AUDIT_FILES=Object.freeze([
 'desktop/electron/assistant-service.ts','desktop/electron/assistant-loop-executor.ts','desktop/electron/assistant-controller.ts',
 'desktop/electron/kswarm-health-loop.ts','desktop/electron/assistant-desktop-snapshot.ts','desktop/electron/kb-store-sqlite.ts',
 'desktop/electron/desktop-services.ts','desktop/electron/assistant-typed-ipc.ts','src/runtime/task-host/task-runtime-host.ts',
 'desktop/electron/completion-evidence-store.ts',
]);
export interface DesktopReadonlyAuditProfile {readonly opaqueDesktopReadonlyAuditProfile:never}
interface Identity {path:string;dev:number;ino:number;hash?:string}
interface State {root:string;dataRoot:string;workspace:string;configDir:string;identities:Identity[];files:Set<string>}
const profiles=new WeakMap<object,State>();
function deny():never{throw Error('readonly_audit_scope_denied');}
export function isReadonlyAuditChildPath(root:string,path:string){const target=resolve(path);if(!inside(root,target))return false;let current=target;while(!existsSync(current)&&current!==root)current=dirname(current);return current===root||(!lstatSync(current).isSymbolicLink()&&inside(root,realpathSync(current)));}
function inside(root:string,path:string){const rel=relative(root,path);return !!rel&&!rel.startsWith('..')&&!isAbsolute(rel);}
function identity(path:string,file=false):Identity{const stat=lstatSync(path);if(stat.isSymbolicLink()||realpathSync(path)!==path||(file?!stat.isFile():!stat.isDirectory()))deny();if(file&&stat.size>8*1024*1024)deny();return {path,dev:stat.dev,ino:stat.ino,...(file?{hash:createHash('sha256').update(readFileSync(path)).digest('hex')}:{})};}
function state(profile:DesktopReadonlyAuditProfile):State{const value=profile&&profiles.get(profile);if(!value)deny();for(const old of value.identities){const next=identity(old.path,old.hash!==undefined);if(next.dev!==old.dev||next.ino!==old.ino||next.hash!==old.hash)deny();}for(const name of ['config.json','config.json.bak']){const file=join(value.configDir,name);if(existsSync(file)&&!isReadonlyAuditChildPath(value.configDir,file))deny();}return value;}
/** Main-only factory; no JSON/string/boolean is an execution profile. */
export function createDesktopReadonlyAuditProfile(sessionRoot:string):DesktopReadonlyAuditProfile{
 const root=realpathSync(sessionRoot);if(!inside(realpathSync(tmpdir()),root))deny();
 if(!basename(root).startsWith('assistant-handoff-'))deny();
 const session=JSON.parse(readFileSync(join(root,'session.json'),'utf8'));
 const workspace=realpathSync(session.workspace),dataRoot=realpathSync(session.dataRoot),configDir=realpathSync(session.configDir);
 if(realpathSync(session.root)!==root||workspace!==join(root,'workspace')||dataRoot!==join(root,'data')||configDir!==join(root,'config'))deny();
 const identities=[root,workspace,dataRoot,configDir].map(path=>identity(path));
 const manifest=JSON.parse(readFileSync(join(root,'source-manifest.json'),'utf8')) as {path:string;sha256:string}[];
 if(!Array.isArray(manifest)||manifest.length!==READONLY_AUDIT_FILES.length||new Set(manifest.map(row=>row.path)).size!==manifest.length)deny();
 const files=new Set<string>();
 for(const name of READONLY_AUDIT_FILES){const row=manifest.find(row=>row.path===name);if(!row)deny();const path=join(workspace,name);let parent=dirname(path);while(parent!==workspace){if(!inside(workspace,parent))deny();identities.push(identity(parent));parent=dirname(parent);}const entry=identity(path,true);if(entry.hash!==row.sha256)deny();identities.push(entry);files.add(path);}
 const profile=Object.freeze(Object.create(null)) as DesktopReadonlyAuditProfile;profiles.set(profile,{root,workspace,dataRoot,configDir,identities,files});return profile;
}
export function assertDesktopReadonlyAudit(profile:DesktopReadonlyAuditProfile,input:{dataRoot:string;workspaceRoot?:string;permissionMode?:string;materials?:readonly unknown[];executionScope?:unknown}){
 const value=state(profile);
 if(realpathSync(input.dataRoot)!==value.dataRoot||!input.workspaceRoot||realpathSync(input.workspaceRoot)!==value.workspace)deny();
 if(Object.hasOwn(input,'permissionMode')&&input.permissionMode!=='default'||input.materials?.length||input.executionScope)deny();
 return {root:value.root,dataRoot:value.dataRoot,workspace:value.workspace,configDir:value.configDir};
}
/** Exact-file wrapper around the actual native read factory; no custom IO tool. */
export function createNativeReadonlyTools(profile:DesktopReadonlyAuditProfile):Tool[]{
 const value=state(profile),native=createReadTool({cwd:value.workspace,allowOutsideCwd:false});
 registerBuiltinToolIdentity(native,'readonly');
 const tool:Tool={permission:native.permission,definition:native.definition,async execute(input,context){const current=state(profile);if(typeof input.file_path!=='string')deny();const path=resolve(current.workspace,input.file_path);if(!current.files.has(path)||realpathSync(path)!==path)deny();context?.signal?.throwIfAborted();return native.execute({...input,file_path:path,max_chars:Math.min(typeof input.max_chars==='number'&&Number.isFinite(input.max_chars)&&input.max_chars>0?input.max_chars:12000,12000),limit:Math.min(typeof input.limit==='number'&&Number.isFinite(input.limit)&&input.limit>0?input.limit:200,200)},context);}};
 inheritBuiltinToolIdentity(native,tool,()=>{state(profile);return true;});
 return [tool];
}
/** Close the native population too: even another real builtin may be broader. */
export function createDesktopReadonlyAuditRegistry(profile:DesktopReadonlyAuditProfile){
 const tools=createNativeReadonlyTools(profile),owned=new Set(tools);
 class AuditRegistry extends DesktopOwnedToolRegistry {
  protected preflightToolRegistration(tool:Tool):void{if(!owned.has(tool))deny();super.preflightToolRegistration(tool);}
  forkForObservation():never{return deny();}
  forkForCompoundObservation():never{return deny();}
 }
 return {tools,registry:new AuditRegistry({nativeReadonlyOnly:true,autoMode:false},tools)};
}
