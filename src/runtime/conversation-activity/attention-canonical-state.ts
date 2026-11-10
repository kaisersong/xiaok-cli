import {createHash,randomUUID} from 'node:crypto';
import {nativeQuestionReference} from './native-question-data.js';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod/v3';
import type {OrdinaryStateFact} from './ordinary-attention-facts.js';
import {ordinaryStateFactSchema} from './ordinary-attention-facts.js';
import {nativeAttentionInventorySchema,type NativeTerminalAttentionInventory} from './native-attention-inventory-data.js';

const key=z.string().min(1).max(256),version=z.number().int().positive().safe(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const ordinaryReason=(state:OrdinaryStateFact['executionState'],outcome:OrdinaryStateFact['businessOutcome'])=>state==='input_required'?'input_required'
 :state==='blocked'||state==='failed'||outcome==='error'?'ordinary_work_blocked':state==='accepted'||state==='queued'?'queued':undefined;
const mcpAttentionInventorySchema=z.object({watchId:key,readerIncarnation:z.string().uuid(),taskStatus:z.enum(['working','input_required','completed','failed','cancelled']),
 businessOutcome:z.enum(['unknown','success','error','cancelled']),questions:z.array(z.object({inputId:key,expectedDigest:digest}).strict()).max(32)}).strict().superRefine((value,context)=>{
 if((value.taskStatus==='input_required')!==(value.questions.length>0)||new Set(value.questions.map(item=>item.inputId)).size!==value.questions.length)
  context.addIssue({code:z.ZodIssueCode.custom,message:'attention_inventory_incomplete'});
});
export const attentionInventorySchema=z.union([mcpAttentionInventorySchema,nativeAttentionInventorySchema]);
export type AttentionInventory=z.infer<typeof attentionInventorySchema>;
export type AttentionCanonicalInventory=AttentionInventory|NativeTerminalAttentionInventory;
export const ATTENTION_CANONICAL_SQL=`
CREATE TABLE IF NOT EXISTS activity_attention_core_facts(anchor_id TEXT NOT NULL,version INTEGER NOT NULL,incarnation TEXT NOT NULL,data_json TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(anchor_id,version));
CREATE TABLE IF NOT EXISTS activity_attention_core_heads(anchor_id TEXT PRIMARY KEY,incarnation TEXT NOT NULL UNIQUE,version INTEGER NOT NULL,core_json TEXT NOT NULL,seen_json TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_attention_question_facts(anchor_id TEXT NOT NULL,input_id TEXT NOT NULL,version INTEGER NOT NULL,incarnation TEXT NOT NULL,digest TEXT NOT NULL,is_open INTEGER NOT NULL,PRIMARY KEY(anchor_id,input_id,version));
CREATE TABLE IF NOT EXISTS activity_attention_question_heads(anchor_id TEXT NOT NULL,input_id TEXT NOT NULL,incarnation TEXT NOT NULL UNIQUE,version INTEGER NOT NULL,digest TEXT NOT NULL,is_open INTEGER NOT NULL,PRIMARY KEY(anchor_id,input_id));
CREATE INDEX IF NOT EXISTS activity_attention_question_open ON activity_attention_question_heads(anchor_id,is_open);
${['core','question'].map(kind=>`
CREATE TRIGGER IF NOT EXISTS activity_attention_${kind}_fact_update BEFORE UPDATE ON activity_attention_${kind}_facts BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_${kind}_fact_delete BEFORE DELETE ON activity_attention_${kind}_facts BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_${kind}_head_delete BEFORE DELETE ON activity_attention_${kind}_heads BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_${kind}_head_insert BEFORE INSERT ON activity_attention_${kind}_heads
 WHEN EXISTS(SELECT 1 FROM activity_attention_${kind}_heads WHERE anchor_id=NEW.anchor_id ${kind==='question'?'AND input_id=NEW.input_id':''})
 BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;`).join('')}
CREATE TRIGGER IF NOT EXISTS activity_attention_core_fact_insert BEFORE INSERT ON activity_attention_core_facts
 WHEN EXISTS(SELECT 1 FROM activity_attention_core_facts WHERE anchor_id=NEW.anchor_id AND version=NEW.version) BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_question_fact_insert BEFORE INSERT ON activity_attention_question_facts
 WHEN EXISTS(SELECT 1 FROM activity_attention_question_facts WHERE anchor_id=NEW.anchor_id AND input_id=NEW.input_id AND version=NEW.version) BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_core_head_update BEFORE UPDATE ON activity_attention_core_heads
 WHEN NEW.anchor_id IS NOT OLD.anchor_id OR NEW.incarnation IS NOT OLD.incarnation OR NOT(NEW.version=OLD.version AND NEW.core_json=OLD.core_json OR NEW.version=OLD.version+1)
 BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
CREATE TRIGGER IF NOT EXISTS activity_attention_question_head_update BEFORE UPDATE ON activity_attention_question_heads
 WHEN NEW.anchor_id IS NOT OLD.anchor_id OR NEW.input_id IS NOT OLD.input_id OR NEW.incarnation IS NOT OLD.incarnation
 OR NOT(NEW.version=OLD.version AND NEW.digest=OLD.digest AND NEW.is_open=OLD.is_open OR NEW.version=OLD.version+1 AND (NEW.digest<>OLD.digest OR NEW.is_open<>OLD.is_open))
 BEGIN SELECT RAISE(ABORT,'attention_canonical_immutable'); END;
`;
const coreSchema=z.object({executionState:z.enum(['accepted','queued','running','blocked','input_required','completed','failed','cancelled']),businessOutcome:z.enum(['unknown','success','error','cancelled'])}).strict();
const coreHeadSchema=z.object({anchor_id:key,incarnation:z.string().uuid(),version,core_json:z.string(),seen_json:z.string(),digest}).strict();
const questionHeadSchema=z.object({anchor_id:key,input_id:key,incarnation:z.string().uuid(),version,digest,is_open:z.union([z.literal(0),z.literal(1)])}).strict();
const seenSchema=z.array(z.tuple([key,key])).max(513).refine(items=>new Set(items.map(item=>item[0])).size===items.length);
const canonicalFactSchema=z.object({schemaVersion:z.literal(1),factId:key,revision:version,core:coreSchema,observations:z.array(ordinaryStateFactSchema).min(1).max(512)}).strict();

/** Shared original ordinary lineage; callers supply only facts read under the
 * original Store transaction. A new alias is first-seen, while a changed
 * existing observation advances the canonical version even after an ABA. */
function canonicalOrdinaryCore(db:DatabaseSync,anchorId:string,facts:OrdinaryStateFact[],lineage?:{id:string;receipt:string}){
 const written=(result:{changes:number|bigint})=>{if(result.changes!==1&&result.changes!==1n)throw Error('attention_canonical_integrity_failed');};
 if(!facts.length)throw Error('attention_source_unverified');
 const core=coreSchema.parse({executionState:facts[0].executionState,businessOutcome:facts[0].businessOutcome}),coreJson=JSON.stringify(core);
 if(facts.some(fact=>fact.executionState!==core.executionState||fact.businessOutcome!==core.businessOutcome))throw Error('attention_source_unverified');
 const raw=db.prepare('SELECT * FROM activity_attention_core_heads WHERE anchor_id=?').get(anchorId),head=raw?coreHeadSchema.parse(raw):null;
 if(!head&&db.prepare('SELECT 1 FROM activity_attention_core_facts WHERE anchor_id=? LIMIT 1').get(anchorId))throw Error('attention_canonical_integrity_failed');
 const seen=head?new Map(seenSchema.parse(JSON.parse(head.seen_json))):new Map<string,string>();
 if(head&&head.digest!==hash([head.incarnation,head.version,head.core_json,head.seen_json]))throw Error('attention_canonical_integrity_failed');
 if(head){
  const stored=db.prepare('SELECT data_json,digest,incarnation FROM activity_attention_core_facts WHERE anchor_id=? AND version=?').get(anchorId,head.version) as {data_json:string;digest:string;incarnation:string}|undefined;
  if(!stored||stored.incarnation!==head.incarnation||stored.digest!==hash(stored.data_json))throw Error('attention_canonical_integrity_failed');
  const fact=canonicalFactSchema.safeParse(JSON.parse(stored.data_json));
  if(!fact.success||fact.data.factId!==`canonical-state:${head.incarnation}`||fact.data.revision!==head.version||JSON.stringify(fact.data.core)!==head.core_json)throw Error('attention_canonical_integrity_failed');
 }
 let changed=!head||head.core_json!==coreJson;
 for(const fact of facts){const old=seen.get(fact.watchId);if(old!==undefined&&old!==fact.factId)changed=true;seen.set(fact.watchId,fact.factId);}
 if(lineage){if(seen.get(lineage.id)!==lineage.receipt)changed=true;seen.set(lineage.id,lineage.receipt);}

 const entries=[...seen].sort(([a],[b])=>compare(a,b));seenSchema.parse(entries);const seenJson=JSON.stringify(entries);
 const nextVersion=changed?(head?.version??0)+1:head!.version;version.parse(nextVersion);const incarnation=head?.incarnation??randomUUID(),factId=`canonical-state:${incarnation}`;
 if(changed){const data=JSON.stringify({schemaVersion:1,factId,revision:nextVersion,core,observations:facts});
  written(db.prepare('INSERT INTO activity_attention_core_facts VALUES(?,?,?,?,?)').run(anchorId,nextVersion,incarnation,data,hash(data)));}
 const checksum=hash([incarnation,nextVersion,coreJson,seenJson]);
 if(head){const result=db.prepare('UPDATE activity_attention_core_heads SET version=?,core_json=?,seen_json=?,digest=? WHERE anchor_id=? AND version=? AND incarnation=?').run(nextVersion,coreJson,seenJson,checksum,anchorId,head.version,incarnation);if(result.changes!==1)throw Error('attention_canonical_integrity_failed');}
 else written(db.prepare('INSERT INTO activity_attention_core_heads VALUES(?,?,?,?,?,?)').run(anchorId,incarnation,nextVersion,coreJson,seenJson,checksum));

 return {canonicalRef:{factId,revision:nextVersion},core};
}
function ordinarySourceFacts(core:z.infer<typeof coreSchema>,ref:{factId:string;revision:number}){
 const reasonCode=ordinaryReason(core.executionState,core.businessOutcome);
 return reasonCode?[{profile:'activity' as const,schemaVersion:1,factId:ref.factId,revision:ref.revision,reasonCode,evidenceRefs:[`${ref.factId}:${ref.revision}`]}]:[];
}
/** Ordinary project facts do not imply a task inventory or fabricate questions. */
export function canonicalOrdinaryAttentionState(db:DatabaseSync,anchorId:string,facts:OrdinaryStateFact[]){
 const state=canonicalOrdinaryCore(db,anchorId,facts);return{canonicalRef:state.canonicalRef,sourceFacts:ordinarySourceFacts(state.core,state.canonicalRef)};
}

/** Called only inside the original activity transaction, after complete source
 * membership, native reader and source-core validation. No callback or owner. */
export function canonicalAttentionState(db:DatabaseSync,anchorId:string,facts:OrdinaryStateFact[],inventory:AttentionCanonicalInventory){
 if(!facts.length)throw Error('attention_source_unverified');
 const core=coreSchema.parse({executionState:facts[0].executionState,businessOutcome:facts[0].businessOutcome}),coreJson=JSON.stringify(core);
 if(facts.some(fact=>fact.executionState!==core.executionState||fact.businessOutcome!==core.businessOutcome))throw Error('attention_source_unverified');
 const expectedState=inventory.taskStatus==='working'?'running':inventory.taskStatus;
 const native='sourceKind'in inventory;
 if(((!native||inventory.sourceKind==='codex_native_terminal')&&expectedState!==core.executionState)||inventory.businessOutcome!==core.businessOutcome)throw Error('attention_inventory_source_conflict');
 const lineage=native?{id:'@native:'+hash(inventory.reference),receipt:hash(inventory.sourceKind==='codex_native_approval'
  ?[inventory.sourceKind,inventory.reference,inventory.inventoryRevision,inventory.inventoryDigest]
  :[inventory.sourceKind,inventory.reference,inventory.terminalReceipt.eventKey,inventory.taskStatus,inventory.businessOutcome])}:undefined;
 const {canonicalRef}=canonicalOrdinaryCore(db,anchorId,facts,lineage);

 function question(inputId:string,nextDigest:string,isOpen:0|1){
  const raw=db.prepare('SELECT * FROM activity_attention_question_heads WHERE anchor_id=? AND input_id=?').get(anchorId,inputId),head=raw?questionHeadSchema.parse(raw):null;
  if(!head&&db.prepare('SELECT 1 FROM activity_attention_question_facts WHERE anchor_id=? AND input_id=? LIMIT 1').get(anchorId,inputId))throw Error('attention_question_integrity_failed');
  if(head){const fact=db.prepare('SELECT incarnation,digest,is_open FROM activity_attention_question_facts WHERE anchor_id=? AND input_id=? AND version=?').get(anchorId,inputId,head.version) as {incarnation:string;digest:string;is_open:number}|undefined;
   if(!fact||fact.incarnation!==head.incarnation||fact.digest!==head.digest||fact.is_open!==head.is_open)throw Error('attention_question_integrity_failed');}
  const changed=!head||head.digest!==nextDigest||head.is_open!==isOpen,nextVersion=changed?(head?.version??0)+1:head!.version;version.parse(nextVersion);const incarnation=head?.incarnation??randomUUID();
  if(changed)db.prepare('INSERT INTO activity_attention_question_facts VALUES(?,?,?,?,?,?)').run(anchorId,inputId,nextVersion,incarnation,nextDigest,isOpen);
  if(head){const result=db.prepare('UPDATE activity_attention_question_heads SET version=?,digest=?,is_open=? WHERE anchor_id=? AND input_id=? AND version=? AND incarnation=?').run(nextVersion,nextDigest,isOpen,anchorId,inputId,head.version,incarnation);if(result.changes!==1)throw Error('attention_question_integrity_failed');}
  else db.prepare('INSERT INTO activity_attention_question_heads VALUES(?,?,?,?,?,?)').run(anchorId,inputId,incarnation,nextVersion,nextDigest,isOpen);
  return {questionRef:native?nativeQuestionReference(anchorId,inputId):'mcp-question:'+hash([anchorId,inputId]),ownerKind:native?'task_host' as const:'mcp' as const,answerApiRef:native?'answerQuestion' as const:'mcpAnswer' as const,sourceRevision:nextVersion,permissionRef:(native?'native-source:':'mcp-source:')+hash(anchorId)};
 }
 const questionId=(inputId:string)=>native?'native:'+inputId:inputId;
 const currentIds=new Set(inventory.questions.map(item=>questionId(item.inputId)));
 const open=db.prepare('SELECT * FROM activity_attention_question_heads WHERE anchor_id=? AND is_open=1 LIMIT 33').all(anchorId).map(row=>questionHeadSchema.parse(row));
 if(open.length>32)throw Error('attention_inventory_capacity');
 for(const old of open)if(!currentIds.has(old.input_id))question(old.input_id,old.digest,0);
 const questions=[...inventory.questions].sort((a,b)=>compare(a.inputId,b.inputId)).map(item=>question(questionId(item.inputId),item.expectedDigest,1));
 return {canonicalRef,questions,sourceFacts:ordinarySourceFacts(core,canonicalRef)};
}
