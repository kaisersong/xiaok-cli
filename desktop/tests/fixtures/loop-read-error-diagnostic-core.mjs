// Temporary test diagnostics only. Never imported by production source on disk.
import {types} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Buffer} from 'node:buffer';
import {writeSync as initialWriteSync} from 'node:fs';

const apply=Reflect.apply,create=Object.create,define=Object.defineProperty,setPrototype=Object.setPrototypeOf;
const descriptor=Object.getOwnPropertyDescriptor,keys=Object.keys,stringify=JSON.stringify;
const isProxy=types.isProxy,isNativeError=types.isNativeError,isArray=Array.isArray,isInteger=Number.isSafeInteger;
const finite=Number.isFinite,minimum=Math.min,NativeString=String,NativeError=Error;
const nativeCreateHash=createHash,nativeRandomBytes=randomBytes,bufferString=Buffer.prototype.toString;
const writeSync=initialWriteSync;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,NativeWeakMap=WeakMap;
const byteLength=Buffer.byteLength,nowNative=performance.now.bind(performance);
const hashPrototype=Object.getPrototypeOf(createHash('sha256')),hashUpdate=hashPrototype.update,hashDigest=hashPrototype.digest;
export const EVENT_PREFIX='XIAOK_LOOP_READ_DIAGNOSTIC_EVENT ';
export const HEALTH_PREFIX='XIAOK_LOOP_READ_DIAGNOSTIC_HEALTH ';
export const LOADER_PREFIX='XIAOK_LOOP_READ_DIAGNOSTIC_LOADER ';
const CODES=new Set([
 'loop_publication_read_timeout','loop_publication_owner_unavailable','loop_publication_owner_changed','loop_publication_application_pending','loop_publication_application_changed','loop_publication_not_current','loop_publication_payload','loop_publication_payload_application','loop_publication_changed','application_registration_changed','application_client_owner_changed','publication_installed_owner_changed','controller_ipc_aborted_unknown','loop_projection_closed','loop_projection_admission_sync','loop_projection_changed','loop_projection_task_reader_required','loop_projection_task_changed','loop_projection_publication_changed','loop_completion_subject','loop_completion_unavailable','loop_completion_ticket','loop_completion_changed','loop_output_closed','loop_output_admission_sync','loop_output_changed','loop_output_publication_pending','loop_output_binding','loop_output_directory_changed','loop_output_file_changed','loop_output_publication_changed','loop_output_artifact_not_unique','loop_output_artifact_changed',
]);
const setHas=Set.prototype.has;
const SITES=['reader','consumer','output'],PHASES=['start','inspect-before','observe-before','payload','inspect-after','observe-after','return'],ACTIONS=['preview','task','open','list'];
function contains(list,value){for(let i=0;i<list.length;i++)if(list[i]===value)return true;return false;}
function object(fields){const value=create(null),names=keys(fields);for(let i=0;i<names.length;i++){const key=names[i];define(value,key,{__proto__:null,value:fields[key],enumerable:true,writable:true,configurable:true});}return value;}
function array(){return setPrototype([],null);}
function add(list,value){define(list,list.length,{__proto__:null,value,enumerable:true,writable:true,configurable:true});}
function json(value){return apply(stringify,undefined,[value]);}
function hash(){return nativeCreateHash('sha256');}
function update(h,text){apply(hashUpdate,h,[text]);}
function finish(h){return apply(hashDigest,h,['hex']);}

