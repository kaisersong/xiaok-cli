import {captureIntentData} from './data.js';
import {canonicalVerificationJson as json} from '../verification/protocol.js';
export interface IntentProducerOrigin {kind:'model-report';providerInvocationId:string;toolInvocationId:string}
export type IntentProducerAction = {kind:'step-report';stepId:string;status:'running'|'blocked'|'completed'|'failed';breadcrumb:string;receiptNote:string|null;blockedReason:string|null;origin:IntentProducerOrigin}
 | {kind:'artifact-report';stageId:string;kindOfArtifact:'markdown'|'report'|'slides'|'summary'|'analysis'|'document'|'unknown';storage:'inline'|'file_ref';label:string;path:string|null;inlineValue:string|null;summary:string|null;reportedStructuralValidation:'pending'|'passed'|'failed';reportedSemanticValidation:'pending'|'passed'|'failed';origin:IntentProducerOrigin};
export interface IntentProducerReport {protectionMode:'ordinary'|'protected';action:IntentProducerAction;requestSource:'user'|'agent'|'scheduler';now:number;artifactId:string|null}
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v)<=160&&!/[\x00-\x1f\x7f]/.test(v);
function shape(v:unknown,keys:string):asserts v is Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(' ').sort().join(','))throw Error('intent_producer_shape');}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
export function parseIntentProducerAction(raw:unknown):Readonly<IntentProducerAction>{const value=captureIntentData(raw) as IntentProducerAction;json(raw);
 const a=value;shape(a,a?.kind==='step-report'?'kind stepId status breadcrumb receiptNote blockedReason origin':'kind stageId kindOfArtifact storage label path inlineValue summary reportedStructuralValidation reportedSemanticValidation origin');shape(a.origin,'kind providerInvocationId toolInvocationId');
 if(a.origin.kind!=='model-report'||!id(a.origin.providerInvocationId)||!id(a.origin.toolInvocationId))throw Error('intent_producer_origin');
 if(a.kind==='step-report'){if(!id(a.stepId)||!['running','blocked','completed','failed'].includes(a.status)||typeof a.breadcrumb!=='string'||![a.receiptNote,a.blockedReason].every(v=>v===null||typeof v==='string'))throw Error('intent_producer_step');}
 else if(a.kind==='artifact-report'){if(!id(a.stageId)||!['markdown','report','slides','summary','analysis','document','unknown'].includes(a.kindOfArtifact)||!['inline','file_ref'].includes(a.storage)||typeof a.label!=='string'||![a.path,a.inlineValue,a.summary].every(v=>v===null||typeof v==='string')||![a.reportedStructuralValidation,a.reportedSemanticValidation].every(v=>['pending','passed','failed'].includes(v))||(a.storage==='inline'?(a.inlineValue===null||a.path!==null):(a.path===null||a.inlineValue!==null)))throw Error('intent_producer_artifact');}
 else throw Error('intent_producer_action');
return freeze(value);}
export function parseIntentProducerReport(raw:unknown):Readonly<IntentProducerReport>{
 const value=captureIntentData(raw) as IntentProducerReport;json(raw);shape(value,'protectionMode action requestSource now artifactId');
 if(!['ordinary','protected'].includes(value.protectionMode)||!['user','agent','scheduler'].includes(value.requestSource)||!Number.isSafeInteger(value.now)||value.now<0)throw Error('intent_producer_report');
 value.action=parseIntentProducerAction(value.action);
 if(value.action.kind==='step-report'?value.artifactId!==null:!id(value.artifactId))throw Error('intent_producer_report_artifact');
 return freeze(value);
}
