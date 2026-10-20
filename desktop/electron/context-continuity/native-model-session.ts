import fs from 'node:fs';
import path from 'node:path';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import type {Message,MessageBlock,ModelAdapter,StreamChunk,ToolDefinition} from '../../../src/types.js';
import type {StreamOptions} from '../../../src/ai/runtime/model-capabilities.js';
import {ContinuityStore,key,invalidateEffectOwner} from './store.js';
import {ContinuityService} from './service.js';
const originalTaskRead=ContinuityService.prototype.assertTaskReadable,originalCurrentExecution=ContinuityService.prototype.assertCurrentInputExecution;

// Clean-source, fresh-target native qualification; a normal/global binary and a
// caller-controlled artifact manifest cannot qualify this exact sampling engine.
const qualified={platform:'darwin',arch:'arm64',sha256:'1c97d028d609dd426763729484ef16a6996325113745f65e5dde39b910ba1538',restriction:'xiaok-main-bridge-v1'};
const ownedAdapters=new WeakSet<object>();
export const isOwnedNativeModelAdapter=(adapter:object):boolean=>ownedAdapters.has(adapter);
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const encoded=(value:unknown)=>JSON.stringify(value);
const NativePromise=Promise,then=Promise.prototype.then;
const failure=(code:string)=>Object.assign(new Error(code),{retryable:false,code});
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
interface Binding {taskId:string;sourceEpoch:string;executionEpoch:number;ownerSession:string;inputId:string}
interface Options {stateRoot:string;store:ContinuityStore;binding:Binding;model:string}
interface LaunchOptions extends Options {binary:string;home:string;testOnly:boolean;assertAdmission:()=>void}
interface Frame {id?:number|string;method?:string;params?:any;result?:any;error?:{code:number;message:string}}
interface PendingCall {id:number|string;callId:string;name:string;input:Record<string,unknown>;threadId:string;turnId:string}
const bridgeTools=[{type:'namespace',name:'xiaok',description:'Original Desktop main tools',tools:[{type:'function',name:'invoke',description:'Invoke one original Desktop tool by name. Cannot grant authority or change Harness.',inputSchema:{type:'object',properties:{name:{type:'string'},arguments:{type:'object'}},required:['name','arguments'],additionalProperties:false}}]}];
function privateDirectory(directory:string){const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||typeof process.getuid==='function'&&stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw failure('native_private_directory_unavailable');return stat;}
const identity=(stat:fs.Stats)=>`${stat.dev}:${stat.ino}`;
function normalize(messages:Message[]):Message[]{
 if(!Array.isArray(messages)||messages.length>4096)throw failure('native_history_changed');const result=structuredClone(messages);
 for(const message of result){if(!['user','assistant'].includes(message.role)||!Array.isArray(message.content))throw failure('native_history_changed');for(const block of message.content){if(block.type==='image')throw failure('native_images_unsupported');delete block.cache_control;}}
 if(Buffer.byteLength(encoded(result))>2*1024*1024)throw failure('native_history_limit');return result;
}
function publicMessages(messages:Message[]){for(const message of messages)if(message.content.some(block=>block.type!=='text'))throw failure('native_checkpoint_public_text_required');}

/** Main-only sampling/IO owner. Metadata from this module is never an effect
 * receipt. Actual tools continue through Desktop's original registry/TaskHost. */
