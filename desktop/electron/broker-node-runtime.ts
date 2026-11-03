import {createHash} from 'node:crypto';
import {closeSync,fstatSync,lstatSync,openSync,readFileSync,readSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import runtimeLock from '../resources/broker-runtime-lock.json' with {type:'json'};

export interface BrokerNodeRuntime {
  command:string;
  env:NodeJS.ProcessEnv;
  expected:{node:string;sqlite:string;executableSha256:string};
}
const blockedRuntimeEnv=new Set(['XIAOK_NODE_CMD','NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE']);
const verified=new Map<string,{fingerprint:string;sha:string}>();
const samePath=(a:string,b:string,platform=process.platform)=>platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
function regular(path:string) {
  const info=lstatSync(path,{bigint:true});
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw Error('broker_runtime_alias');
  return info;
}
export function resolvePackagedBrokerRuntime(options:{
  isPackaged:boolean;resourcesPath:string;platform?:NodeJS.Platform;arch?:string;env?:NodeJS.ProcessEnv;
}):BrokerNodeRuntime|null {
  if(!options.isPackaged)return null;
  const target=(options.platform??process.platform)+'-'+(options.arch??process.arch);
  const entry=runtimeLock.targets[target as keyof typeof runtimeLock.targets];
  // Other existing app targets keep their legacy runtime and are not WAL-qualified.
  if(!entry)return null;
  const root=realpathSync(options.resourcesPath);
  let dir=root;
  for(const name of ['services','intent-broker','runtime',target]) {
    dir=join(dir,name);const stat=lstatSync(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('broker_runtime_alias');
  }
  const manifestPath=join(dir,'manifest.json');
  if(regular(manifestPath).size>8192n)throw Error('broker_runtime_manifest');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(manifest.schema!=='xiaok-broker-runtime/v1'||manifest.target!==target||manifest.node!==runtimeLock.node||manifest.sqlite!==runtimeLock.sqlite||manifest.executable!==entry.executable||manifest.archiveSha256!==entry.archiveSha256||!/^[a-f0-9]{64}$/.test(manifest.executableSha256))throw Error('broker_runtime_manifest');
  const command=join(dir,entry.executable),info=regular(command);
  const fingerprint=[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
  let cached=verified.get(command);
  if(cached?.fingerprint!==fingerprint) {
    const fd=openSync(command,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1048576);
    try {
      const opened=fstatSync(fd,{bigint:true});
      if(opened.ino!==info.ino||opened.dev!==info.dev)throw Error('broker_runtime_identity');
      let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));
      const after=regular(command);
      if(after.ino!==info.ino||after.dev!==info.dev||after.ctimeNs!==info.ctimeNs||after.size!==info.size)throw Error('broker_runtime_identity');
      cached={fingerprint,sha:hash.digest('hex')};verified.set(command,cached);
    }finally{closeSync(fd);}
  }
  if(cached!.sha!==manifest.executableSha256)throw Error('broker_runtime_digest');
  const env={...(options.env??process.env)};
  for(const name of Object.keys(env))if(blockedRuntimeEnv.has(name.toUpperCase()))delete env[name];
  return {command,env,expected:{node:runtimeLock.node,sqlite:runtimeLock.sqlite,executableSha256:manifest.executableSha256}};
}
export function brokerRuntimeMatchesHealth(body:Record<string,unknown>|null,runtime:BrokerNodeRuntime):boolean {
  const service=body?.service as Record<string,unknown>|undefined;
  const actual=service?.runtime as Record<string,unknown>|undefined;
  return actual?.node===runtime.expected.node&&actual.sqlite===runtime.expected.sqlite&&actual.executableSha256===runtime.expected.executableSha256
    &&typeof actual.execPath==='string'&&samePath(actual.execPath,runtime.command);
}
