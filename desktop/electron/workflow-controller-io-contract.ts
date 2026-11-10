import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
const keys=Reflect.ownKeys,own=Object.hasOwn,isArray=Array.isArray,encode=encodeURIComponent,json=JSON.stringify;
export type WorkflowControllerOperation='read_run'|'create_proposal'|'start_run'|'complete'|'parallel_group'|'reserve_budget'|'budget_event'|'budget_remaining'|'verify_evidence'|'node_action'|'retry_node'|'create_node';
export interface WorkflowControllerRequest {kind:WorkflowControllerOperation;body?:unknown;nodeId?:string}
function id(raw:unknown):string{if(typeof raw!=='string'||!raw||raw.length>256||raw.trim()!==raw||raw.includes('\0'))throw Error('KSWARM_WORKFLOW_SUBJECT_INVALID');return raw;}
/** Fixed route planner only. It grants neither business permission nor N. */
export function compileWorkflowControllerRequest(projectId:string,runId:string|null,raw:unknown):{path:string;method:'GET'|'POST';body:string|undefined}{
 const p=id(projectId),run=runId===null?null:id(runId),value=captureDispatchBusinessData(raw);if(!value||typeof value!=='object'||isArray(value))throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');const r=value as Record<string,unknown>;
 const read=r.kind==='read_run'||r.kind==='budget_remaining',node=r.kind==='verify_evidence'||r.kind==='node_action'||r.kind==='retry_node',expected=read?['kind']:node?['kind','nodeId','body']:['kind','body'];const actual=keys(r);if(actual.length!==expected.length)throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');for(let i=0;i<actual.length;i++){let found=false;for(let j=0;j<expected.length;j++)if(actual[i]===expected[j])found=true;if(!found)throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');}
 const base='/projects/'+encode(p)+'/workflows/';let path:string;
 if(r.kind==='create_proposal'||r.kind==='start_run'){if(run!==null)throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');path=base+'script-generated/'+(r.kind==='create_proposal'?'proposal':'runs');}
 else{if(run===null)throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');const prefix=base+encode(run);if(r.kind==='read_run')path=prefix;else if(r.kind==='budget_remaining')path=prefix+'/budget/remaining';else if(r.kind==='complete')path=prefix+'/script/complete';else if(r.kind==='parallel_group')path=prefix+'/script/parallel-groups';else if(r.kind==='reserve_budget')path=prefix+'/budget/reserve';else if(r.kind==='budget_event')path=prefix+'/budget/events';else if(r.kind==='create_node')path=prefix+'/script/nodes';else if(node){const nodeId=encode(id(r.nodeId));path=prefix+(r.kind==='retry_node'?'/script/nodes/':'/nodes/')+nodeId+(r.kind==='retry_node'?'/retry':r.kind==='verify_evidence'?'/verify-evidence':'/action');}else throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');}
 return {path,method:read?'GET':'POST',body:read?undefined:json(r.body)};
}
/** Existing controller call sites convert only their exact bound route. There
 * is no URL, method, query, header or authority field in the transport DTO. */
export function workflowControllerOperationForRoute(projectId:string,runId:string|null,path:string,init?:RequestInit):WorkflowControllerRequest{
 const get=(init?.method??'GET')==='GET',body=get?undefined:JSON.parse(typeof init?.body==='string'?init.body:'null');
 const kinds:WorkflowControllerOperation[]=['read_run','create_proposal','start_run','complete','parallel_group','reserve_budget','budget_event','budget_remaining','verify_evidence','node_action','retry_node','create_node'];
 for(let i=0;i<kinds.length;i++){const kind=kinds[i]!;if(kind==='verify_evidence'||kind==='node_action'||kind==='retry_node')continue;const candidate:WorkflowControllerRequest=kind==='read_run'||kind==='budget_remaining'?{kind}:{kind,body};try{const plan=compileWorkflowControllerRequest(projectId,runId,candidate);if(plan.path===path&&plan.method===(get?'GET':'POST'))return candidate;}catch{/* Local fixed route alternatives only. */}}
 if(runId!==null){const prefix='/projects/'+encode(id(projectId))+'/workflows/'+encode(id(runId));for(const [kind,start,end]of [['verify_evidence','/nodes/','/verify-evidence'],['node_action','/nodes/','/action'],['retry_node','/script/nodes/','/retry']] as const){if(path.startsWith(prefix+start)&&path.endsWith(end)){const raw=path.slice((prefix+start).length,-end.length),nodeId=decodeURIComponent(raw);const candidate={kind,nodeId,body};if(compileWorkflowControllerRequest(projectId,runId,candidate).path===path&&!get)return candidate;}}}
 throw Error('KSWARM_WORKFLOW_REQUEST_INVALID');
}
void own;