class NativeModelSession {
 readonly adapter:ModelAdapter;
 #options:LaunchOptions;#binding:Binding;#resource=randomUUID();#workspace:string;#child!:ChildProcessWithoutNullStreams;
 #finished!:Promise<void>;#closing?:Promise<void>;#closed=false;#physicallyClosed=false;#drainConfirmed=false;#spawnAttempted=false;#error?:Error;
 #pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;sendId:string}>();
 #writes=new Set<Promise<void>>();#next=0;#sequence=0;#frames:Frame[]=[];#queuedBytes=0;#wake?:()=>void;
 #thread?:string;#turn?:string;#reading=false;#prefix:Message[]=[];#assistant:MessageBlock[]=[];#waiting?:PendingCall;#seenCalls=new Set<string>();#publicItems=new Map<string,string>();#publicBytes=0;#system?:string;#definitions?:ToolDefinition[];
 #directories=new Map<string,string>();#model:string;#testOnly:boolean;#admit:()=>void;#stderr="";
 constructor(options:LaunchOptions){
  this.#options=options;this.#binding=structuredClone(options.binding);this.#model=options.model;this.#testOnly=options.testOnly;this.#admit=options.assertAdmission;
  for(const value of [this.#binding.taskId,this.#binding.sourceEpoch,this.#binding.ownerSession,this.#binding.inputId,this.#model])key(value);
  if(!Number.isSafeInteger(this.#binding.executionEpoch)||this.#binding.executionEpoch<1)throw failure('native_execution_binding_unavailable');
  if(process.platform!==qualified.platform||process.arch!==qualified.arch)throw failure('native_platform_unqualified');
  const binary=fs.lstatSync(options.binary);
  if(!binary.isFile()||binary.isSymbolicLink()||path.basename(options.binary)!=='codex-app-server'||hash(fs.readFileSync(options.binary))!==qualified.sha256)throw failure('native_binary_unqualified');
  for(const directory of [options.stateRoot,options.home])this.#directories.set(directory,identity(privateDirectory(directory)));
  options.store.transaction(()=>{
   options.store.db.exec(`CREATE TABLE IF NOT EXISTS native_model_resources(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,source_epoch TEXT NOT NULL,owner_session TEXT NOT NULL,execution_epoch INTEGER NOT NULL,input_id TEXT NOT NULL,test_only INTEGER NOT NULL,status TEXT NOT NULL,pid INTEGER,thread_id TEXT,UNIQUE(task_id,source_epoch,owner_session));
    CREATE TABLE IF NOT EXISTS native_model_sends(id TEXT PRIMARY KEY,resource_id TEXT NOT NULL REFERENCES native_model_resources(id),sequence INTEGER NOT NULL,kind TEXT NOT NULL,payload_hash TEXT NOT NULL,envelope TEXT NOT NULL,status TEXT NOT NULL,association TEXT,UNIQUE(resource_id,sequence));`);
   if(options.store.db.prepare('SELECT 1 FROM native_model_resources WHERE task_id=? AND source_epoch=? AND owner_session=?').get(this.#binding.taskId,this.#binding.sourceEpoch,this.#binding.ownerSession))throw failure('native_activation_not_replayable');
   options.store.db.prepare("INSERT INTO native_model_resources VALUES (?,?,?,?,?,?,?,'launch_intent',NULL,NULL)").run(this.#resource,this.#binding.taskId,this.#binding.sourceEpoch,this.#binding.ownerSession,this.#binding.executionEpoch,this.#binding.inputId,this.#testOnly?1:0);
   invalidateEffectOwner(options.store,this.#binding.taskId,this.#resource,'native_sampling_worker',true);
  });
  this.#workspace=path.join(options.home,'workspace');fs.mkdirSync(this.#workspace,{mode:0o700});this.#directories.set(this.#workspace,identity(privateDirectory(this.#workspace)));
  this.adapter=Object.freeze({stream:(messages:Message[],tools:ToolDefinition[],system:string,streamOptions?:StreamOptions)=>this.#stream(messages,tools,system,streamOptions),getModelName:()=>this.#model,getCapabilities:()=>({supportsImageInput:false,supportsPromptCaching:false})});ownedAdapters.add(this.adapter);Object.freeze(this);
 }
 #assert(){if(this.#closed||this.#error)throw this.#error??failure('native_session_closed');if(this.#admit()!==undefined)throw failure('native_admission_must_be_synchronous');if(this.#closed||this.#error)throw this.#error??failure('native_session_closed');for(const [directory,original]of this.#directories)if(identity(privateDirectory(directory))!==original)throw failure('native_private_directory_changed');}
 #intent(kind:string,payload:unknown,text?:string){
  this.#assert();const id=randomUUID();
  // Private transport metadata is excluded from canonical text/search/history.
  const envelope={version:1,binding:this.#binding,resourceId:this.#resource,threadId:this.#thread??null,turnId:this.#turn??null,purpose:kind,...(text!==undefined?{textPayloadBytes:Buffer.byteLength(text),textPayloadHash:hash(text)}:{})};
  this.#options.store.transaction(()=>this.#options.store.db.prepare("INSERT INTO native_model_sends VALUES (?,?,?,?,?,?,'intent',NULL)").run(id,this.#resource,++this.#sequence,kind,hash(encoded(payload)),encoded(envelope)));return id;
 }
 #ack(id:string,association:unknown){this.#options.store.transaction(()=>{if(this.#options.store.db.prepare("UPDATE native_model_sends SET status=CASE WHEN kind='item/tool/result' THEN 'local_written' ELSE 'accepted' END,association=? WHERE id=? AND resource_id=? AND status='intent'").run(encoded(association),id,this.#resource).changes!==1)throw failure('native_send_unknown');});}
 #fail(error:unknown){
  if(this.#error)return;this.#error=error instanceof Error?error:failure('native_transport_failed');Object.assign(this.#error,{retryable:false});
  try{this.#options.store.db.prepare("UPDATE native_model_sends SET status='unknown' WHERE resource_id=? AND status='intent'").run(this.#resource);}catch{/* The already durable send intent remains unknown; do not block native drain. */}
  for(const request of this.#pending.values()){clearTimeout(request.timer);request.reject(this.#error);}this.#pending.clear();this.#wake?.();
 }
 #write(frame:Frame):Promise<void>{
  this.#assert();let resolve!:()=>void,reject!:(error:Error)=>void;const write=new Promise<void>((a,b)=>{resolve=a;reject=b;});this.#writes.add(write);
  const finish=(error?:Error|null)=>{try{if(error){this.#fail(error);reject(error);}else resolve();}finally{this.#writes.delete(write);}};
  try{this.#child.stdin.write(encoded(frame)+'\n',finish);}catch(error){finish(error as Error);}return write;
 }
 #request(method:string,params:Record<string,unknown>,text?:string):Promise<any>{
  this.#assert();const id=++this.#next,sendId=this.#intent(method,{id,method,params},text);this.#assert();
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.#fail(failure('native_ack_unknown'));void this.closeAndDrain().catch(()=>{});},15000);this.#pending.set(id,{resolve,reject,timer,sendId});try{void this.#write({id,method,params}).catch(error=>this.#fail(error));}catch(error){clearTimeout(timer);this.#pending.delete(id);this.#fail(error);reject(error);}});
 }
 #receive(frame:Frame){
  if(!record(frame))throw failure('native_protocol_invalid');
  if(!frame.method){const request=typeof frame.id==='number'?this.#pending.get(frame.id):undefined;if(!request)throw failure('native_response_unbound');clearTimeout(request.timer);this.#pending.delete(frame.id as number);
   if(frame.error){this.#fail(failure('native_request_rejected'));request.reject(this.#error!);return;}
   try{this.#ack(request.sendId,frame.result);request.resolve(frame.result);}catch(error){this.#fail(error);request.reject(this.#error!);}return;}
  if(frame.id!==undefined&&frame.method!=='item/tool/call')throw failure('native_server_request_forbidden');
  // Reasoning and internal notifications never become public assistant text.
  if(!['item/tool/call','item/agentMessage/delta','item/completed','turn/completed','error'].includes(frame.method))return;
  const size=Buffer.byteLength(encoded(frame));if(this.#frames.length>=256||this.#queuedBytes+size>2*1024*1024)throw failure('native_protocol_queue_limit');this.#frames.push(frame);this.#queuedBytes+=size;this.#wake?.();
 }
 async connect(){
  this.#assert();this.#spawnAttempted=true;this.#child=spawn(this.#options.binary,['--strict-config'],{cwd:this.#workspace,env:{PATH:[path.dirname(process.execPath),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter),LANG:'en_US.UTF-8',CODEX_HOME:this.#options.home,XIAOK_NATIVE_ISOLATED_V1:'1'},stdio:['pipe','pipe','pipe'],detached:true});
  this.#finished=new Promise(resolve=>this.#child.once('close',()=>{this.#physicallyClosed=true;this.#fail(failure(this.#testOnly?'native_worker_closed: '+this.#stderr:'native_worker_closed'));resolve();}));this.#child.on('error',error=>this.#fail(error));this.#child.stdin.on('error',error=>this.#fail(error));this.#child.stderr.on('data',bytes=>{if(this.#stderr.length<4096)this.#stderr+=bytes.toString();});
  this.#options.store.db.prepare("UPDATE native_model_resources SET status='running',pid=? WHERE id=?").run(this.#child.pid??null,this.#resource);
  let buffer=Buffer.alloc(0);const decoder=new TextDecoder('utf-8',{fatal:true});
  this.#child.stdout.on('data',bytes=>{if(this.#closed||this.#error)return;try{buffer=Buffer.concat([buffer,bytes]);let end;while((end=buffer.indexOf(10))>=0){if(end>1024*1024)throw failure('native_protocol_frame_limit');const line=decoder.decode(buffer.subarray(0,end));buffer=buffer.subarray(end+1);if(line.trim())this.#receive(JSON.parse(line));}if(buffer.length>1024*1024)throw failure('native_protocol_frame_limit');}catch(error){this.#fail(error);void this.closeAndDrain().catch(()=>{});}});
  const initialized=await this.#request('initialize',{clientInfo:{name:'xiaok-desktop-main',version:'1'},capabilities:{experimentalApi:true}});
  if(typeof initialized?.userAgent!=='string'||!initialized.userAgent.split(/[;\s]+/).includes(qualified.restriction))throw failure('native_restriction_marker_missing');await this.#write({method:'initialized'});
  const started=await this.#request('thread/start',{model:this.#model,ephemeral:true,environments:[],dynamicTools:structuredClone(bridgeTools)});if(typeof started?.thread?.id!=='string'||!started.thread.id)throw failure('native_thread_unknown');this.#thread=started.thread.id;this.#options.store.db.prepare('UPDATE native_model_resources SET thread_id=? WHERE id=?').run(this.#thread!,this.#resource);
 }
 async #nextFrame(signal?:AbortSignal):Promise<Frame>{for(;;){this.#assert();signal?.throwIfAborted();const frame=this.#frames.shift();if(frame){this.#queuedBytes-=Buffer.byteLength(encoded(frame));return frame;}
  await new Promise<void>((resolve,reject)=>{const wake=()=>{signal?.removeEventListener('abort',abort);this.#wake=undefined;resolve();};const abort=()=>{this.#wake=undefined;reject(signal!.reason);};this.#wake=wake;signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}}
 #appendText(text:string){this.#publicBytes+=Buffer.byteLength(text);if(this.#publicBytes>4*1024*1024||this.#publicItems.size>4096)throw failure('native_public_text_limit');const last=this.#assistant.at(-1);if(last?.type==='text')last.text+=text;else this.#assistant.push({type:'text',text});}
 async #sendText(text:string){
  if(!text)throw failure('native_empty_work_forbidden');const params={threadId:this.#thread,...(this.#turn?{expectedTurnId:this.#turn}:{}),input:[{type:'text',text,text_elements:[]}]};const result=await this.#request(this.#turn?'turn/steer':'turn/start',params,text);this.#assert();const turnId=this.#turn?result?.turnId:result?.turn?.id;if(typeof turnId!=='string'||!turnId||this.#turn&&turnId!==this.#turn)throw failure('native_turn_unknown');this.#turn=turnId;
 }
 async *#stream(messages:Message[],tools:ToolDefinition[],system:string,options?:StreamOptions):AsyncGenerator<StreamChunk>{
  this.#assert();if(this.#reading)throw failure('native_stream_busy');this.#reading=true;const aborted=()=>{this.#fail(failure('native_work_interrupted'));void this.closeAndDrain().catch(()=>{});};options?.signal?.addEventListener('abort',aborted,{once:true});
  try{options?.signal?.throwIfAborted();const current=normalize(messages),definitions=structuredClone(tools);if(!Array.isArray(definitions)||definitions.length>256||new Set(definitions.map(tool=>tool.name)).size!==definitions.length||typeof system!=='string')throw failure('native_tools_invalid');const allowed=new Set(definitions.map(tool=>tool.name));
   if(this.#system!==undefined&&(system!==this.#system||definitions.some(tool=>!this.#definitions?.some(original=>encoded(original)===encoded(tool)))))throw failure('native_instructions_changed');
   if(this.#system===undefined){this.#system=system;this.#definitions=definitions;}
   if(!this.#prefix.length){publicMessages(current);if(!current.length)throw failure('native_empty_work_forbidden');await this.#sendText(encoded({format:'xiaok-main-public-checkpoint-v1',system,tools:definitions,messages:current}));}
   else{
    if(encoded(current.slice(0,this.#prefix.length))!==encoded(this.#prefix))throw failure('native_history_changed');const tail=current.slice(this.#prefix.length),assistant=tail.shift();if(!assistant||assistant.role!=='assistant'||encoded(assistant.content)!==encoded(this.#assistant))throw failure('native_history_changed');
    const extra:Message[]=[];let result:Extract<MessageBlock,{type:'tool_result'}>|undefined;
    for(const message of tail){if(message.role!=='user')throw failure('native_history_changed');const text:MessageBlock[]=[];for(const block of message.content){if(block.type==='tool_result'&&this.#waiting&&block.tool_use_id===this.#waiting.callId&&!result)result=block;else if(block.type==='text')text.push(block);else throw failure('native_history_changed');}if(text.length)extra.push({role:'user',content:text});}
    if(this.#waiting&&!result||!this.#waiting&&result)throw failure('native_result_unbound');if(extra.length)await this.#sendText(encoded({format:'xiaok-main-additional-input-v1',messages:extra}));
    if(this.#waiting){const call=this.#waiting;this.#waiting=undefined;const response={id:call.id,result:{success:!result!.is_error,contentItems:[{type:'inputText',text:result!.content}]}};const sendId=this.#intent('item/tool/result',response);await this.#write(response);this.#ack(sendId,{threadId:call.threadId,turnId:call.turnId,callId:call.callId,localWriteOnly:true});}else if(!extra.length)throw failure('native_empty_work_forbidden');
   }
   this.#prefix=current;this.#assistant=[];
   for(;;){const frame=await this.#nextFrame(options?.signal);this.#assert();options?.signal?.throwIfAborted();const p=frame.params;if(frame.method==='error')throw failure('native_model_error');if(!record(p)||p.threadId!==this.#thread)throw failure('native_event_unbound');
    if(frame.method==='turn/completed'){if(p.turn?.id!==this.#turn||p.turn.status!=='completed')throw failure('native_turn_incomplete');this.#turn=undefined;yield {type:'done'};return;}
    if(p.turnId!==this.#turn)throw failure('native_event_unbound');
    if(frame.method==='item/agentMessage/delta'){
     if(typeof p.delta!=='string'||typeof p.itemId!=='string')throw failure('native_protocol_invalid');
     const itemKey=encoded([this.#thread,this.#turn,p.itemId]);this.#publicItems.set(itemKey,(this.#publicItems.get(itemKey)??'')+p.delta);this.#appendText(p.delta);yield {type:'text',delta:p.delta};continue;
    }
    if(frame.method==='item/completed'){
     if(p.item?.type!=='agentMessage')continue;
     if(typeof p.item.id!=='string'||typeof p.item.text!=='string')throw failure('native_protocol_invalid');
     const itemKey=encoded([this.#thread,this.#turn,p.item.id]),previous=this.#publicItems.get(itemKey)??'';
     if(!p.item.text.startsWith(previous))throw failure('native_public_text_changed');
     const delta=p.item.text.slice(previous.length);this.#publicItems.set(itemKey,p.item.text);
     if(delta){this.#appendText(delta);yield {type:'text',delta};}continue;
    }
    if(frame.method==='item/tool/call'){
     const args=p.arguments;if(p.namespace!=='xiaok'||p.tool!=='invoke'||!record(args)||Object.keys(args).sort().join(',')!=='arguments,name'||typeof args.name!=='string'||!record(args.arguments)||!allowed.has(args.name))throw failure('native_tool_not_admitted');
     if((typeof frame.id!=='number'&&typeof frame.id!=='string')||typeof p.callId!=='string'||!p.callId||this.#seenCalls.has(p.callId)||this.#seenCalls.size>=256)throw failure('native_call_unbound');this.#seenCalls.add(p.callId);this.#waiting={id:frame.id,callId:p.callId,name:args.name,input:structuredClone(args.arguments),threadId:p.threadId,turnId:p.turnId};const tool:Extract<StreamChunk,{type:'tool_use'}>={type:'tool_use',id:p.callId,name:args.name,input:structuredClone(args.arguments)};this.#assistant.push(structuredClone(tool));yield tool;this.#assert();options?.signal?.throwIfAborted();yield {type:'done'};return;
    }
   }
  }catch(error){this.#fail(error);throw error;}finally{this.#reading=false;options?.signal?.removeEventListener('abort',aborted);}
 }
 closeAndDrain():Promise<void>{
  if(this.#closing)return this.#closing;let resolve!:()=>void,reject!:(error:unknown)=>void;
  this.#closing=new NativePromise<void>((a,b)=>{resolve=a;reject=b;});
  this.#closed=true;
  try{this.#fail(failure('native_session_closed'));
  const draining=(async()=>{
   if(!this.#child){if(this.#spawnAttempted)throw failure('native_spawn_unknown');throw failure('native_worker_not_started');}
   const pid=this.#child.pid,kill=(signal:NodeJS.Signals)=>{if(pid)try{process.kill(-pid,signal);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}};
   let deadline:ReturnType<typeof setTimeout>|undefined;const force=setTimeout(()=>{try{kill('SIGKILL');}catch{/* Original exit deadline preserves uncertainty. */}},1000);
   try{if(!this.#physicallyClosed)kill('SIGTERM');await Promise.race([this.#finished,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(failure('native_worker_close_unknown')),5000);})]);}finally{clearTimeout(force);clearTimeout(deadline);}
   await Promise.allSettled([...this.#writes]);
   if(pid){kill('SIGKILL');const end=Date.now()+2000;for(;;){try{process.kill(-pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')break;throw error;}if(Date.now()>=end)throw failure('native_descendant_close_unknown');await new Promise(resolve=>setTimeout(resolve,10));}}
   if(identity(privateDirectory(this.#workspace))!==this.#directories.get(this.#workspace))throw failure('native_private_directory_changed');fs.rmSync(this.#workspace,{recursive:true,force:true});
   this.#options.store.transaction(()=>{
    const db=this.#options.store.db,row=db.prepare('SELECT * FROM native_model_resources WHERE id=?').get(this.#resource);
    if(!row||row.status!=='running'||row.task_id!==this.#binding.taskId||row.source_epoch!==this.#binding.sourceEpoch||row.owner_session!==this.#binding.ownerSession||row.execution_epoch!==this.#binding.executionEpoch||row.input_id!==this.#binding.inputId||row.pid!==pid)throw failure('native_resource_changed');
    if(db.prepare("UPDATE native_model_resources SET status='drained' WHERE id=? AND status='running'").run(this.#resource).changes!==1)throw failure('native_resource_changed');
    // Native process closure cannot resolve a lost acceptance ACK. Only this
    // original live owner may clear its own exact proven obligation, never
    // another worker, Bash/legacy uncertainty or a caller-supplied receipt.
    if(!db.prepare("SELECT 1 FROM native_model_sends WHERE resource_id=? AND status IN ('intent','unknown') LIMIT 1").get(this.#resource)){
     if(db.prepare("DELETE FROM unproven_effects WHERE task_id=? AND invocation_id=? AND tool_name='native_sampling_worker'").run(this.#binding.taskId,this.#resource).changes!==1)throw failure('native_obligation_changed');
    }
   });this.#drainConfirmed=true;
  })();then.call(draining,resolve,reject);
  }catch(error){reject(error);}return this.#closing;
 }
 readClosure(){const row=this.#options.store.db.prepare('SELECT status,pid FROM native_model_resources WHERE id=?').get(this.#resource);return Object.freeze({workerClosed:this.#physicallyClosed&&this.#drainConfirmed,stdioClosed:this.#physicallyClosed,pid:row?.pid,testOnly:this.#testOnly});}
}
async function open(options:LaunchOptions){let session:NativeModelSession|undefined;try{session=new NativeModelSession(options);await session.connect();return session;}catch(error){if(session)await session.closeAndDrain();throw error;}}
/** Explicit test qualification, never a production execution capability. */
export function openTestNativeModelSession(options:Omit<LaunchOptions,'testOnly'>){return open({...options,testOnly:true});}
export async function openNativeModelSession(options:Omit<Options,'store'>&{service:ContinuityService;resourcesRoot:string}){
 const store=options.service.store,binding=structuredClone(options.binding),service=options.service;
 // Capture the original owner and tuple; no DTO verified bit or caller callback
 // can replace production admission, including after a native ACK await.
 const assertAdmission=()=>{
  const row=store.db.prepare('SELECT * FROM conversation_inputs WHERE input_id=?').get(binding.inputId),execution=row&&store.db.prepare('SELECT * FROM conversation_execution WHERE conversation_id=?').get(row.conversation_id!);
  if(!row||row.task_id!==binding.taskId||row.source_epoch!==binding.sourceEpoch||row.execution_epoch!==binding.executionEpoch||row.authority!==store.profileId||row.status!=='claimed'||!execution||execution.authority!==store.profileId||execution.harness!=='native-codex'||execution.barrier!=='open'||execution.execution_epoch!==row.execution_epoch)throw failure('native_execution_binding_unavailable');
  originalCurrentExecution.call(service,binding.taskId);originalTaskRead.call(service,binding.taskId);
 };
 assertAdmission();
 const home=path.join(options.stateRoot,'native-codex-sessions',hash(encoded(binding)));privateDirectory(home);const fixed='cli_auth_credentials_store = "file"\n[features]\nshell_snapshot = false\n',config=path.join(home,'config.toml');if(!fs.existsSync(config)||fs.readFileSync(config,'utf8')!==fixed)throw failure('native_private_auth_unavailable');
 return open({...options,store,binding,binary:path.join(options.resourcesRoot,'continuity-native','darwin-arm64','codex-app-server'),home,testOnly:false,assertAdmission});
}
