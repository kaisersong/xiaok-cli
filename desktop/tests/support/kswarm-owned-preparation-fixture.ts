// Original fixture body extracted without changing its controlled child/protocol behavior.
import {expect,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as original from '../../electron/kswarm-service.js';
export const scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},services:original.KSwarmService[]=[];
export const cleanups:Array<()=>Promise<void>>=[];
export async function childFixture(userEnabled:boolean,beforeStart?:(source:any)=>void){
 const root=mkdtempSync(join(tmpdir(),'dsh-service-preparation-')),entry=resolve('../../kswarm/test/fixtures/owned-preparation-family/entry.js');
 let healthy=false,child:ChildProcess|undefined,output='',closed:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined,ready:any,observer:((cut:unknown)=>void)|undefined,ackRelease:(()=>void)|undefined,sourceClosed=false,cut=false;
 const proof=Object.freeze({}),custody=Object.freeze(Object.create(null)),signal=new AbortController(),frames:any[]=[],userProofs=new WeakMap<object,{operation:string;input:unknown}>();
 let service:original.KSwarmService;
 const preparationSource={resolveWork(this:unknown,candidate:object,audience:any){if(this!==preparationSource)throw Error('original_source_receiver_required');if(candidate!==proof||audience.serviceOwner!==service||audience.projectId!=='p'||sourceClosed)throw Error('controlled_original_preparation_required');return{workId:'d'.repeat(64),sourceIncarnation:'f'.repeat(64),custody};},observeWork(this:unknown,value:object,callback:(cut:unknown)=>void){if(this!==preparationSource)throw Error('original_source_receiver_required');if(value!==custody)throw Error('controlled_custody_required');observer=callback;},sealWork(this:unknown,value:object){if(this!==preparationSource)throw Error('original_source_receiver_required');if(value!==custody)throw Error('controlled_custody_required');sourceClosed=true;/* Accepted future ACK still belongs to this controlled Source. */}};
 const admission=(candidate:object,audience:any)=>{if(candidate!==proof||audience.serviceOwner!==service||audience.projectId!=='p')throw Error('controlled_original_preparation_required');if(sourceClosed&&audience.operation!=='read_prepare_call'&&audience.operation!=='ack_prepared')throw Error('controlled_preparation_closed');};
 const userAdmission=(candidate:object,audience:any)=>{const row=userProofs.get(candidate);if(!row||audience.serviceOwner!==service||audience.operation!==row.operation||JSON.stringify(audience.input)!==JSON.stringify(row.input))throw Error('controlled_user_required');};
 vi.stubEnv('KSWARM_SERVER_PATH',entry);
 vi.stubGlobal('fetch',vi.fn(async(input:unknown)=>{const url=String(input);if(url.includes(':4400/health'))return new Response(JSON.stringify({ok:healthy,features:['dynamic_workflows'],service:{entryPath:entry,sourceHash:original.computeKSwarmServiceSourceHash(entry)}}),{status:healthy?200:503});if(url.endsWith('/execution-start-admission'))return new Response(JSON.stringify({ok:true,protocol:'ordinary_project_execution_start_read_v1',projectId:'p',classification:'legacy_ordinary',bindingDigest:null,scope}));if(url.endsWith('/agents'))return new Response(JSON.stringify({agents:[]}));return new Response(JSON.stringify({ok:true}));}));
 service=original.createKSwarmService({desktopProjectScope:scope,ownedPreparationSource:preparationSource,ownedPreparationAdmission:admission,...(userEnabled?{ownedBusinessAdmission:userAdmission}:{}),findPortOwner:async()=>null,spawnProcess:((_command,_args,options)=>{
  if(child)throw Error('fixture must retain a single child');
  // This fixture adapter closes the existing original endpoint through its
  // own stdin control after the service has drained the business prefix.
  const adapter="process.on('SIGTERM',()=>process.stdin.emit('data',Buffer.from('release\\nclose\\n')));await import("+JSON.stringify(pathToFileURL(entry).href)+");";
  child=spawn(process.execPath,['--input-type=module','-e',adapter],{...options,stdio:['pipe','pipe','pipe','ipc'],env:{...options?.env,PREPARATION_FAMILY_FIXTURE_ROOT:root,ELECTRON_RUN_AS_NODE:'1'}});
  closed=new Promise(yes=>child!.once('close',(code,signal)=>{healthy=false;yes({code,signal});}));child.stdout!.on('data',chunk=>{output+=String(chunk);});child.stderr!.on('data',chunk=>{output+=String(chunk);});
  child.on('message',(message:any)=>{if(message.protocol==='fixture_ready'){ready=message;healthy=true;}});
  const send=child.send!.bind(child);Object.defineProperty(child,'send',{value:(frame:any,callback:any)=>{frames.push(frame);return send(frame,error=>{if(frame.op==='ack_prepared')ackRelease=()=>callback(error);else callback(error);});}});return child;
 }) as typeof spawn});
 cleanups.push(async()=>{ackRelease?.();if(!cut){observer?.({disposition:'no_ack'});cut=true;}child?.stdin?.write('release\n');await original.sealAndDrainKSwarmServiceInstance(service);const result=await closed!;console.log(JSON.stringify({fixture:'service-preparation-original-child',pid:child?.pid,...result,reaped:true,notNativeQualification:true,notWholeResourceDrain:true}));expect(result.code,output).toBe(0);expect(result.signal).toBe(null);rmSync(root,{recursive:true,force:true,maxRetries:5});});
 beforeStart?.(preparationSource);await service.start();expect(ready,output).toBeDefined();
 const facet=original.getKSwarmOwnedPreparationTransport(service,preparationSource,admission),context={requestSource:'scheduler' as const,preparationProof:proof,signal:signal.signal};
 return{root,service,source:preparationSource,admission,userAdmission,frames,ready,facet,context,open(lookup:any){return facet.openWork('p',lookup,context);},user(operation:string,input:unknown=null){const admission=Object.freeze({});userProofs.set(admission,{operation,input});return{requestSource:'user' as const,admission,signal:signal.signal};},noAck(){observer!({disposition:'no_ack'});cut=true;},cut(){observer!({disposition:'ack_registered'});cut=true;},release(){child!.stdin!.write('release\n');ackRelease?.();},get ackHeld(){return !!ackRelease;},get child(){return child!;}};
}
