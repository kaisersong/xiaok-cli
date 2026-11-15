import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const policies=new Set<PackagePolicy>();
interface PackagePolicy {
 resolveNodeChildPackage(resources:string,env:NodeJS.ProcessEnv):NodeChildRuntime;
 mapNodeChildPath(resources:string,entry:string):string;
 sanitizeRuntimeEnv(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv;
 assertRuntimeFileReadsKnown():void;
}
export interface NodeChildRuntime {command:string;env:Record<string,string>;argsPrefix:readonly string[]}
function packagedResources():string|undefined {
 const resources=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath;
 if(!resources)return undefined;
 if(process.versions.electron){
  const electron=require('electron') as {app?:{isPackaged?:boolean}};
  return electron.app?.isPackaged===true?resources:undefined;
 }
 // A descendant must be running the actual fixed physical runtime closure
 // with the fixed preloader, not just possess an inherited path variable.
 const own=fileURLToPath(import.meta.url);
 const expected=join(resources,'node-child','app','dist','main','src','runtime','node-child-runtime.js');
 const bootstrap=pathToFileURL(join(resources,'node-child','bootstrap.mjs')).href;
 return resolve(own)===resolve(expected)&&process.execArgv.some((arg,index)=>arg==='--import'&&process.execArgv[index+1]===bootstrap)?resources:undefined;
}
function policy(resources:string):PackagePolicy {
 const app=process.versions.electron?'app.asar':join('node-child','app');
 const loaded=require(join(resources,app,'dist','main','desktop','electron','node-child-package.cjs')) as PackagePolicy;
 policies.add(loaded);return loaded;
}
/** Launch configuration only. Original parent/IPC/source qualification is separate. */
export function resolveNodeChildRuntime(env:NodeJS.ProcessEnv=process.env,developmentOverride=false):NodeChildRuntime {
 const resources=packagedResources();
 if(resources)return policy(resources).resolveNodeChildPackage(resources,env);
 const copy=Object.fromEntries(Object.entries(env).filter((item):item is [string,string]=>typeof item[1]==='string'));
 const explicit=developmentOverride?env.XIAOK_NODE_CMD?.trim():undefined;
 return {command:explicit||process.execPath,argsPrefix:[],env:{...copy,...(!explicit&&process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})}};
}
export function nodeChildPath(entry:string):string {
 const resources=packagedResources();return resources?policy(resources).mapNodeChildPath(resources,entry):entry;
}
export function nodeChildArgs(runtime:NodeChildRuntime,args:readonly string[]):string[]{return [...runtime.argsPrefix,...args.map(nodeChildPath)];}

/** A failed close stays unknown; shutdown must not certify that inventory closed. */
export function assertNodeChildRuntimeFilesKnown():void {for(const loaded of policies)loaded.assertRuntimeFileReadsKnown();}
