import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ACTIVITY_STORAGE_NAMES} from '../../../src/runtime/conversation-activity/storage-permissions.js';
export const writerScope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
export const configProtocol='activity_desktop_config_v1';
async function port(){const server=createServer();await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));const value=(server.address() as {port:number}).port;await new Promise<void>((yes,no)=>server.close(error=>error?no(error):yes()));return value;}
async function birth(pid:number):Promise<string>{return new Promise((yes,no)=>execFile(process.platform==='win32'?'powershell.exe':'/bin/ps',process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]:['-p',String(pid),'-o','lstart='],{timeout:3000},(error,stdout)=>error?no(error):yes(stdout.trim())));}
export async function ownedConfigDaemonFixture(register:(close:()=>Promise<void>)=>void,options:{daemonEnv?:Record<string,string>;daemonPreload?:string;ksPreload?:string;scope?:typeof writerScope;seedDispatch?:boolean;seedRuntime?:boolean}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'cd-'))),identity=join(root,'groups.sqlite'),store=new DesktopMultiAgentStore(identity);store.close();const scope=options.scope??writerScope,ksPort=await port(),brokerPort=await port(),ksData=join(root,'ks'),brokerData=join(root,'broker');mkdirSync(brokerData);mkdirSync(ksData);
 const brokerConfig=join(brokerData,'broker.json');writeFileSync(brokerConfig,JSON.stringify({server:{host:'127.0.0.1',port:brokerPort,dbPath:join(brokerData,'state.sqlite')},channels:{},relay:{enabled:false}}),{mode:0o600});
 const diagnostic=resolve('tests/e2e/fixtures/owned-config-sidecar-diagnostic.cjs');
 const ksEntry=resolve('../../kswarm/src/server/index.js'),brokerEntry=resolve('../../intent-broker/src/cli.js'),entry=resolve('dist/main/src/runtime/conversation-activity/owner-entry.js'),mutationToken='fixture-owned-mutation',roomToken='fixture-owned-room',ksRoomToken='fixture-owned-ks-room';
 const operational:NodeJS.ProcessEnv={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','windir','ComSpec','PATHEXT','TMPDIR','TEMP','TMP','LANG','TZ'])if(process.env[key])operational[key]=process.env[key];
 const isolated={...operational,HOME:root,USERPROFILE:root,APPDATA:join(root,'appdata'),LOCALAPPDATA:join(root,'localappdata')};
 if(options.seedDispatch){
  const seedEntry=resolve('../../kswarm/test/fixtures/owned-default-dispatch-business/service-entry.js'),seed=spawn(process.execPath,[seedEntry],{env:{...isolated,DISPATCH_BUSINESS_TEST_ROOT:ksData,...(options.seedRuntime?{DISPATCH_BUSINESS_TEST_RUNTIME6:'1'}:{})},stdio:['ignore','pipe','pipe','ipc']});
  let output='',done=false;seed.stdout!.on('data',chunk=>{output+=chunk;});seed.stderr!.on('data',chunk=>{output+=chunk;});const closed=new Promise<number|null>(yes=>seed.once('close',code=>{done=true;yes(code);}));
  register(async()=>{if(!done){seed.kill('SIGTERM');const timer=setTimeout(()=>{if(!done)seed.kill('SIGKILL');},2000);try{await closed;}finally{clearTimeout(timer);}}rmSync(root,{recursive:true,force:true});});
  for(let n=0;!output.includes('OWNED_BUSINESS_SERVICE_READY')&&n<1000;n++){if(done)throw Error('dispatch seed failed: '+output);await delay(5);}
  if(!output.includes('OWNED_BUSINESS_SERVICE_READY'))throw Error('dispatch seed timeout: '+output);seed.kill('SIGTERM');const code=await closed;console.log(JSON.stringify({test:'canonical-business-seed',pid:seed.pid,code,reaped:true,notNativeMainProof:true}));if(code!==0)throw Error('dispatch seed close failed: '+output);
 }
 const expected=(file:string)=>({ok:true,'service.entryPath':file,'service.entryHash':createHash('sha256').update(readFileSync(file)).digest('hex')});
 const config={schemaVersion:1,dataRoot:root,profileId:'owned-config-fixture',actorId:'desktop-user:owned-config-fixture',identity:{kind:'desktop',path:identity},kswarm:{url:`http://127.0.0.1:${ksPort}`,mutationToken,brokerUrl:`http://127.0.0.1:${brokerPort}`,roomToken},managedSources:[
  {name:'broker',executable:process.execPath,entryPath:brokerEntry,args:['--require',diagnostic,brokerEntry],cwd:brokerData,env:{PORT:String(brokerPort),INTENT_BROKER_CONFIG:brokerConfig,INTENT_BROKER_LOCAL_CONFIG:join(brokerData,'empty-local.json'),INTENT_BROKER_DB:join(brokerData,'state.sqlite'),INTENT_BROKER_HEARTBEAT_PATH:join(brokerData,'heartbeat.json'),INTENT_BROKER_DESKTOP_TOKEN:roomToken,INTENT_BROKER_KSWARM_TOKEN:ksRoomToken},healthUrl:`http://127.0.0.1:${brokerPort}/health`,expectedHealth:expected(brokerEntry)},
  {name:'kswarm',executable:process.execPath,entryPath:ksEntry,args:['--require',diagnostic,...(options.ksPreload?['--require',options.ksPreload]:[]),ksEntry],cwd:dirname(dirname(dirname(ksEntry))),env:{KSWARM_DATA_ROOT:ksData,KSWARM_PORT:String(ksPort),BROKER_URL:`http://127.0.0.1:${brokerPort}`,KSWARM_DESKTOP_MUTATION_TOKEN:mutationToken,INTENT_BROKER_KSWARM_TOKEN:ksRoomToken,KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId},healthUrl:`http://127.0.0.1:${ksPort}/health`,expectedHealth:expected(ksEntry)},
 ]};
 let initializationSucceeded=false;
 const configFile=join(root,'owner.json');writeFileSync(configFile,JSON.stringify(config),{mode:0o600});const child=spawn(process.execPath,[...(options.daemonPreload?['--require',options.daemonPreload]:[]),entry,configFile],{env:{...isolated,...options.daemonEnv,CONTROL_CONFIG_ROOT:root},stdio:['ignore','pipe','pipe','ipc']});
 const frames:Record<string,unknown>[]=[];let stderr='',closedObserved=false;child.stdout.on('data',()=>{});child.stderr.on('data',data=>{stderr+=data;});child.on('message',frame=>frames.push(frame as Record<string,unknown>));const closed=new Promise<void>(yes=>child.once('close',(code,signal)=>{closedObserved=true;console.log(JSON.stringify({test:'owned-config-daemon',pid:child.pid,code,signal,reaped:true,notNativeMainProof:true}));yes();}));const client=new ConversationActivityOwnerClient(root,'producer');
 register(async()=>{
  const owned:{pid:number;birth:string;name:string}[]=[];const ledger=join(root,ACTIVITY_STORAGE_NAMES.supervision);if(existsSync(ledger)){const data=JSON.parse(readFileSync(ledger,'utf8'));for(const row of data.sources??[])if(!row.external&&row.pid>0&&['broker','kswarm'].includes(row.name))try{if(await birth(row.pid)===row.birth)owned.push(row);}catch{}}
  for(const file of existsSync(root)?readdirSync(root):[])if(/^sidecar-(broker|kswarm)-[0-9]+\.json$/.test(file))try{const row=JSON.parse(readFileSync(join(root,file),'utf8'));if(row.root===root&&row.entry===(row.name==='kswarm'?ksEntry:brokerEntry)&&row.pid>0&&!owned.some(item=>item.pid===row.pid)&&await birth(row.pid)===row.birth)owned.push(row);}catch{}
  for(const name of existsSync(root)?(await import('node:fs')).readdirSync(root):[])if(name.startsWith('held-'))writeFileSync(join(root,'release-'+name.slice(5).replace(/\.json$/,'')),'1');
  client.dispose();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await Promise.race([closed,delay(1500)]);if(!closedObserved){console.log(JSON.stringify({test:'owned-config-daemon-fixture-force',pid:child.pid,notProductionDrain:true}));child.kill('SIGKILL');await closed;}
  let signals=0;for(const row of owned)try{if(await birth(row.pid)!==row.birth)continue;process.kill(row.pid,'SIGTERM');signals++;for(let n=0;n<400;n++){try{process.kill(row.pid,0);}catch{break;}await delay(5);}try{if(await birth(row.pid)===row.birth){process.kill(row.pid,'SIGKILL');signals++;}}catch{}}catch{}
  console.log(JSON.stringify({test:'owned-config-sidecar-fixture-cleanup',owned:owned.map(row=>({pid:row.pid,name:row.name,birth:row.birth})),signals,notProductionClose:true,notWholeNativeDrain:true}));for(const file of readdirSync(root))if(/^sidecar-.*-stderr\.log$/.test(file)||!initializationSucceeded&&/^sidecar-.*-stdout\.log$/.test(file)){const text=readFileSync(join(root,file),'utf8');if(text)console.log(JSON.stringify({test:'owned-config-startup-diagnostic',file,text}));}rmSync(root,{recursive:true,force:true,maxRetries:3});
 });
 async function wait<T>(find:()=>T|undefined){for(let n=0;n<1500;n++){const found=find();if(found!==undefined)return found;if(child.exitCode!==null||child.signalCode!==null)throw Error('owned config daemon exited: '+stderr);await delay(5);}throw Error('owned config fixture timeout: '+stderr);}
 await wait(asyncUndefined);function asyncUndefined():true|undefined{return existsSync(join(root,ACTIVITY_STORAGE_NAMES.status))?true:undefined;}
 let ready=false;for(let n=0;n<1200;n++){try{if((await client.request<{ready:boolean}>('status')).ready){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(stderr);await delay(5);}if(!ready)throw Error('owned config ordinary runtime not ready '+stderr);
 const get=(type:string,id?:number)=>wait(()=>frames.find(row=>row.type===type&&(id===undefined||row.offerId===id)));
 const hello=await get('daemon_hello'),base={protocol:configProtocol,daemonBoot:hello.daemonBoot,ownerEpoch:hello.ownerEpoch,installChallenge:hello.installChallenge,mainLaunchNonce:'c'.repeat(64),scope};
 const send=(frame:Record<string,unknown>)=>child.send(frame);const floor=()=>{const db=new DatabaseSync(join(ksData,'state.sqlite'),{readOnly:true});try{return db.prepare("SELECT count(*) n FROM state_meta WHERE meta_key='writer_floor_v1'").get()?.n;}finally{db.close();}};
 async function install(){send({...base,type:'install'});return wait(()=>frames.find(frame=>['installed','install_unavailable','fault'].includes(String(frame.type))));}
 initializationSucceeded=true;return {root,child,closed,client,frames,hello,base,scope,get,send,wait,floor,install,session(installed:Record<string,unknown>){return {protocol:configProtocol,daemonBoot:hello.daemonBoot,ownerEpoch:hello.ownerEpoch,mainLaunchNonce:base.mainLaunchNonce,scope,configConnectionIncarnation:installed.configConnectionIncarnation};}};
}
