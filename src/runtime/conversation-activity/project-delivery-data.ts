import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {z} from 'zod/v3';

const key=z.string().min(1).max(256),sequence=z.number().int().nonnegative().safe();
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const incarnation=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const PROJECT_ACTIVITY_BODY_LIMIT=2*1024*1024;
function invalid():never {throw Error('activity_project_page_invalid');}

/** A transport value is JSON data, never an executable getter or proxy. The
 * original source body has its own byte bound before this synchronous pass. */
function capture(value:unknown,budget={nodes:0,bytes:0},parents=new Set<object>(),depth=0):unknown {
  if(++budget.nodes>100000||depth>64)invalid();
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){
    budget.bytes+=Buffer.byteLength(value);if(budget.bytes>PROJECT_ACTIVITY_BODY_LIMIT)invalid();return value;
  }
  if(typeof value==='number'){if(!Number.isFinite(value))invalid();return value;}
  if(!value||typeof value!=='object'||types.isProxy(value)||parents.has(value)||Object.getOwnPropertySymbols(value).length)invalid();
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)invalid();
  const fields=Object.getOwnPropertyDescriptors(value);
  if(Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')||Object.getOwnPropertyDescriptor(Array.prototype,'toJSON'))invalid();
  if(array&&(Object.keys(fields).length!==(value as unknown[]).length+1
    ||Object.keys(fields).some(name=>name!=='length'&&!/^(0|[1-9][0-9]*)$/.test(name))))invalid();
  const result:Record<string,unknown>|unknown[]=array?[]:Object.create(null);
  parents.add(value);
  for(const [name,field] of Object.entries(fields)){
    if(array&&name==='length')continue;
    if(!Object.hasOwn(field,'value')||!field.enumerable)invalid();
    budget.bytes+=Buffer.byteLength(name);if(budget.bytes>PROJECT_ACTIVITY_BODY_LIMIT)invalid();
    Object.defineProperty(result,name,{value:capture(field.value,budget,parents,depth+1),enumerable:true,writable:true,configurable:true});
  }
  parents.delete(value);return result;
}

const lifecycle=z.enum(['created','planning','ready_to_start','active','running','blocked','ready_to_deliver','delivered','closed','legacy_needs_reconciliation','unknown']);
const action=z.enum(['review_final_deliverable','confirm_final_deliverable','revise_plan','resolve_project_blocker','activate_project']);
const coreSchema=z.object({stage:z.enum(['none','ready_for_acceptance','unavailable']),lifecycleState:lifecycle,action:action.nullable(),
  diagnostics:z.array(key).max(32),evidenceRefs:z.array(key).max(128)}).strict();
const headSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('project_delivery_attention'),projectId:key,sourceDataEpoch:incarnation,
  incarnation,deliveryRevision:sequence.refine(value=>value>0),factId:key,semanticDigest:digest,inputDigest:digest,core:coreSchema,recordDigest:digest}).strict();
export type ProjectDeliveryHead=z.infer<typeof headSchema>;
export type ProjectDeliveryRead={status:'current';head:ProjectDeliveryHead}|{status:'unavailable';reasonCode:'SNAPSHOT_INCOMPLETE'};
const unavailable=():ProjectDeliveryRead=>({status:'unavailable',reasonCode:'SNAPSHOT_INCOMPLETE'});

// Same documented canonical JSON domain as the original B producer. This
// validates integrity only; a matching hash is never a source capability.
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(name=>[name,canonical((value as Record<string,unknown>)[name])]));
  return value;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sortedUnique=(values:string[])=>values.every((value,index)=>index===0||values[index-1]!<value);
function delivery(raw:unknown,expected:{projectId:string;sourceDataEpoch:string},snapshot:{status:string;deliveredAt:number|null}):ProjectDeliveryRead {
  const envelope=z.object({status:z.literal('current'),head:headSchema}).strict().safeParse(raw);
  if(!envelope.success)return unavailable();
  const head=envelope.data.head,{recordDigest,...record}=head;
  if(head.projectId!==expected.projectId||head.sourceDataEpoch!==expected.sourceDataEpoch
    ||!sortedUnique(head.core.diagnostics)||!sortedUnique(head.core.evidenceRefs)
    ||head.factId!=='project-delivery:'+hash([expected.projectId,expected.sourceDataEpoch,head.incarnation,head.deliveryRevision])
    ||head.semanticDigest!==hash(['project-delivery-attention-v1',head.core,head.inputDigest])||recordDigest!==hash(record)
    ||Buffer.byteLength(JSON.stringify(head))>65536)return unavailable();
  if(head.core.stage==='ready_for_acceptance'&&(head.core.lifecycleState!=='ready_to_deliver'||head.core.action!=='review_final_deliverable'
    ||head.core.evidenceRefs.length===0||['closed','delivered'].includes(snapshot.status)||snapshot.deliveredAt!==null
    ||head.core.diagnostics.some(code=>['legacy_status_drift','legacy_final_deliverable_needs_confirmation'].includes(code))))return unavailable();
  return{status:'current',head};
}

/** Stored head integrity only. Actual snapshot disposition, source permission,
 * membership and current reader are separate original-owner prerequisites. */
