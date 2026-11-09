// @vitest-environment node
// Actual Service and private binding; fixed Native/Source ABI doubles grant no role.
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({services:{} as object,sources:{} as object,service:{} as object,lease:{} as object,port:{} as object,ksBound:false,ksClose:undefined as (()=>unknown)|undefined,events:[] as string[],child:undefined as any,entered:false,closed:false,fail:undefined as {raw:unknown}|undefined,frames:[] as unknown[],readyGate:undefined as (()=>void)|undefined}));
vi.mock('../../electron/main-dsh-kswarm-service-ports-loader.js',()=>({async loadOriginalKSwarmServicePorts(){return {
 readOriginalMainDshServicesBinding(services:object,sources:object){if(services!==f.services||sources!==f.sources)throw Error('actual tuple required');return {kswarmService:f.service,lease:f.lease};},
 prepareOriginalMainDshSourceBrokerChild(sources:object,lease:object){expect(sources).toBe(f.sources);expect(lease).toBe(f.lease);f.events.push('prepare');return f.port;},
};}}));
vi.mock('../../electron/broker-protected-child.js',()=>({
 async createOriginalProtectedBrokerChild(port:object){expect(port).toBe(f.port);f.entered=true;f.events.push('source-create');if(f.fail)throw f.fail.raw;return f.child;},
 async closeOriginalProtectedBrokerChild(port:object){expect(port).toBe(f.port);f.events.push('source-close');f.closed=true;f.child?.kill();},
 readOptionalOriginalProtectedBrokerChildPortFate(port:object){expect(port).toBe(f.port);return f.entered?Object.freeze({async waitPhysicalKnown(){if(!f.closed)throw Error('source held');},assertPhysicalKnown(){if(!f.closed)throw Error('source held');}}):null;},
}));
vi.mock('../../electron/kswarm-protected-service-binding.js',()=>({hasOriginalProtectedKSwarmService:()=>f.ksBound,createOriginalProtectedKSwarmServiceChild(){throw Error('unexpected KS prepare');},closeOriginalProtectedKSwarmService(){f.events.push('ks-source-close');return f.ksClose?.();}}));
class Child extends EventEmitter {
 pid=41521;connected=true;exitCode:number|null=null;signalCode=null;stdout=new EventEmitter();stderr=new EventEmitter();
 kill(){if(this.exitCode!==null)return false;this.exitCode=0;this.connected=false;this.emit('exit',0,null);this.emit('close',0,null);return true;}
 send(value:unknown){f.frames.push(value);f.events.push('frame');const ready=()=>this.emit('message',{kind:'original_broker_ready_v1',port:4318,pid:this.pid});if(f.readyGate)f.readyGate=ready;else queueMicrotask(ready);return true;}
}
let root:string,production:typeof import('../../electron/kswarm-service.js'),binding:typeof import('../../electron/broker-protected-service-binding.js');
let service:ReturnType<typeof import('../../electron/kswarm-service.js')['createKSwarmService']>|undefined;
beforeEach(async()=>{
 vi.resetModules();root=mkdtempSync(join(tmpdir(),'original-broker-service-'));mkdirSync(join(root,'config'),{mode:0o700});vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'config'));
 f.ksBound=false;f.ksClose=undefined;f.events=[];f.frames=[];f.services={};f.sources={};f.lease={};f.port=Object.freeze({});f.entered=false;f.closed=false;f.fail=undefined;f.readyGate=undefined;f.child=new Child();
 production=await import('../../electron/kswarm-service.js');binding=await import('../../electron/broker-protected-service-binding.js');
});
afterEach(async()=>{try{if(service)await production.sealAndDrainKSwarmServiceInstance(service);}catch{/* The original test preserves its assertions and first cause. */}service=undefined;vi.unstubAllEnvs();vi.unstubAllGlobals();rmSync(root,{recursive:true,force:true,maxRetries:3});});
async function setup(){
 const dir=join(root,'kswarm');mkdirSync(dir);writeFileSync(join(dir,'server.js'),'');writeFileSync(join(dir,'room-workspace-protocol.json'),JSON.stringify({component:'kswarm',protocols:{room_workspace_v1:{contextVersion:1,resultVersion:1,releaseVersion:1}}}));vi.stubEnv('KSWARM_SERVER_PATH',join(dir,'server.js'));
 const spawn=vi.fn(()=>{f.events.push('legacy-server-spawn');const child=new Child();child.pid=41522;return child;});
 const kill=vi.fn(async()=>true),find=vi.fn(async()=>null);let server=false;
 vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>{const url=String(input);if(url.includes(':4318/health')){f.events.push('broker-health');return new Response('{}');}if(url.includes(':4400/health'))return new Response('{}',{status:server?200:503});if(url.endsWith('/agents'))return new Response('{"agents":[]}');return new Response('{}');}));
 service=production.createKSwarmService({spawnProcess:((...args:unknown[])=>{server=true;return spawn(...args);}) as never,findPortOwner:find,killStalePortOwner:kill});f.service=service;
 await binding.bindOriginalMainDshBrokerService(f.services,f.sources);return {service,spawn,kill,find};
}
it('private tuple rejects foreign/copied/Proxy objects before preparation',async()=>{
 let hits=0;const proxy=new Proxy({},{get(){hits++;throw 0;},ownKeys(){hits++;throw 0;}});
 await expect(binding.bindOriginalMainDshBrokerService(proxy,f.sources)).rejects.toBeDefined();await expect(binding.bindOriginalMainDshBrokerService({},f.sources)).rejects.toBeDefined();expect(hits).toBe(0);expect(f.events).toEqual([]);
});
it.skipIf(process.platform!=='darwin')('healthy external HTTP never replaces the bound original Broker Source; frame is closed and sent once',async()=>{
 const {service,spawn,kill}=await setup();await service.start();
 expect(f.events.indexOf('source-create')).toBeLessThan(f.events.lastIndexOf('broker-health'));expect(f.frames).toHaveLength(1);
 const frame=f.frames[0] as {kind:string;environment:Record<string,string>};expect(frame.kind).toBe('original_broker_start_v1');expect(Object.keys(frame.environment).sort()).toEqual(['XIAOK_CONFIG_DIR','PORT','INTENT_BROKER_DB','INTENT_BROKER_SOCKET_PATH','INTENT_BROKER_DESKTOP_TOKEN','INTENT_BROKER_KSWARM_TOKEN'].sort());
 const cfg=frame.environment.XIAOK_CONFIG_DIR;expect(realpathSync(cfg)).toBe(cfg);expect(lstatSync(cfg).mode&0o777).toBe(0o700);expect(frame.environment.INTENT_BROKER_SOCKET_PATH).toBe('');expect(spawn).toHaveBeenCalledTimes(1);expect(kill).not.toHaveBeenCalled();
 await service.start();expect(f.frames).toHaveLength(1);await production.sealAndDrainKSwarmServiceInstance(service);expect(f.closed).toBe(true);binding.readOptionalOriginalProtectedBrokerServicePortFate(f.port)!.assertPhysicalKnown();
});
it.skipIf(process.platform!=='darwin')('failed original create never falls back to a listener or ordinary Broker spawn',async()=>{
 const {service,spawn}=await setup();f.fail={raw:undefined};await expect(service.start()).rejects.toBeUndefined();expect(spawn).not.toHaveBeenCalled();expect(f.events.filter(v=>v==='source-create')).toHaveLength(1);
 await service.start().catch(()=>{});expect(f.events.filter(v=>v==='source-create')).toHaveLength(1);await production.sealAndDrainKSwarmServiceInstance(service).catch(()=>{});expect(f.events).toContain('source-close');
});
it.skipIf(process.platform!=='darwin')('closing while ready is pending reaches Source close before waiting for startup',async()=>{
 const {service}=await setup();f.readyGate=()=>{};const starting=service.start();let done=false;void starting.catch(()=>{done=true;});for(let i=0;i<80;i++)await Promise.resolve();
 expect(f.frames).toHaveLength(1);await production.sealAndDrainKSwarmServiceInstance(service).catch(()=>{});await starting.catch(()=>{});expect(f.events).toContain('source-close');expect(done).toBe(true);
});
it('startup data never executes Proxy or accessor messages',async()=>{
 const {readOriginalBrokerReadyMessage}=await import('../../electron/broker-protected-startup-data.js');let hits=0;
 expect(()=>readOriginalBrokerReadyMessage(new Proxy({},{ownKeys(){hits++;throw 0;}}))).toThrow();expect(()=>readOriginalBrokerReadyMessage({get kind(){hits++;return 'original_broker_ready_v1';},port:4318,pid:1})).toThrow();expect(hits).toBe(0);
});

it.skipIf(process.platform!=='darwin')('a held KS Source close does not postpone the original Broker close',async()=>{
 const {service}=await setup();await service.start();let release!:()=>void;const hold=new Promise<void>(yes=>{release=yes;});f.ksBound=true;f.ksClose=()=>hold;
 const closing=production.sealAndDrainKSwarmServiceInstance(service);for(let i=0;i<120;i++)await Promise.resolve();
 try{expect(f.events).toContain('source-close');}finally{release();await closing;}
});
it.skipIf(process.platform!=='darwin')('successful stop then start never reuses an already closed protected readiness Promise',async()=>{
 const {service,spawn}=await setup();await service.start();await service.stop();await expect(service.start()).rejects.toBeDefined();expect(f.events.filter(v=>v==='source-create')).toHaveLength(1);expect(spawn).toHaveBeenCalledTimes(1);
});
it.skipIf(process.platform!=='darwin')('the actual Broker restart sibling cannot report success for its consumed Native port',async()=>{
 const {service}=await setup();await service.start();await expect(service.restartRelatedService('intent-broker')).rejects.toBeDefined();expect(f.events.filter(v=>v==='source-create')).toHaveLength(1);
});
