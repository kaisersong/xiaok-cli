import {createHash} from 'node:crypto';
import {captureApprovalOperation,captureWorkspaceAuthorization,captureApprovalEvent} from '../multi-agent/approval-records.js';
import {encodeMultiAgentRow} from '../multi-agent/row-codec.js';
import {freezeCapturedData,parseCapturedSourceJson} from './captured-source-json.js';
import type {CapturedSqliteCell} from './source-sqlite-cell.js';

export interface CapturedGroupsRow {readonly table:string;readonly rowid:string;readonly cells:Readonly<Record<string,CapturedSqliteCell>>;readonly json:Readonly<Record<string,unknown>>}
function fail():never{throw Error('captured_groups_row');}
export function groupsObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail();return value as Record<string,unknown>;}
function number(cell:CapturedSqliteCell|undefined):number{if(cell?.type==='integer'){const n=BigInt(cell.value);if(n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER))return Number(n);}if(cell?.type==='real'){const n=Buffer.from(cell.value,'hex').readDoubleBE();if(Number.isFinite(n))return n;}fail();}
function text(cell:CapturedSqliteCell|undefined):string{if(cell?.type!=='text')fail();return cell.value;}
/** SQL INTEGER affinity is not an assertion about original business clocks.
 * Compare original JSON numbers against exact captured cells, never round a
 * captured integer through Number before checking its meaning. */
function same(cell:CapturedSqliteCell|undefined,value:unknown):boolean{
 if(!cell)return false;if(value===undefined||value===null)return cell.type==='null';
 if(typeof value==='string')return cell.type==='text'&&cell.value===value;
 if(typeof value==='number'&&Number.isFinite(value)){
  if(cell.type==='integer')return Number.isInteger(value)&&BigInt(value)===BigInt(cell.value);
  if(cell.type==='real')return Buffer.from(cell.value,'hex').readDoubleBE()===value;
 }
 return false;
}
const indexes:Readonly<Record<string,Readonly<Record<string,string>>>>={
  activity_runs:{run_id:'runId',group_id:'groupId'},
  activity_members:{run_id:'runId',member_id:'memberId',group_id:'groupId'},
 groups:{group_id:'groupId',thread_id:'threadId',boot_id:'bootId',created_at:'createdAt'},
 agents:{agent_id:'id',parent_id:'parentId',created_at:'createdAt'},
 events:{group_id:'groupId',seq:'seq',event_id:'eventId',agent_id:'agentId'},
 contents:{content_id:'contentId',group_id:'groupId',agent_id:'agentId'},
 messages:{message_id:'messageId',group_id:'groupId',receiver_id:'receiverId',delivery_state:'deliveryState',claim_id:'claimId',turn_id:'turnId',created_at:'createdAt'},
 operations:{group_id:'groupId',operation_id:'operationId'},
 root_turns:{source_task_id:'sourceTaskId',group_id:'groupId',preparation_id:'preparationId',boot_id:'bootId'},
 managed_resources:{resource_id:'resourceId',group_id:'groupId',agent_id:'agentId'},
};
export function readCapturedGroupsRow(table:string,row:Readonly<{rowid:string;record:Readonly<Record<string,CapturedSqliteCell>>}>):CapturedGroupsRow{
 const cells=row.record,json:Record<string,unknown>={};
 for(const[name,cell]of Object.entries(cells))if(name.endsWith('_json')&&cell.type!=='null')json[name]=parseCapturedSourceJson(text(cell));
 if(indexes[table]){
  const raw=text(cells.data_json),body=groupsObject(json.data_json);
  if(encodeMultiAgentRow(body)!==raw||!same(cells.logical_bytes,Buffer.byteLength(raw)))fail();
  for(const[column,key]of Object.entries(indexes[table]!))if(!Object.hasOwn(body,key)||!same(cells[column],body[key]))fail();
  if(table==='groups'&&(typeof body.historicalOnly!=='boolean'||!same(cells.historical_only,Number(body.historicalOnly))))fail();
  if(table==='messages'){
   const sender=groupsObject(body.sender);if(!['agent','user'].includes(String(sender.kind))||!same(cells.sender_kind,sender.kind)||!same(cells.sender_agent_id,sender.kind==='agent'?sender.agentId:null)||!same(cells.sender_actor_id,sender.kind==='user'?sender.actorId:null))fail();
  }
  if(table==='operations'&&body.command==='approval_request')captureApprovalOperation(body);
  if(table==='events'&&body.kind==='approval')captureApprovalEvent(body.payload);
  if(table==='contents'){
   if(typeof body.utf8Text!=='string'||Buffer.byteLength(body.utf8Text)!==body.byteLength||createHash('sha256').update(body.utf8Text).digest('hex')!==body.sha256)fail();
  }
 }else if(!['thread_bindings','boot_owners','workspace_execution_authorizations'].includes(table))fail();
 if(table==='workspace_execution_authorizations'){
  const allowed=number(cells.execution_allowed);if(allowed!==0&&allowed!==1)fail();
  captureWorkspaceAuthorization({profileId:text(cells.profile_id),workspaceId:text(cells.workspace_id),permissionRevision:number(cells.permission_revision),executionAllowed:allowed===1,updatedAt:number(cells.updated_at),actorId:cells.actor_id?.type==='null'?null:text(cells.actor_id),lastReceiptJson:cells.last_receipt_json?.type==='null'?null:text(cells.last_receipt_json)});
 }
 return Object.freeze({table,rowid:row.rowid,cells,json:freezeCapturedData(json)});
}