export function createRecorder({pid=process.pid,nonce=apply(bufferString,nativeRandomBytes(16),['hex']),now=nowNative,writeLine,moduleIdSha256=null}={}){
 // Synchronous fixed-FD writes cannot introduce a later unhandled stream error.
 const output=writeLine??(line=>{const text=line+'\n';if(writeSync(1,text)!==byteLength(text,'utf8'))throw new NativeError('diagnostic_short_write');});
 const ids=new NativeWeakMap(),readers=new NativeWeakMap(),siteCounts=object({reader:0,consumer:0,output:0}),eventsHash=hash();
 let nextID=0,readerSeq=0,sealed=false,lateSent=false,eventsAttempted=0,eventsEmitted=0,dropped=0,bytes=0;
 let readerStarted=0,readerFulfilled=0,readerFailed=0,activeReaderCount=0,observerErrors=0,incomplete=false,truncated=false;
 function stamp(){const value=now();if(typeof value!=='number'||!finite(value))throw new NativeError('diagnostic_clock');return value;}
 function guarded(work){try{return work();}catch{observerErrors++;incomplete=true;return undefined;}}
 function header(kind,site,seq){return object({schemaVersion:1,workerPID:pid,workerNonce:nonce,eventSeq:seq,kind,site,monotonicMs:stamp()});}
 function late(site){
  if(lateSent)return;lateSent=true;incomplete=true;
  guarded(()=>{const value=header('late-event',contains(SITES,site)?site:'reader',eventsAttempted+1);value.sealed=true;output(EVENT_PREFIX+json(value));});
 }
 function open(site){if(sealed){late(site);return false;}return true;}
 function opaque(value){
  if((typeof value!=='object'||value===null)&&typeof value!=='function'){incomplete=true;return null;}
  const known=apply(weakGet,ids,[value]);if(known)return known;
  if(nextID>=1024){truncated=true;incomplete=true;return null;}
  const id=++nextID;apply(weakSet,ids,[value,id]);return id;
 }
 function errorGraph(error){
  const nodes=array(),seen=new NativeWeakMap();
  function visit(value,depth){
   const id=opaque(value);if(id===null)return null;
   if(apply(weakGet,seen,[value])){incomplete=true;return id;}
   if(nodes.length>=8||depth>4){truncated=true;incomplete=true;return id;}
   apply(weakSet,seen,[value,true]);
   const node=object({id,kind:'object',code:'unclassified',causeId:null,aggregateErrorIds:array(),incomplete:false});add(nodes,node);
   if(isProxy(value)){node.kind='proxy';node.incomplete=true;incomplete=true;return id;}
   node.kind=isNativeError(value)?'native-error':'object';
   const message=descriptor(value,'message'),code=descriptor(value,'code');
   if(message&&!descriptor(message,'value')||code&&!descriptor(code,'value')){node.incomplete=true;incomplete=true;}
   const selected=message&&descriptor(message,'value')?message.value:code&&descriptor(code,'value')?code.value:undefined;
   if(typeof selected==='string'&&apply(setHas,CODES,[selected]))node.code=selected;
   else{node.incomplete=true;incomplete=true;}
   const cause=descriptor(value,'cause');
   if(cause){if(!descriptor(cause,'value')){node.incomplete=true;incomplete=true;}else if(cause.value!==undefined&&cause.value!==null)node.causeId=visit(cause.value,depth+1);}
   const errors=descriptor(value,'errors');
   if(errors){
    if(!descriptor(errors,'value')||isProxy(errors.value)||!isArray(errors.value)){node.incomplete=true;incomplete=true;}
    else{
     const length=descriptor(errors.value,'length')?.value;
     if(!isInteger(length)||length<0){node.incomplete=true;incomplete=true;}
     else{
      if(length>4){truncated=true;node.incomplete=true;incomplete=true;}
      for(let i=0;i<minimum(length,4);i++){
       const entry=descriptor(errors.value,NativeString(i));
       if(!entry||!descriptor(entry,'value')){node.incomplete=true;incomplete=true;continue;}
       add(node.aggregateErrorIds,visit(entry.value,depth+1));
      }
     }
    }
   }
   return id;
  }
  return object({id:visit(error,0),nodes});
 }
 function emit(kind,site,fields,error){
  if(!open(site))return;
  eventsAttempted++;
  guarded(()=>{
   if(eventsEmitted>=256){dropped++;truncated=true;incomplete=true;return;}
   const value=header(kind,site,eventsAttempted);
   const names=keys(fields);for(let i=0;i<names.length;i++){const key=names[i];value[key]=fields[key];}
   const graph=errorGraph(error);value.errorId=graph.id;value.errors=graph.nodes;
   const line=EVENT_PREFIX+json(value),size=byteLength(line+'\n','utf8');
   if(size>4096||bytes+size>256*1024){dropped++;truncated=true;incomplete=true;return;}
   try{output(line);}catch{dropped++;throw new NativeError('diagnostic_output');}
   update(eventsHash,line+'\n');bytes+=size;eventsEmitted++;
  });
 }
 function reader(token){const value=token&&apply(weakGet,readers,[token]);if(!value){incomplete=true;return null;}return value;}
 function phase(token,kind,next){
  if(!open('reader'))return;
  guarded(()=>{const r=reader(token);if(!r)return;if(next!==undefined){if(!contains(PHASES,next))throw new NativeError('diagnostic_phase');r.phase=next;}
   if(r.points.length>=24){truncated=true;incomplete=true;return;}
   add(r.points,object({kind,phase:r.phase,monotonicMs:stamp()}));});
 }
 const api=object({
  siteLoaded(site){if(!open(site))return;guarded(()=>{if(!contains(SITES,site))throw new NativeError('diagnostic_site');siteCounts[site]++;if(siteCounts[site]>1)incomplete=true;});},
  readerBegin(){if(!open('reader'))return null;return guarded(()=>{const token=create(null),r=object({seq:++readerSeq,phase:'start',points:array(),failed:false,settled:false});apply(weakSet,readers,[token,r]);readerStarted++;activeReaderCount++;phase(token,'begin','start');return token;});},
  waitBegin(token,next){phase(token,'begin',next);},
  waitEnd(token,next){phase(token,'fulfilled',next);},
  returnReady(token){if(!open('reader'))return;guarded(()=>{const r=reader(token);if(r)r.phase='return';});},
  timerFired(token){phase(token,'timer-fired');},
  readerFailure(token,error){if(!open('reader'))return;guarded(()=>{const r=reader(token);if(!r)return;r.failed=true;emit('reader-failure','reader',object({readerSeq:r.seq,phase:r.phase,phaseEvents:r.points}),error);});},
  readerSettled(token,cleanupFailed=false){if(!open('reader'))return;guarded(()=>{const r=reader(token);if(!r)return;if(r.settled)throw new NativeError('diagnostic_double_settle');r.settled=true;activeReaderCount--;if(r.failed||cleanupFailed)readerFailed++;else readerFulfilled++;});},
  consumerCatch(error){guarded(()=>emit('consumer-catch','consumer',create(null),error));},
  outputRejection(action,error){if(!open('output'))return;guarded(()=>{if(!contains(ACTIONS,action))throw new NativeError('diagnostic_action');emit('output-rejection','output',object({action}),error);});},
  health(){
   if(sealed){late('reader');return;}sealed=true;
   guarded(()=>{const value=object({schemaVersion:1,workerPID:pid,workerNonce:nonce,recorderModuleIdSha256:moduleIdSha256,monotonicMs:stamp(),sitesLoaded:siteCounts,
    readerStarted,readerFulfilled,readerFailed,activeReaderCount,eventsAttempted,eventsEmitted,dropped,observerErrors,truncated,incomplete,eventSeqLast:eventsAttempted,eventBytes:bytes,eventsSha256:finish(eventsHash)});
    const line=HEALTH_PREFIX+json(value);if(byteLength(line+'\n','utf8')>4096)throw new NativeError('diagnostic_health_capacity');output(line);});
  },
 });
 return api;
}

