import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,basename,join,resolve} from 'node:path';
import {z} from 'zod';
import {captureIpcData} from './ipc-data-snapshot.js';
import {assertOrdinarySourceWriterRoute} from '../../src/runtime/verification/ordinary-source-writer-observation.js';

// Resource metadata only. There is deliberately no qualified/native factory,
// global path resolver, timer, model dispatch, physical-proof issuer or takeover.
const callerNonces=new WeakMap<object,string>();
const authorityJournals=new WeakMap<object,{path:string;dev:number;ino:number}>();
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value);
}
const id=z.string().min(1).max(256),hex=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const subjectRef=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('kswarm_task'),projectId:id,taskId:id,runId:id}).strict(),
 z.object({kind:z.literal('kswarm_plan'),projectId:id,planGeneration:z.literal(1),planRunId:id,enqueueKey:id}).strict(),
 z.object({kind:z.literal('room_turn'),roomId:id,turnId:id,logicalAgentId:id}).strict(),
 z.object({kind:z.literal('room_project'),projectId:id,taskId:id,runId:id,roomId:id}).strict(),
 z.object({kind:z.literal('workflow_root'),workflowId:id,workflowRootId:id,runId:id}).strict(),
 z.object({kind:z.literal('dsh_draft'),ownerWorkId:id,draftInvocationId:id}).strict(),
]);
const subjectSchema=z.object({executionKey:id,payloadHash:hex,executionClass:z.enum(['room_discussion','room_project','kswarm_direct','workflow_root','dsh_draft']),priorityClass:z.enum(['human_followup','background']),
 scope:z.object({profileId:id,workspaceId:id,principalId:id}).strict(),subject:subjectRef,authorizationRef:id,deadlineAt:count.optional()}).strict().refine(value=>
 value.executionClass==='kswarm_direct'?['kswarm_task','kswarm_plan'].includes(value.subject.kind):
 value.executionClass==='room_discussion'?value.subject.kind==='room_turn':value.executionClass===value.subject.kind);

export type RootResourceSubject=z.infer<typeof subjectSchema>;
export interface RootResourceContext {requestSource:'user'|'agent'|'scheduler';authority:object}
export type RootResourceState='queued'|'reserved'|'running'|'cancel_pending'|'launch_unknown'|'released'|'cancelled_before_launch';
export interface RootResourceRecord extends RootResourceSubject {
 recordId:string;metadataDigest:string;enqueueSeq:number;revision:number;acquireGeneration:number;issuerEpoch:number;state:RootResourceState;
 claimToken?:string;attemptId?:string;outboxRevision:number;
}
export type RootResourceEnqueueResult={disposition:'new_queued'|'existing_queued'|'existing_active'|'existing_terminal';record:RootResourceRecord};
export interface RootResourceExitFact {recordId:string;claimToken:string;attemptId:string;acquireGeneration:number;issuerEpoch:number;metadataDigest:string;proofDigest:string;outboxRevision:number}
const exitFactSchema=z.object({recordId:id,claimToken:id,attemptId:id,acquireGeneration:z.literal(1),issuerEpoch:count.refine(value=>value>0),metadataDigest:hex,proofDigest:hex,outboxRevision:count}).strict();
export interface RootResourceJournalOptions {
 path:string;capacity?:number;queueLimit?:number;authority:object;
 issuer:{hostId:string;hostBootId:string;runtimeEpoch:number};
 verifySubject(proof:object):unknown;
 isEligible(subject:Readonly<RootResourceSubject>):boolean;
 verifyExit(proof:object):RootResourceExitFact;
 now?():number;
}
interface Row {record_id:string;execution_key:string;metadata_json:string;metadata_digest:string;enqueue_seq:number;revision:number;generation:number;issuer_epoch:number;state:RootResourceState;claim_token:string|null;attempt_id:string|null;outbox_revision:number|null}
class ProtocolError extends Error {}
function protocol(message:string):never {throw new ProtocolError(message);}
const activeStates=new Set<RootResourceState>(['reserved','running','cancel_pending','launch_unknown']);
const allStates=new Set<RootResourceState>(['queued',...activeStates,'released','cancelled_before_launch']);
/** Constructed only by trusted host code. Verifier doubles in metadata tests
 * never certify native/floor/exit; a resource claim cannot itself launch work. */