export function parseProjectDeliveryHeadData(raw:unknown,expected:{projectId:string;sourceDataEpoch:string}):ProjectDeliveryHead|undefined {
  const data=capture({raw,expected}) as {raw:unknown;expected:Record<string,unknown>};
  if(!data.expected||typeof data.expected!=='object'||typeof data.expected.projectId!=='string'||typeof data.expected.sourceDataEpoch!=='string')invalid();
  const result=delivery({status:'current',head:data.raw},{projectId:data.expected.projectId,sourceDataEpoch:data.expected.sourceDataEpoch},{status:'unknown',deliveredAt:null});
  return result.status==='current'?result.head:undefined;
}

const eventSchema=z.object({schemaVersion:z.literal(1),eventId:z.string().min(1).max(512),source:z.literal('kswarm'),workId:key,
  sourceSequence:sequence.refine(value=>value>0),sourceDataEpoch:key,sourceRevision:key,
  kind:z.enum(['accepted','started','progress','input_required','artifact_available','heartbeat','blocked','completed','failed','cancelled']),
  occurredAt:sequence,sourceType:key,evidenceRefs:z.array(key).max(128),summary:z.string().max(1024).optional(),taskId:key.optional(),executionStarted:z.literal(true).optional()}).strict();
const pageSchema=z.object({ok:z.literal(true),sourceDataEpoch:key,retainedFromSeq:sequence.refine(value=>value>0),headSeq:sequence,gap:z.boolean(),
  gapRanges:z.array(z.object({from:sequence.refine(value=>value>0),through:sequence.refine(value=>value>0),
    reason:z.enum(['retention_expired','progress_compacted','mixed_retention_compaction'])}).strict()).max(4096),
  coveredThrough:sequence,nextCursor:sequence,snapshotRevision:key,
  snapshot:z.object({id:key,name:z.string().max(65536),status:key,projectRevision:sequence,primaryRoomId:key.nullable(),deliveredAt:sequence.nullable(),
    preparation:key.nullable(),mapping:key.nullable(),tasks:z.array(z.object({id:key,status:key,attempt:sequence}).strict()).max(20000)}).strict(),
  events:z.array(eventSchema).max(200),delivery:z.unknown().optional()}).strict();
export type ParsedProjectActivityPage=Omit<z.infer<typeof pageSchema>,'delivery'>&{delivery:ProjectDeliveryRead};

/** Pure bounded parsing. No private reader witness, database write, execution
 * permission or ready UI qualification is issued by this data function. */
export function parseProjectActivityPage(raw:unknown,expected:{projectId:string;sourceDataEpoch:string;after:number}):ParsedProjectActivityPage {
  const captured=capture(expected);
  if(!captured||typeof captured!=='object'||Array.isArray(captured))invalid();
  const audience=captured as Record<string,unknown>;
  if(typeof audience.projectId!=='string'||typeof audience.sourceDataEpoch!=='string'||typeof audience.after!=='number')invalid();
  expected={projectId:audience.projectId,sourceDataEpoch:audience.sourceDataEpoch,after:audience.after};
  if(!key.safeParse(expected.projectId).success||!key.safeParse(expected.sourceDataEpoch).success||!sequence.safeParse(expected.after).success)invalid();
  const data=capture(raw);
  if(Buffer.byteLength(JSON.stringify(data))>PROJECT_ACTIVITY_BODY_LIMIT)invalid();
  const parsed=pageSchema.safeParse(data);if(!parsed.success)invalid();const page=parsed.data;
  if(page.sourceDataEpoch!==expected.sourceDataEpoch||page.snapshot.id!==expected.projectId||page.snapshotRevision!==String(page.headSeq)
    ||page.nextCursor!==page.coveredThrough||page.nextCursor>page.headSeq||page.nextCursor<expected.after||page.retainedFromSeq>page.headSeq+1)invalid();
  const coverage:Array<{from:number;through:number}>=[];let previous=expected.after;
  for(const event of page.events){
    if(event.workId!==expected.projectId||event.sourceDataEpoch!==expected.sourceDataEpoch||event.sourceSequence<=previous||event.sourceSequence<page.retainedFromSeq||event.sourceSequence>page.nextCursor
      ||event.eventId!==expected.projectId+'#'+event.sourceSequence||event.sourceRevision!==String(event.sourceSequence)
      ||event.executionStarted&&(event.kind!=='progress'||event.sourceType!=='task.progress'||!event.taskId))invalid();
    previous=event.sourceSequence;coverage.push({from:previous,through:previous});
  }
  let gapThrough=expected.after;
  for(const range of page.gapRanges){if(range.from<=gapThrough||range.through<range.from||range.through>page.nextCursor)invalid();gapThrough=range.through;coverage.push(range);}
  coverage.sort((a,b)=>a.from-b.from);let through=expected.after;
  for(const range of coverage){if(range.from!==through+1)invalid();through=range.through;}
  if(through!==page.nextCursor||page.gap!==(expected.after<page.retainedFromSeq-1||page.gapRanges.length>0))invalid();
  return{...page,delivery:delivery(page.delivery,expected,page.snapshot)};
}