// Parsed transcript data is untrusted too: a valid byte hash is not a schema.
const HEALTH_KEYS=['schemaVersion','workerPID','workerNonce','recorderModuleIdSha256','monotonicMs','sitesLoaded','readerStarted','readerFulfilled','readerFailed','activeReaderCount','eventsAttempted','eventsEmitted','dropped','observerErrors','truncated','incomplete','eventSeqLast','eventBytes','eventsSha256'];
const COMMON_EVENT_KEYS=['schemaVersion','workerPID','workerNonce','eventSeq','kind','site','monotonicMs'];
const NODE_KEYS=['id','kind','code','causeId','aggregateErrorIds','incomplete'];
function closed(value,names){return value!==null&&typeof value==='object'&&!isArray(value)&&keys(value).length===names.length&&names.every(name=>Object.prototype.hasOwnProperty.call(value,name));}
function natural(value){return isInteger(value)&&value>=0;}
function identity(value){return isInteger(value)&&value>0&&value<=1024;}
function clock(value){return typeof value==='number'&&finite(value)&&value>=0;}
function digest(value,length){return typeof value==='string'&&value.length===length&&/^[a-f0-9]+$/.test(value);}
function graphComplete(event){
 if(!identity(event.errorId)||!isArray(event.errors)||event.errors.length<1||event.errors.length>8)return false;
 const nodes=new Map();
 for(const node of event.errors){
  if(!closed(node,NODE_KEYS)||!identity(node.id)||nodes.has(node.id)||!contains(['native-error','object'],node.kind)||typeof node.code!=='string'||!apply(setHas,CODES,[node.code])||node.incomplete!==false||!(node.causeId===null||identity(node.causeId))||!isArray(node.aggregateErrorIds)||node.aggregateErrorIds.length>4||!node.aggregateErrorIds.every(identity))return false;
  nodes.set(node.id,node);
 }
 // The recorder marks repeated encounters (cycles or shared graph edges),
 // missing identities and depth truncation incomplete. Never promote them here.
 const visited=new Set();
 function visit(id,depth){
  if(depth>4||visited.has(id)||!nodes.has(id))return false;
  visited.add(id);const node=nodes.get(id);
  if(node.causeId!==null&&!visit(node.causeId,depth+1))return false;
  for(const child of node.aggregateErrorIds)if(!visit(child,depth+1))return false;
  return true;
 }
 return visit(event.errorId,0)&&visited.size===nodes.size;
}
function phaseComplete(event){
 if(!contains(PHASES,event.phase)||!isArray(event.phaseEvents)||event.phaseEvents.length<1||event.phaseEvents.length>24)return false;
 let previous=0;
 for(const point of event.phaseEvents){
  if(!closed(point,['kind','phase','monotonicMs'])||!contains(['begin','fulfilled','timer-fired'],point.kind)||!contains(PHASES,point.phase)||!clock(point.monotonicMs)||point.monotonicMs<previous||point.monotonicMs>event.monotonicMs)return false;
  previous=point.monotonicMs;
 }
 return true;
}

