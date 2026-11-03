import {it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const electron=vi.hoisted(()=>({app:{isPackaged:true,getPath:(_name:string)=>''}}));
vi.mock('electron',()=>electron);
import {createKSwarmService} from '../../electron/kswarm-service.js';
class Child extends EventEmitter{
 pid:number;stdout=new EventEmitter();stderr=new EventEmitter();
 constructor(pid:number){super();this.pid=pid;}
 kill(signal?:string){queueMicrotask(()=>this.emit('exit',0,signal??null));return true;}
}
function setup(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'broker-owner-runtime-'))),resources=join(root,'resources'),target=process.platform+'-'+process.arch;
 if(!['darwin-arm64','win32-x64'].includes(target))return null;
 const runtime=join(resources,'services','intent-broker','runtime',target);mkdirSync(runtime,{recursive:true});
 const name=process.platform==='win32'?'node.exe':'node',command=join(runtime,name),bytes=Buffer.from('qualified owner test runtime'),sha=createHash('sha256').update(bytes).digest('hex');
 writeFileSync(command,bytes);writeFileSync(join(runtime,'manifest.json'),JSON.stringify({schema:'xiaok-broker-runtime/v1',node:'24.19.0',sqlite:'3.53.3',target,executable:name,executableSha256:sha,archiveSha256:process.platform==='win32'?'57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73':'8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d'}));
 const broker=join(root,'broker','src','cli.js'),ks=join(root,'kswarm','src','server','index.js');
 for(const path of [broker,ks]){mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'// owner fixture');}
 return {root,resources,command,sha,broker,ks};
}
const qualifiedTarget=['darwin-arm64','win32-x64'].includes(process.platform+'-'+process.arch);
for(const old of [false,true])it.skipIf(!qualifiedTarget)(old?'preserves an existing unqualified broker without adopting/killing/spawning it':'both real child owners select the same trusted broker runtime while KSwarm keeps its runtime',async()=>{
 const f=setup();if(!f)return;
 const descriptor=Object.getOwnPropertyDescriptor(process,'resourcesPath');Object.defineProperty(process,'resourcesPath',{value:f.resources,configurable:true});
 electron.app.getPath=()=>join(f.root,'userData');
 for(const [key,value] of Object.entries({XIAOK_CONFIG_DIR:f.root,BROKER_SERVER_PATH:f.broker,KSWARM_SERVER_PATH:f.ks,XIAOK_CONVERSATION_ACTIVITY:'0',XIAOK_NODE_CMD:'/ignored-broker-override'}))vi.stubEnv(key,value);
 const launched=new Set<string>(),spawn=vi.fn((command:string,args:string[],options:any)=>{const name=args.includes(f.broker)?'broker':'kswarm';launched.add(name);return new Child(75000+launched.size);});
 vi.stubGlobal('fetch',vi.fn(async(input:any)=>{
  const url=new URL(String(input)),name=url.port==='4318'?'broker':'kswarm',healthy=old||launched.has(name);
  return new Response(JSON.stringify({ok:true,features:['dynamic_workflows'],agents:[],service:{entryPath:name==='broker'?f.broker:f.ks,runtime:{node:old?'22.22.1':'24.19.0',sqlite:old?'3.51.2':'3.53.3',execPath:f.command,executableSha256:f.sha}}}),{status:url.pathname==='/health'&&!healthy?503:200});
 }));
 const service=createKSwarmService({spawnProcess:spawn as never,findPortOwner:async()=>null});
 try{
  await service.start();
  if(old){expect(spawn.mock.calls.filter(([,args])=>args.includes(f.broker))).toHaveLength(0);expect(service.getStatus().lastError).toContain('intent-broker');}
  else{
   const direct=spawn.mock.calls.find(([,args])=>args.includes(f.broker))!;
   expect(direct[0]).toBe(f.command);expect(direct[2].env.XIAOK_NODE_CMD).toBeUndefined();expect(direct[2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
   expect(spawn.mock.calls.find(([,args])=>args.includes(f.ks))![0]).toBe('/ignored-broker-override');
   const config=await service.activityOwnerConfig!(),managed=config.managedSources!.find(source=>source.name==='broker')!;
   expect(managed.executable).toBe(f.command);expect(managed.expectedHealth).toMatchObject({'service.runtime.node':'24.19.0','service.runtime.sqlite':'3.53.3','service.runtime.executableSha256':f.sha});
  }
 }finally{
  await service.stop();vi.unstubAllGlobals();vi.unstubAllEnvs();
  if(descriptor)Object.defineProperty(process,'resourcesPath',descriptor);else Reflect.deleteProperty(process,'resourcesPath');rmSync(f.root,{recursive:true,force:true});
 }
});
