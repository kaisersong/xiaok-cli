import {readDshAuthorityColdRow} from '../multi-agent/dsh-admission-cold-data.js';
import {DSH_A_AUTHORITY_TABLES} from '../multi-agent/dsh-admission-authority-data.js';
import {DSH_A_AUTHORITY_PROFILE,DSH_A_AUTHORITY_DIGEST,DSH_A_AUTHORITY_SQL_HASH,assertDshProfileAncestry,assertDshBindingHistory,dshProfileAncestryHash,dshAuthorityRowHash} from '../multi-agent/dsh-admission-authority-data.js';
import {DSH_A_PROFILE,DSH_A_DIGEST,dshAJson,dshAHash,dshASourceKey,dshAInputKey,dshAObjectKey,validateDshAStoredBody,type DshARecord} from '../multi-agent/dsh-admission-data.js';
import {createHash} from 'node:crypto';
import {captureApprovalOperation,captureWorkspaceAuthorization,captureApprovalEvent} from '../multi-agent/approval-records.js';
import {encodeMultiAgentRow} from '../multi-agent/row-codec.js';
import {freezeCapturedData,parseCapturedSourceJson} from './captured-source-json.js';
import type {CapturedSqliteCell} from './source-sqlite-cell.js';

export interface CapturedGroupsRow {readonly table:string;readonly rowid:string;readonly cells:Readonly<Record<string,CapturedSqliteCell>>;readonly json:Readonly<Record<string,unknown>>}
function fail():never{throw Error('captured_groups_row');}
export function groupsObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail();return value as Record<string,unknown>;}
function number(cell:CapturedSqliteCell|undefined):number{if(cell?.type==='integer'){const n=BigInt(cell.value);if(n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER))return Number(n);}if(cell?.type==='real'){const n=Buffer.from(cell.value,'hex').readDoubleBE();if(Number.isFinite(n))return n;}fail();}
const sqlDataKeys=Object.keys,sqlDataDefine=Object.defineProperty;
export function capturedGroupsSqlData(cells:Readonly<Record<string,CapturedSqliteCell>>):Record<string,unknown>{const raw:Record<string,unknown>={},names=sqlDataKeys(cells);for(let i=0;i<names.length;i++){const name=names[i]!,cell=cells[name]!;sqlDataDefine(raw,name,{__proto__:null,value:cell.type==='null'?null:cell.type==='text'?cell.value:cell.type==='integer'?number(cell):undefined,enumerable:true} as PropertyDescriptor);}return raw;}
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
 if(table==='dsh_a_profile'){if(number(cells.singleton)!==1||!(text(cells.profile)===DSH_A_PROFILE&&text(cells.digest)===DSH_A_DIGEST||text(cells.profile)===DSH_A_AUTHORITY_PROFILE&&text(cells.digest)===DSH_A_AUTHORITY_DIGEST)||!/^[a-f0-9-]{36}$/.test(text(cells.store_id)))fail();}
 else if(table==='dsh_a_profile_migrations'||table==='dsh_a_source_binding_revisions'){
  const body=groupsObject(json.data_json),raw=text(cells.data_json);
  if(dshAJson(body)!==raw||!same(cells.logical_bytes,Buffer.byteLength(raw)))fail();
  if(table==='dsh_a_profile_migrations'){
   assertDshProfileAncestry(body);
   const spec={migration_id:'migrationId',store_id:'storeId',from_version:'fromVersion',from_profile:'fromProfile',from_digest:'fromDigest',to_version:'toVersion',to_profile:'toProfile',to_digest:'toDigest'};
   for(const [column,key]of Object.entries(spec))if(!same(cells[column],body[key]))fail();
   if(!same(cells.ddl_hash,DSH_A_AUTHORITY_SQL_HASH)||!same(cells.body_hash,dshProfileAncestryHash(body)))fail();
  }else{
   assertDshBindingHistory(body);
   if(!same(cells.binding_id,body.bindingId)||!same(cells.binding_revision,body.bindingRevision)||!same(cells.source_key,body.sourceKey)||!same(cells.body_hash,dshAuthorityRowHash(table,body)))fail();
  }
 } else if(table==='dsh_a_source_bindings'||table==='dsh_a_inbox'||table==='dsh_a_input_proofs'||table==='dsh_a_object_heads'){
  const body=groupsObject(json.data_json),raw=text(cells.data_json);validateDshAStoredBody(table,body);if(dshAJson(body)!==raw||!same(cells.logical_bytes,Buffer.byteLength(raw)))fail();
  if(table==='dsh_a_source_bindings'){const binding=body.binding as DshARecord;if(!same(cells.binding_id,binding.bindingId)||!same(cells.source_key,dshASourceKey(binding.provider,binding.authScope as DshARecord))||!same(cells.revision,body.revision))fail();}
  if(table==='dsh_a_inbox'){const envelope=body.envelope as DshARecord;if(!same(cells.input_id,body.inputId)||!same(cells.input_key,dshAInputKey(envelope))||!same(cells.binding_id,(envelope.thread as DshARecord).sourceBindingId)||!same(cells.object_id,dshAObjectKey(envelope)))fail();}
  if(table==='dsh_a_input_proofs'&&(!same(cells.proof_hash,dshAHash(body))||!same(cells.proof_version,body.provenanceVersion)))fail();
  if(table==='dsh_a_object_heads'&&(!same(cells.object_id,body.objectId)||!same(cells.revision,body.revision)))fail();
 }else if((DSH_A_AUTHORITY_TABLES as readonly string[]).includes(table)){
  readDshAuthorityColdRow(table,capturedGroupsSqlData(cells));
 }else if(indexes[table]){
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