/** Structural health only. Real observation additionally needs original case,
 * finally/hook/step evidence, checked independently against the complete log. */
export function verifyTranscript(text){
 const eventLines=[],healthLines=[],problems=[];
 if(typeof text!=='string')return {scope:'health-transcript-only',complete:false,problems:['invalid_transcript']};
 const lines=text.split(/\r?\n/);let healthPosition=-1;
 for(let position=0;position<lines.length;position++){
  const line=lines[position];
  const eventAt=line.indexOf(EVENT_PREFIX),healthAt=line.indexOf(HEALTH_PREFIX);
  if(eventAt>=0)eventLines.push({line:line.slice(eventAt),position});
  if(healthAt>=0){healthLines.push(line.slice(healthAt));healthPosition=position;}
 }
 if(healthLines.length!==1)return {scope:'health-transcript-only',complete:false,problems:['health_count']};
 // Enforce allocation/work bounds before parsing untrusted structured rows.
 if(byteLength(healthLines[0]+'\n','utf8')>4096)return {scope:'health-transcript-only',complete:false,problems:['health_capacity']};
 if(eventLines.length>256)return {scope:'health-transcript-only',complete:false,problems:['event_count']};
 let structuredBytes=0;
 for(const event of eventLines){const size=byteLength(event.line+'\n','utf8');if(size>4096)return {scope:'health-transcript-only',complete:false,problems:['event_capacity']};structuredBytes+=size;}
 if(structuredBytes>256*1024)return {scope:'health-transcript-only',complete:false,problems:['event_capacity']};
 try{
  const receipt=JSON.parse(healthLines[0].slice(HEALTH_PREFIX.length)),parsed=eventLines.map(e=>JSON.parse(e.line.slice(EVENT_PREFIX.length)));
  if(!closed(receipt,HEALTH_KEYS))return {scope:'health-transcript-only',complete:false,problems:['health_schema']};
  if(receipt.schemaVersion!==1||!isInteger(receipt.workerPID)||receipt.workerPID<=0||!digest(receipt.workerNonce,32)||!digest(receipt.recorderModuleIdSha256,64))problems.push('health_identity');
  if(!clock(receipt.monotonicMs))problems.push('health_clock');
  if(!closed(receipt.sitesLoaded,SITES)||SITES.some(site=>receipt.sitesLoaded[site]!==1))problems.push('site_coverage');
  for(const key of ['readerStarted','readerFulfilled','readerFailed','activeReaderCount','eventsAttempted','eventsEmitted','dropped','observerErrors','eventSeqLast','eventBytes'])if(!natural(receipt[key]))problems.push('health_counter');
  if(receipt.readerStarted!==receipt.readerFulfilled+receipt.readerFailed||receipt.activeReaderCount!==0)problems.push('unsettled_readers');
  if(receipt.dropped!==0||receipt.observerErrors!==0||receipt.truncated!==false||receipt.incomplete!==false)problems.push('observer_incomplete');
  if(receipt.eventsEmitted!==parsed.length||receipt.eventsAttempted!==parsed.length||receipt.eventSeqLast!==parsed.length||parsed.length>256)problems.push('event_count');
  const h=hash(),failedReaders=new Set();let total=0,previous=0;
  for(let i=0;i<parsed.length;i++){
   const value=parsed[i],line=eventLines[i].line+'\n',size=byteLength(line,'utf8');update(h,line);total+=size;
   if(eventLines[i].position>=healthPosition)problems.push('event_after_health');
   if(value===null||typeof value!=='object'||isArray(value)){problems.push('event_schema');continue;}
   if(size>4096||value.schemaVersion!==1||value.workerPID!==receipt.workerPID||value.workerNonce!==receipt.workerNonce||value.eventSeq!==i+1||!contains(SITES,value.site))problems.push('event_identity');
   if(!clock(value.monotonicMs)||value.monotonicMs<previous||value.monotonicMs>receipt.monotonicMs)problems.push('event_clock');
   previous=value.monotonicMs;
   if(value.kind==='late-event'){
    if(!closed(value,[...COMMON_EVENT_KEYS,'sealed'])||value.sealed!==true)problems.push('event_schema');
    problems.push('late_event');continue;
   }
   const extra=value.kind==='reader-failure'?['readerSeq','phase','phaseEvents','errorId','errors']:value.kind==='consumer-catch'?['errorId','errors']:value.kind==='output-rejection'?['action','errorId','errors']:null;
   if(extra===null){problems.push('event_kind');continue;}
   if(!closed(value,[...COMMON_EVENT_KEYS,...extra]))problems.push('event_schema');
   const expectedSite=value.kind==='reader-failure'?'reader':value.kind==='consumer-catch'?'consumer':'output';
   if(value.site!==expectedSite)problems.push('event_site_kind');
   if(!graphComplete(value))problems.push('error_graph');
   if(value.kind==='reader-failure'){
    if(!isInteger(value.readerSeq)||value.readerSeq<=0||value.readerSeq>receipt.readerStarted||failedReaders.has(value.readerSeq))problems.push('reader_identity');
    failedReaders.add(value.readerSeq);
    if(!phaseComplete(value))problems.push('reader_phase');
   }
   if(value.kind==='output-rejection'&&!contains(ACTIONS,value.action))problems.push('output_action');
  }
  // Original finally cleanup can reject after a successful reader body, without
  // a reader catch event. Counters must include that rejection, never invent its identity.
  if(failedReaders.size>receipt.readerFailed)problems.push('reader_failure_count');
  if(total>256*1024||total!==receipt.eventBytes||!digest(receipt.eventsSha256,64)||finish(h)!==receipt.eventsSha256)problems.push('event_integrity');
  return {scope:'health-transcript-only',complete:problems.length===0,problems,receipt};
 }catch{return {scope:'health-transcript-only',complete:false,problems:['invalid_json_or_receipt']};}
}
