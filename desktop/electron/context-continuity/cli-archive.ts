import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,opendirSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {digest,key} from './store.js';import type {ContinuityActor,ContinuityService} from './service.js';
import type {CliArchiveList,CliArchivePreview,CliArchiveClaim} from '../../shared/cli-archive.js';
const DOMAIN='local-cli-file-v1',MAX_FILE=16*1024*1024,MAX_TEXT=4*1024*1024;
const FIELDS=new Set(['schemaVersion','sessionId','cwd','model','createdAt','updatedAt','forkedFromSessionId','lineage','messages','usage','compactions','promptSnapshotId','memoryRefs','approvalRefs','backgroundJobRefs','intentDelegation','skillEval','skillExecution']);
const id=(value:unknown):string=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))throw new Error('invalid_argument');return value;};
const previewText=(text:string)=>{const s=text.slice(0,240);return /[\uD800-\uDBFF]$/.test(s)?s.slice(0,-1):s;};
interface Projection {sourceMessageId:string;role:'user'|'assistant';text:string;observedAt:number}
interface Source {sessionId:string;fileHash:string;manifestHash:string;projectionHash:string;stamp:string;messages:Projection[];updatedAt:number;rawBytes:number}
interface Proof {actor:ContinuityActor;actorHash:string;hash:string;kind:'source'|'claim';sources:Array<{sessionId:string;stamp:string}>;conversationId?:string;sourceId?:string}
/** Fixed main archive reader; no CLI execution, file mutation, live identity guess or receipt. */
export class CliArchiveImporter{
 private readonly replies=new WeakMap<object,Proof>();
 constructor(private readonly service:ContinuityService,private readonly actor:ContinuityActor,private readonly root:string,private readonly options:{ownerUid?:()=>number|undefined}={}){
  service.store.db.exec(`CREATE TABLE IF NOT EXISTS cli_archive_previews(preview_id TEXT PRIMARY KEY REFERENCES legacy_previews(id),operation_id TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,file_hash TEXT NOT NULL,manifest_hash TEXT NOT NULL,projection_hash TEXT NOT NULL,request_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS cli_archive_sources(source_id TEXT PRIMARY KEY,domain TEXT NOT NULL,session_id TEXT NOT NULL,profile_id TEXT NOT NULL,file_hash TEXT NOT NULL,manifest_hash TEXT NOT NULL,projection_hash TEXT NOT NULL,conversation_id TEXT UNIQUE NOT NULL REFERENCES conversations(id),claim_id TEXT NOT NULL REFERENCES legacy_claims(preview_id),message_count INTEGER NOT NULL,mode TEXT NOT NULL,UNIQUE(domain,session_id));`);
 }
 private user():void{this.service.assertActor(this.actor,true);}
 private rootIdentity():string{
  try{const uid=this.options.ownerUid?this.options.ownerUid():typeof process.getuid==='function'?process.getuid():undefined;if(uid===undefined)throw new Error();const s=lstatSync(this.root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o022)!==0)throw new Error();return digest([s.dev,s.ino,uid]);}catch{throw new Error('cli_source_unavailable');}
 }
 private registry(sessionId:string){return this.service.store.db.prepare('SELECT * FROM cli_archive_sources WHERE domain=? AND session_id=?').get(DOMAIN,sessionId);}
 private assertRegistered(sessionId:string):void{const r=this.registry(sessionId);if(r){this.service.requireConversation(this.actor,String(r.conversation_id));this.service.assertTaskReadable(String(r.source_id));}}
 private read(sessionId:string,byteBudget=MAX_FILE):Source{
  id(sessionId);const root=this.rootIdentity();let fd:number|undefined,bytes:Buffer,stamp:string;
  try{
   const filename=join(this.root,sessionId+'.json');fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const state=fstatSync(fd),uid=this.options.ownerUid?this.options.ownerUid():process.getuid?.();
   if(!state.isFile()||state.uid!==uid||state.nlink!==1||(state.mode&0o077)!==0||state.size>MAX_FILE||state.size>byteBudget)throw new Error();const buffer=Buffer.alloc(state.size+1);let offset=0,count;while(offset<buffer.length&&(count=readSync(fd,buffer,offset,buffer.length-offset,offset)))offset+=count;bytes=buffer.subarray(0,offset);const after=lstatSync(filename),last=fstatSync(fd);
   if(bytes.length!==state.size||bytes.length>byteBudget||after.dev!==state.dev||after.ino!==state.ino||last.size!==state.size||last.mtimeMs!==state.mtimeMs||last.ctimeMs!==state.ctimeMs||last.mode!==state.mode||root!==this.rootIdentity())throw new Error();stamp=digest([root,state.dev,state.ino,state.size,state.mtimeMs,createHash('sha256').update(bytes).digest('hex')]);
  }catch{throw new Error('cli_source_unavailable');}finally{if(fd!==undefined)closeSync(fd);}
  let snapshot:Record<string,unknown>;
  try{snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('cli_source_unsupported');}
  if(!snapshot||Array.isArray(snapshot)||Object.keys(snapshot).some(k=>!FIELDS.has(k))||snapshot.schemaVersion!==1||snapshot.sessionId!==sessionId||typeof snapshot.cwd!=='string'||!isAbsolute(snapshot.cwd)||!Number.isSafeInteger(snapshot.updatedAt)||Number(snapshot.updatedAt)<0||Number(snapshot.updatedAt)>8640000000000000||!Array.isArray(snapshot.messages)||snapshot.messages.length>5000||!Array.isArray(snapshot.memoryRefs)||snapshot.memoryRefs.length>0)throw new Error('cli_source_unsupported');
  const messages:Projection[]=[];let length=0;
  for(const [index,raw]of snapshot.messages.entries()){
   if(!raw||!['user','assistant'].includes(raw.role)||!Array.isArray(raw.content))throw new Error('cli_source_unsupported');
   const text=raw.content.filter((b:unknown)=>b&&typeof b==='object'&&(b as {type?:unknown}).type==='text').map((b:{text:unknown})=>{if(typeof b.text!=='string')throw new Error('cli_source_unsupported');return b.text;}).join('');
   if(!text)continue;if((length+=Buffer.byteLength(text))>MAX_TEXT)throw new Error('cli_source_unsupported');messages.push({sourceMessageId:'legacy_'+index,role:raw.role,text,observedAt:Number(snapshot.updatedAt)});
  }
  if(!messages.length)throw new Error('cli_source_unsupported');const fileHash=createHash('sha256').update(bytes).digest('hex'),projectionHash=digest(messages),manifestHash=digest([1,DOMAIN,sessionId,fileHash,projectionHash]);return {sessionId,fileHash,projectionHash,manifestHash,stamp,messages,updatedAt:Number(snapshot.updatedAt),rawBytes:bytes.length};
 }
 private remember<T extends object>(value:T,proof:Omit<Proof,'actor'|'actorHash'|'hash'>):T{this.replies.set(value,{...proof,actor:this.actor,actorHash:digest(this.actor),hash:digest(value)});this.assertReply(value,this.actor);return value;}
 assertReply(value:object,actor:ContinuityActor):void{
  const p=this.replies.get(value);if(!p||p.actor!==actor||p.actorHash!==digest(actor)||p.hash!==digest(value))throw new Error('cli_archive_proof_unavailable');this.user();
  if(p.kind==='claim'){this.service.requireConversation(actor,p.conversationId!);this.service.assertTaskReadable(p.sourceId!);return;}
  this.rootIdentity();let budget=MAX_FILE*2;for(const source of p.sources){this.assertRegistered(source.sessionId);const current=this.read(source.sessionId,budget);budget-=current.rawBytes;if(current.stamp!==source.stamp)throw new Error('cli_source_changed');}
 }
 async list(input:{after?:string}):Promise<CliArchiveList>{
  this.user();this.rootIdentity();if(input.after!==undefined)id(input.after);const names:string[]=[],dir=opendirSync(this.root);try{let entry;while((entry=dir.readSync())){if(names.length>=10000)throw new Error('cli_source_unavailable');names.push(entry.name);}}finally{dir.closeSync();}const ids=names.filter(n=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(n)).map(n=>n.slice(0,-5)).sort().filter(n=>!input.after||n>input.after),selected=ids.slice(0,20),sources:Proof['sources']=[];let budget=MAX_FILE*2;
  const items=selected.map(sessionId=>{try{this.assertRegistered(sessionId);const size=lstatSync(join(this.root,sessionId+'.json')).size;if(size>budget)throw new Error();budget-=size;const s=this.read(sessionId,size);sources.push({sessionId,stamp:s.stamp});return {sessionId,available:true,updatedAt:s.updatedAt};}catch{return {sessionId,available:false,updatedAt:null};}});
  return this.remember({items,...(ids.length>20?{nextAfter:selected.at(-1)!}:{})},{kind:'source',sources});
 }
 async preview(input:{sessionId:string;operationId:string}):Promise<CliArchivePreview>{
  this.user();id(input.sessionId);key(input.operationId);this.assertRegistered(input.sessionId);const source=this.read(input.sessionId),registry=this.registry(input.sessionId);if(registry&&registry.manifest_hash!==source.manifestHash)throw new Error('cli_source_changed');const db=this.service.store.db,prior=db.prepare('SELECT * FROM cli_archive_previews WHERE operation_id=?').get(input.operationId),requestHash=digest(input);if(prior&&(prior.request_hash!==requestHash||prior.manifest_hash!==source.manifestHash))throw new Error('cli_source_changed');const previewId=String(prior?.preview_id??randomUUID());
  if(!prior)this.service.store.transaction(()=>{db.prepare('INSERT INTO legacy_previews VALUES (?,?,?)').run(previewId,JSON.stringify({kind:'cli_archive',sessionId:input.sessionId}),JSON.stringify({manifestHash:source.manifestHash}));db.prepare('INSERT INTO cli_archive_previews VALUES (?,?,?,?,?,?,?)').run(previewId,input.operationId,input.sessionId,source.fileHash,source.manifestHash,source.projectionHash,requestHash);});
  return this.remember({previewId,sessionId:input.sessionId,manifestHash:source.manifestHash,messageCount:source.messages.length,sample:previewText(source.messages[0]!.text),coverage:'partial'},{kind:'source',sources:[{sessionId:input.sessionId,stamp:source.stamp}]});
 }
 async claim(input:{previewId:string;manifestHash:string;operationId:string}):Promise<CliArchiveClaim>{
  this.user();key(input.previewId);key(input.manifestHash);key(input.operationId);const db=this.service.store.db,preview=db.prepare('SELECT * FROM cli_archive_previews WHERE preview_id=?').get(input.previewId);if(!preview||preview.manifest_hash!==input.manifestHash)throw new Error('not_readable');const sessionId=String(preview.session_id);this.assertRegistered(sessionId);const existing=this.registry(sessionId),old=this.service.store.existingOperation<CliArchiveClaim>('claimCliArchive',input.operationId,input);
  if(old){if(!existing||existing.conversation_id!==old.result.conversationId)throw new Error('not_readable');return this.remember(old.result,{kind:'claim',sources:[],conversationId:old.result.conversationId,sourceId:String(existing.source_id)});}
  if(existing){if(existing.manifest_hash!==input.manifestHash)throw new Error('cli_source_changed');const result={conversationId:String(existing.conversation_id),messageCount:Number(existing.message_count)};return this.remember(this.service.store.operation('claimCliArchive',input.operationId,input,()=>result),{kind:'claim',sources:[],conversationId:result.conversationId,sourceId:String(existing.source_id)});}
  // No await or unowned callback between this real source read and canonical commit.
  const source=this.read(sessionId);if(source.manifestHash!==preview.manifest_hash)throw new Error('cli_source_changed');const sourceId='cli_archive_'+digest([this.actor.profileId,DOMAIN,sessionId]);
  const result=this.service.store.operation('claimCliArchive',input.operationId,input,()=>{
   const final=this.read(sessionId);if(final.stamp!==source.stamp)throw new Error('cli_source_changed');const conversation=this.service.createConversation(this.actor,{operationId:'cli:'+randomUUID(),title:'CLI: '+sessionId});conversation.coverage='partial';conversation.gtdBucket='archived';db.prepare('UPDATE conversations SET record=? WHERE id=?').run(JSON.stringify(conversation),conversation.id);
   db.prepare('INSERT INTO legacy_claims VALUES (?,?,?,?)').run(input.previewId,this.actor.profileId,input.manifestHash,conversation.id);
   db.prepare('INSERT INTO cli_archive_sources VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(sourceId,DOMAIN,sessionId,this.actor.profileId,source.fileHash,source.manifestHash,source.projectionHash,conversation.id,input.previewId,source.messages.length,'standalone_legacy_v1');
   for(const message of source.messages){const m=this.service.recordMessage(this.actor,{conversationId:conversation.id,sourceKind:'cli_session',sourceId,sourceDataEpoch:source.fileHash,sourceRevision:1,executionState:'unknown',...message});const record={...m,observedAt:message.observedAt};db.prepare('UPDATE message_versions SET record=? WHERE message_id=? AND revision=?').run(JSON.stringify(record),m.messageId,m.revision);db.prepare('INSERT INTO archive_visibilities VALUES (?,?,?,?,?)').run(m.messageId,m.revision,source.fileHash,m.contentHash,input.previewId);}
   return {conversationId:conversation.id,messageCount:source.messages.length};
  });return this.remember(result,{kind:'claim',sources:[],conversationId:result.conversationId,sourceId});
 }
}