export function createRootResourceJournal(options:RootResourceJournalOptions) {
 assertOrdinarySourceWriterRoute();
 const capacity=options.capacity??5,queueLimit=options.queueLimit??256;
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>64||!Number.isSafeInteger(queueLimit)||queueLimit<1||queueLimit>4096)throw Error('root_policy_invalid');
 if(!options.authority||typeof options.authority!=='object'||typeof options.verifySubject!=='function'||typeof options.verifyExit!=='function'||typeof options.isEligible!=='function')throw Error('root_authority_unavailable');
 const issuer=z.object({hostId:id,hostBootId:id,runtimeEpoch:count.refine(value=>value>0)}).strict().parse(captureIpcData(options.issuer,'root_issuer_invalid'));
 let nonce=callerNonces.get(options.authority);if(!nonce){nonce=randomUUID();callerNonces.set(options.authority,nonce);}
 const ownerDigest=digest(canonical([issuer,nonce]));
 const authority=options.authority,verifySubject=options.verifySubject,verifyExit=options.verifyExit,isEligible=options.isEligible,now=options.now;
 const requested=resolve(options.path);mkdirSync(dirname(requested),{recursive:true,mode:0o700});
 const parent=realpathSync(dirname(requested));if(lstatSync(dirname(requested)).isSymbolicLink())throw Error('root_journal_path_invalid');
 const file=join(parent,basename(requested));try{if(lstatSync(file).isSymbolicLink())throw Error('root_journal_path_invalid');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const prior=authorityJournals.get(authority);
 if(prior){let current;try{current=lstatSync(file);}catch{throw Error('root_journal_identity_changed');}if(prior.path!==file||prior.dev!==current.dev||prior.ino!==current.ino)throw Error('root_journal_identity_changed');}
 const db=new DatabaseSync(file);const identity=lstatSync(file);authorityJournals.set(authority,{path:file,dev:identity.dev,ino:identity.ino});let closed=false,unconfirmed=false;
 const assertCaller=(ctx:RootResourceContext):void=>{if(ctx?.requestSource!=='scheduler'||ctx.authority!==authority)protocol('root_caller_forbidden');if(closed)protocol('root_journal_closed');if(unconfirmed)protocol('root_journal_unconfirmed');assertOrdinarySourceWriterRoute();const current=lstatSync(file);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino)protocol('root_journal_identity_changed');};
 const tx=<T>(work:()=>T):T=>{
  let began=false;try{db.exec('BEGIN IMMEDIATE');began=true;const result=work();db.exec('COMMIT');return result;}
  catch(error){if(began)try{db.exec('ROLLBACK');}catch{unconfirmed=true;}if(!(error instanceof ProtocolError))unconfirmed=true;throw error;}
 };
 try{
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS root_resource_policy(singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner_digest TEXT NOT NULL,issuer_json TEXT NOT NULL,capacity INTEGER NOT NULL,queue_limit INTEGER NOT NULL,next_seq INTEGER NOT NULL,human_burst INTEGER NOT NULL,claim_seq INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS root_resources(record_id TEXT PRIMARY KEY,execution_key TEXT UNIQUE NOT NULL,metadata_json TEXT NOT NULL,metadata_digest TEXT NOT NULL,enqueue_seq INTEGER UNIQUE NOT NULL,revision INTEGER NOT NULL,generation INTEGER NOT NULL,issuer_epoch INTEGER NOT NULL,state TEXT NOT NULL,claim_token TEXT,attempt_id TEXT);
   CREATE INDEX IF NOT EXISTS root_resources_pending ON root_resources(state,enqueue_seq);
   CREATE TABLE IF NOT EXISTS root_launch_outbox(record_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,FOREIGN KEY(record_id) REFERENCES root_resources(record_id));
   CREATE TABLE IF NOT EXISTS root_resource_receipts(record_id TEXT NOT NULL,kind TEXT NOT NULL,binding_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(record_id,kind),FOREIGN KEY(record_id) REFERENCES root_resources(record_id));
   CREATE TRIGGER IF NOT EXISTS root_no_delete BEFORE DELETE ON root_resources BEGIN SELECT RAISE(ABORT,'root_resource_delete_forbidden'); END;
   CREATE TRIGGER IF NOT EXISTS root_receipt_no_delete BEFORE DELETE ON root_resource_receipts BEGIN SELECT RAISE(ABORT,'root_receipt_immutable'); END;
   CREATE TRIGGER IF NOT EXISTS root_receipt_no_update BEFORE UPDATE ON root_resource_receipts BEGIN SELECT RAISE(ABORT,'root_receipt_immutable'); END;
   CREATE TRIGGER IF NOT EXISTS root_outbox_no_delete BEFORE DELETE ON root_launch_outbox BEGIN SELECT RAISE(ABORT,'root_outbox_delete_forbidden'); END;
   CREATE TRIGGER IF NOT EXISTS root_immutable_update BEFORE UPDATE ON root_resources WHEN
    NEW.record_id IS NOT OLD.record_id OR NEW.execution_key IS NOT OLD.execution_key OR NEW.metadata_json IS NOT OLD.metadata_json OR NEW.metadata_digest IS NOT OLD.metadata_digest OR NEW.enqueue_seq IS NOT OLD.enqueue_seq OR NEW.issuer_epoch IS NOT OLD.issuer_epoch OR NEW.revision != OLD.revision+1
    OR NOT ((OLD.state='queued' AND NEW.state IN ('reserved','cancelled_before_launch')) OR (OLD.state='reserved' AND NEW.state IN ('running','cancel_pending','launch_unknown','released')) OR (OLD.state='running' AND NEW.state IN ('cancel_pending','launch_unknown','released')) OR (OLD.state='launch_unknown' AND NEW.state IN ('cancel_pending','released')) OR (OLD.state='cancel_pending' AND NEW.state='released'))
    OR NOT ((OLD.state='queued' AND NEW.state='reserved' AND NEW.generation=1 AND OLD.generation=0 AND NEW.claim_token IS NOT NULL AND NEW.attempt_id IS NOT NULL) OR (NEW.generation=OLD.generation AND NEW.claim_token IS OLD.claim_token AND NEW.attempt_id IS OLD.attempt_id))
    BEGIN SELECT RAISE(ABORT,'root_resource_immutable'); END;`);
  tx(()=>{
   const policy=db.prepare('SELECT * FROM root_resource_policy WHERE singleton=1').get();
   if(!policy)db.prepare('INSERT INTO root_resource_policy VALUES(1,?,?,?,?,0,0,0)').run(ownerDigest,canonical(issuer),capacity,queueLimit);
   else if(policy.owner_digest!==ownerDigest||policy.issuer_json!==canonical(issuer))protocol('root_issuer_conflict');
  });
 }catch(error){db.close();throw error;}
 function policy(){const row=db.prepare('SELECT * FROM root_resource_policy WHERE singleton=1').get()!;
  if(row.owner_digest!==ownerDigest||!Number.isSafeInteger(row.capacity)||Number(row.capacity)<1||Number(row.capacity)>64||!Number.isSafeInteger(row.queue_limit)||Number(row.queue_limit)<1||Number(row.queue_limit)>4096||!Number.isSafeInteger(row.next_seq)||Number(row.next_seq)<0||!Number.isSafeInteger(row.claim_seq)||Number(row.claim_seq)<0||!Number.isInteger(row.human_burst)||Number(row.human_burst)<0||Number(row.human_burst)>3)throw Error('root_policy_corrupt');return row;}
 const select='SELECT r.*,o.revision AS outbox_revision FROM root_resources r LEFT JOIN root_launch_outbox o ON o.record_id=r.record_id';
 function decode(row:Row|undefined):RootResourceRecord|null {
  if(!row)return null;const parsed=subjectSchema.safeParse(JSON.parse(row.metadata_json));
  if(!parsed.success||digest(canonical(parsed.data))!==row.metadata_digest||parsed.data.executionKey!==row.execution_key||!allStates.has(row.state)||![row.enqueue_seq,row.revision,row.issuer_epoch].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(row.generation)||row.generation<0)throw Error('root_journal_corrupt');
  if(!Number.isSafeInteger(row.outbox_revision??0)||Number(row.outbox_revision??0)<0)throw Error('root_claim_corrupt');
  const launched=activeStates.has(row.state)||row.state==='released';
  if(launched&&(!row.claim_token||!row.attempt_id||row.generation!==1||row.outbox_revision===null)||!launched&&(row.claim_token!==null||row.attempt_id!==null||row.generation!==0))throw Error('root_claim_corrupt');
  return {...parsed.data,recordId:row.record_id,metadataDigest:row.metadata_digest,enqueueSeq:row.enqueue_seq,revision:row.revision,acquireGeneration:row.generation,issuerEpoch:row.issuer_epoch,state:row.state,...(row.claim_token?{claimToken:row.claim_token}:{}),...(row.attempt_id?{attemptId:row.attempt_id}:{}),outboxRevision:row.outbox_revision??0};
 }
 function read(key:string){return decode(db.prepare(select+' WHERE r.execution_key=?').get(key) as unknown as Row|undefined);}
 function openRows(){return (db.prepare(select+" WHERE r.state IN ('queued','reserved','running','cancel_pending','launch_unknown') ORDER BY r.enqueue_seq").all() as unknown as Row[]).map(row=>decode(row)!);}
 function advance(record:RootResourceRecord,state:RootResourceState):RootResourceRecord {
  if(!Number.isSafeInteger(record.revision+1))protocol('root_revision_overflow');
  const result=db.prepare('UPDATE root_resources SET state=?,revision=revision+1 WHERE record_id=? AND revision=? AND generation=? AND issuer_epoch=?').run(state,record.recordId,record.revision,record.acquireGeneration,record.issuerEpoch);
  if(result.changes!==1)protocol('root_revision_conflict');return read(record.executionKey)!;
 }
 function claimBinding(input:unknown):RootResourceRecord {
  const value=captureIpcData(input,'root_claim_invalid') as Partial<RootResourceRecord>;
  if(!value||typeof value.executionKey!=='string')protocol('root_claim_invalid');const record=read(value.executionKey)!;
  if(!record||!record.claimToken||!['recordId','claimToken','attemptId','acquireGeneration','issuerEpoch','metadataDigest'].every(key=>record[key as keyof RootResourceRecord]===value[key as keyof RootResourceRecord]))protocol('root_claim_conflict');return record;
 }
 function fence(record:RootResourceRecord):void {db.prepare("UPDATE root_launch_outbox SET state='fenced',revision=revision+1 WHERE record_id=? AND state IN ('pending','consumed')").run(record.recordId);}
 function receipt(record:RootResourceRecord,kind:string){
  const row=db.prepare('SELECT binding_hash,receipt_json FROM root_resource_receipts WHERE record_id=? AND kind=?').get(record.recordId,kind);if(!row)return undefined;
  let value:Record<string,unknown>;try{value=JSON.parse(String(row.receipt_json));}catch{throw Error('root_receipt_corrupt');}
  const bound=kind==='released'?value?.exitFact:value;
  if(!value||typeof value!=='object'||Array.isArray(value)||!bound||typeof bound!=='object'||Array.isArray(bound)||digest(canonical(bound))!==row.binding_hash
   || !['recordId','claimToken','attemptId','acquireGeneration','issuerEpoch','metadataDigest'].every(key=>value[key]===record[key as keyof RootResourceRecord])
   || kind==='released'&&(!exitFactSchema.safeParse(bound).success||value.state!=='released'||value.proofDigest!==(bound as RootResourceExitFact).proofDigest||!['recordId','claimToken','attemptId','acquireGeneration','issuerEpoch','metadataDigest'].every(key=>(bound as Record<string,unknown>)[key]===value[key])))throw Error('root_receipt_corrupt');
  return {bindingHash:String(row.binding_hash),value};
 }
 return Object.freeze({
  kind:'runtime_root_resource_contract_v1' as const,nativeQualified:false as const,
  enqueueRoot(proof:object,ctx:RootResourceContext):RootResourceEnqueueResult {
   assertCaller(ctx);const captured=captureIpcData(verifySubject(proof),'root_subject_invalid'),parsed=subjectSchema.safeParse(captured);if(!parsed.success)protocol('root_subject_invalid');
   const fact=parsed.data,metadata=canonical(fact),hash=digest(metadata);
   return tx(()=>{policy();const previous=read(fact.executionKey);
    if(previous){if(previous.metadataDigest!==hash)protocol('root_input_conflict');return {disposition:previous.state==='queued'?'existing_queued':activeStates.has(previous.state)?'existing_active':'existing_terminal',record:previous};}
    const p=policy();if(openRows().filter(row=>row.state==='queued').length>=Number(p.queue_limit))protocol('root_queue_capacity_pending');const seq=Number(p.next_seq)+1;if(!Number.isSafeInteger(seq))protocol('root_sequence_overflow');
    db.prepare('INSERT INTO root_resources VALUES(?,?,?,?,?,1,0,?,?,NULL,NULL)').run(randomUUID(),fact.executionKey,metadata,hash,seq,issuer.runtimeEpoch,'queued');db.prepare('UPDATE root_resource_policy SET next_seq=? WHERE singleton=1').run(seq);return {disposition:'new_queued',record:read(fact.executionKey)!};
   });
  },
  claimNext(ctx:RootResourceContext):RootResourceRecord|null {
   assertCaller(ctx);return tx(()=>{const p=policy(),rows=openRows();if(rows.filter(row=>activeStates.has(row.state)).length>=Number(p.capacity))return null;
    const currentTime=now?.()??Date.now();if(!Number.isSafeInteger(currentTime)||currentTime<0)protocol('root_clock_invalid');
    const eligible=rows.filter(row=>row.state==='queued'&&(row.deadlineAt===undefined||row.deadlineAt>currentTime)&&isEligible(structuredClone(row))===true),human=eligible.find(row=>row.priorityClass==='human_followup'),background=eligible.find(row=>row.priorityClass==='background');
    const selected=human&&(!background||Number(p.human_burst)<3)?human:background??human;if(!selected)return null;
    if(!Number.isSafeInteger(Number(p.claim_seq)+1))protocol('root_sequence_overflow');
    const changed=db.prepare("UPDATE root_resources SET state='reserved',revision=revision+1,generation=1,claim_token=?,attempt_id=? WHERE record_id=? AND revision=? AND generation=0 AND state='queued' AND issuer_epoch=?").run(randomUUID(),randomUUID(),selected.recordId,selected.revision,issuer.runtimeEpoch);if(changed.changes!==1)protocol('root_revision_conflict');
    db.prepare("INSERT INTO root_launch_outbox VALUES(?,0,'pending')").run(selected.recordId);
    const claimed=read(selected.executionKey)!;const claimReceipt={recordId:claimed.recordId,claimToken:claimed.claimToken,attemptId:claimed.attemptId,acquireGeneration:claimed.acquireGeneration,issuerEpoch:claimed.issuerEpoch,metadataDigest:claimed.metadataDigest,claimSeq:Number(p.claim_seq)+1};db.prepare('INSERT INTO root_resource_receipts VALUES(?,?,?,?)').run(claimed.recordId,'reserved',digest(canonical(claimReceipt)),canonical(claimReceipt));
    db.prepare('UPDATE root_resource_policy SET human_burst=?,claim_seq=claim_seq+1 WHERE singleton=1').run(selected.priorityClass==='background'?0:Math.min(3,Number(p.human_burst)+1));return read(selected.executionKey);
   });
  },
  consumeLaunch(input:unknown,ctx:RootResourceContext){
   assertCaller(ctx);return tx(()=>{policy();const record=claimBinding(input),old=receipt(record,'launch_consumed');if(old)return {newlyConsumed:false,receipt:old.value};
    if(record.state!=='reserved')protocol('root_launch_fenced');const outbox=db.prepare('SELECT * FROM root_launch_outbox WHERE record_id=?').get(record.recordId);if(outbox?.state!=='pending')protocol('root_launch_fenced');
    const value={recordId:record.recordId,claimToken:record.claimToken,attemptId:record.attemptId,acquireGeneration:record.acquireGeneration,issuerEpoch:record.issuerEpoch,metadataDigest:record.metadataDigest};
    db.prepare("UPDATE root_launch_outbox SET state='consumed',revision=revision+1 WHERE record_id=? AND revision=? AND state='pending'").run(record.recordId,outbox.revision!);db.prepare('INSERT INTO root_resource_receipts VALUES(?,?,?,?)').run(record.recordId,'launch_consumed',digest(canonical(value)),canonical(value));return {newlyConsumed:true,receipt:value};
   });
  },
  ackStarted(input:unknown,ctx:RootResourceContext):RootResourceRecord {
   assertCaller(ctx);return tx(()=>{policy();const record=claimBinding(input);if(!receipt(record,'launch_consumed'))protocol('root_launch_not_consumed');
    if(record.state==='running'||record.state==='cancel_pending'||record.state==='launch_unknown')return record;if(record.state!=='reserved')protocol('root_claim_conflict');return advance(record,'running');
   });
  },
  markLaunchUnknown(input:unknown,ctx:RootResourceContext):RootResourceRecord {
   assertCaller(ctx);return tx(()=>{policy();const record=claimBinding(input);if(record.state==='cancel_pending'||record.state==='launch_unknown')return record;if(!['reserved','running'].includes(record.state))protocol('root_claim_conflict');return advance(record,'launch_unknown');});
  },
  requestCancel(key:string,ctx:RootResourceContext):RootResourceRecord|null {
   assertCaller(ctx);return tx(()=>{policy();const record=read(key);if(!record)return null;if(record.state==='released'||record.state==='cancelled_before_launch'||record.state==='cancel_pending')return record;
    if(record.state==='queued')return advance(record,'cancelled_before_launch');fence(record);return advance(record,'cancel_pending');});
  },
  finish(proof:object,ctx:RootResourceContext){
   assertCaller(ctx);const parsed=exitFactSchema.safeParse(captureIpcData(verifyExit(proof),'root_exit_unverified'));if(!parsed.success)protocol('root_exit_binding_conflict');const fact=parsed.data;
   return tx(()=>{policy();const record=decode(db.prepare(select+' WHERE r.record_id=?').get(fact.recordId) as unknown as Row|undefined);
    if(!record||!record.claimToken||!['recordId','claimToken','attemptId','acquireGeneration','issuerEpoch','metadataDigest'].every(key=>record[key as keyof RootResourceRecord]===fact[key as keyof RootResourceExitFact])||!hex.safeParse(fact.proofDigest).success)protocol('root_exit_binding_conflict');
    const binding=digest(canonical(fact)),old=receipt(record,'released');if(old){if(old.bindingHash!==binding)protocol('root_exit_binding_conflict');return old.value;}
    if(!activeStates.has(record.state)||fact.outboxRevision!==record.outboxRevision)protocol('root_exit_binding_conflict');
    fence(record);advance(record,'released');const value={recordId:record.recordId,claimToken:record.claimToken,attemptId:record.attemptId,acquireGeneration:record.acquireGeneration,issuerEpoch:record.issuerEpoch,metadataDigest:record.metadataDigest,proofDigest:fact.proofDigest,state:'released',exitFact:fact};
    db.prepare('INSERT INTO root_resource_receipts VALUES(?,?,?,?)').run(record.recordId,'released',binding,canonical(value));return value;
   });
  },
  readReservation(key:string,ctx:RootResourceContext){assertCaller(ctx);policy();return read(key);},
  readPolicy(ctx:RootResourceContext){assertCaller(ctx);const p=policy();return {capacity:Number(p.capacity),queueLimit:Number(p.queue_limit),humanBurst:Number(p.human_burst),enqueueSeq:Number(p.next_seq),claimSeq:Number(p.claim_seq)};},
  setPolicy(input:{capacity:number;queueLimit:number},ctx:RootResourceContext){assertCaller(ctx);const parsed=z.object({capacity:z.number().int().min(1).max(64),queueLimit:z.number().int().min(1).max(4096)}).strict().safeParse(captureIpcData(input,'root_policy_invalid'));if(!parsed.success)protocol('root_policy_invalid');const value=parsed.data;tx(()=>{policy();db.prepare('UPDATE root_resource_policy SET capacity=?,queue_limit=? WHERE singleton=1').run(value.capacity,value.queueLimit);});},
  close(){if(closed)return;db.close();closed=true;},
 });
}
export type RootResourceJournal=ReturnType<typeof createRootResourceJournal>;
