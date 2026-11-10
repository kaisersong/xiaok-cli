import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalVerificationJson} from '../../src/runtime/verification/protocol.js';
import {captureIpcData} from './ipc-data-snapshot.js';

// Closed metadata only. The original owners supply authority separately.
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(512),revision=z.number().int().nonnegative().safe();
const policy=z.enum(['plan_only','auto_activate_after_plan','activate_and_dispatch_after_plan']);
const scope=z.object({profileId:hash,workspaceId:hash}).strict();
export const COMPOSITE_CLAIM=z.object({protocol:z.literal('ordinary_initial_plan_additive_v2'),fromAgent:id,enqueueKey:id,planRunId:z.string().uuid(),planGeneration:z.literal(1),expectedPlanInputRevision:revision,expectedProjectControlDigest:hash,startPolicy:policy}).strict();
const source=z.object({family:z.enum(['goal_turn','main_user_submission']),profileId:hash,workspaceId:hash,threadId:id,canonicalUserTaskId:id,canonicalMessageId:id,bodyHash:hash,identityDigest:hash,sourceTaskId:id,sourceSessionId:id}).strict();
const preparationFields={phase:z.literal('prepared'),projectId:id,operationId:z.string().regex(/^ordinary-input:[a-f0-9]{64}$/),envelopeDigest:hash,inputDigest:hash,ownerBindingDigest:hash,
 taskOwner:z.object({projectId:id,scope,writerStoreId:z.string().uuid(),bindingDigest:hash,createReceiptDigest:hash,contract:z.literal('ordinary_initial_plan_additive_v2')}).strict(),
 expectedProjectRevision:revision.refine(n=>n>0),source,trigger:z.object({actorId:id,triggerRef:z.string().regex(/^main-explicit-planning:[a-f0-9-]{36}$/)}).strict(),claimRequest:COMPOSITE_CLAIM,createdAt:z.number().finite(),preparationDigest:hash};
export const COMPOSITE_PREPARATION=z.discriminatedUnion('schemaVersion',[z.object({schemaVersion:z.literal(1),...preparationFields}).strict(),z.object({schemaVersion:z.literal(2),...preparationFields,proposalDigest:hash}).strict()]);
export type KSwarmTaskCompositePreparation=z.infer<typeof COMPOSITE_PREPARATION>;
export function compositeDigest(value:unknown):string{return createHash('sha256').update(canonicalVerificationJson(value)).digest('hex');}
export function readCompositePreparation(value:unknown):KSwarmTaskCompositePreparation{
 const parsed=COMPOSITE_PREPARATION.safeParse(captureIpcData(value,'bootstrap_composite_journal_invalid'));if(!parsed.success)throw Error('bootstrap_composite_journal_invalid');
 const {preparationDigest,...data}=parsed.data;
 if(preparationDigest!==compositeDigest(data)||data.taskOwner.projectId!==data.projectId||data.source.profileId!==data.taskOwner.scope.profileId||data.source.workspaceId!==data.taskOwner.scope.workspaceId
  ||data.operationId!==taskCompositeOperationId(data.projectId,data.source))throw Error('bootstrap_composite_journal_invalid');
 return parsed.data;
}
export function taskCompositeOperationId(projectId:string,source:Pick<KSwarmTaskCompositePreparation['source'],'profileId'|'workspaceId'|'threadId'|'canonicalUserTaskId'|'canonicalMessageId'>):string{
 return 'ordinary-input:'+compositeDigest(['ordinary-input-v1',source.profileId,source.workspaceId,projectId,source.threadId,source.canonicalUserTaskId,source.canonicalMessageId]);
}
/** Capture caller proposal data before an await. B still validates task semantics
 * and allocates every durable task identity through its original factory. */
export function captureTaskCompositeProposal(value:unknown):Record<string,unknown>{
 const proposal=captureIpcData(value,'bootstrap_composite_proposal_invalid');
 if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||Object.keys(proposal).some(key=>!['title','brief','tasks'].includes(key)))throw Error('bootstrap_composite_proposal_invalid');
 const p=proposal as Record<string,unknown>;
 if(Object.hasOwn(p,'tasks')){
  if(Object.hasOwn(p,'title')||Object.hasOwn(p,'brief')||!Array.isArray(p.tasks)||p.tasks.length<1||p.tasks.length>200)throw Error('bootstrap_composite_proposal_invalid');
  const fields=['title','brief','description','requirements','acceptanceCriteria','assignedAgent','assignee','dependencies','dependencyPolicy','phaseId','type','maxAttempts','maxQualityReworks','requiredOutputs','requiredCapabilities','executionGateSchemaVersion','executionContract','evidenceContract','composite','requiresIndependentReview','reviewAgent','reviewBrief','finalBrief'];
  for(let i=0;i<p.tasks.length;i++){if(!Object.hasOwn(p.tasks,i))throw Error('bootstrap_composite_proposal_invalid');const task=p.tasks[i];if(!task||typeof task!=='object'||Array.isArray(task)||Object.keys(task).some(key=>!fields.includes(key))||typeof task.title!=='string'||!task.title.trim())throw Error('bootstrap_composite_proposal_invalid');}
 }else{
  for(const key of ['title','brief'])if(Object.hasOwn(p,key)&&(typeof p[key]!=='string'||Buffer.byteLength(p[key] as string,'utf8')>(key==='title'?4096:65536)))throw Error('bootstrap_composite_proposal_invalid');
 }
 if(Buffer.byteLength(canonicalVerificationJson(p),'utf8')>2*1024*1024)throw Error('bootstrap_composite_proposal_invalid');
 return p;
}
