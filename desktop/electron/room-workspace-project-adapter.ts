import {isAbsolute,relative,sep} from 'node:path';
import {realpath,stat} from 'node:fs/promises';
import {workspaceDigest} from './room-workspace-local.js';
import type {RoomWorkspaceExecutionContext} from './room-workspace-executor.js';

export interface WorkspaceProjectMapping {
  projectId:string;roomId:string;workspaceId:string;originHostId:string;bindingId:string;
  generation:number;mappingRevision:number;state:string;workFolder:string;artifactsDir:string;
  directoryIdentities?:Record<string,{dev:number;ino:number}>;
}
export interface WorkspaceProjectTask extends Record<string,unknown> {id:string;assignedAgent?:string;activeRunId?:string;status?:string}
export interface WorkspaceProjectResolution {
  project:Record<string,unknown>;mapping:WorkspaceProjectMapping;task?:WorkspaceProjectTask;tasks:WorkspaceProjectTask[];
}
export interface WorkspaceProjectJournal {
  getRecord<T>(kind:string,key:string):T|null|undefined;
  saveRecord(kind:string,key:string,value:unknown):void;
  listRecords?<T>(kind:string):T[];
}
export interface WorkspaceProjectAdapter {
  listDispatchCandidates(projectId:string):Promise<{roomId:string;tasks:Array<{taskId:string;logicalAgentId:string}>}|null>;
  resolve(input:{roomId:string;projectId:string;logicalAgentId:string;taskId?:string}):Promise<WorkspaceProjectResolution>;
  authorize(context:RoomWorkspaceExecutionContext,taskId?:string):Promise<WorkspaceProjectResolution>;
  dispatch(context:RoomWorkspaceExecutionContext,taskId:string,signal?:AbortSignal):Promise<Record<string,unknown>>;
  submit(context:RoomWorkspaceExecutionContext,taskId:string,result:Record<string,unknown>):Promise<Record<string,unknown>>;
  retryPending():Promise<void>;
}
type Pending={context:RoomWorkspaceExecutionContext;taskId:string;submissionId:string;payloadDigest:string;result:Record<string,unknown>;ticketId?:string;applied?:boolean};
const inside=(root:string,target:string)=>{const rel=relative(root,target);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`);};

/** Main-only service transport. KSwarm performs the current member check and
 * owns mapping/task/result data; this adapter never writes Room artifacts. */
export function createRoomWorkspaceProjectAdapter(options:{
  kswarmRequest(path:string,init?:RequestInit):Promise<Response>;
  broker:{request(roomId:string,action:string,input:Record<string,unknown>):Promise<Record<string,unknown>>};
  journal:WorkspaceProjectJournal;
}):WorkspaceProjectAdapter {
  const pendingKeys=new Set<string>();
  async function json(path:string,init?:RequestInit){
    const response=await options.kswarmRequest(path,init);
    const body=await response.json() as Record<string,unknown>;
    if(!response.ok||body.ok===false)throw new Error(String(body.error??body.code??'workspace_project_unavailable'));
    return body;
  }
  const post=(projectId:string,action:string,body:unknown)=>json(`/projects/${encodeURIComponent(projectId)}/workspace-${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  async function resolve(input:{roomId:string;projectId:string;logicalAgentId:string;taskId?:string}):Promise<WorkspaceProjectResolution>{
    const value=await json(`/projects/${encodeURIComponent(input.projectId)}/workspace-mapping?logicalAgentId=${encodeURIComponent(input.logicalAgentId)}`);
    const project=value.project as Record<string,unknown>,mapping=value.mapping as WorkspaceProjectMapping;
    if(!project||project.id!==input.projectId||project.primaryRoomId!==input.roomId||project.requiredProtocol!=='room_workspace_v1')throw new Error('workspace_project_scope_mismatch');
    if(!mapping||mapping.state!=='active'||mapping.projectId!==input.projectId||mapping.roomId!==input.roomId)throw new Error('workspace_project_mapping_required');
    for(const key of ['workFolder','artifactsDir'] as const){
      if(!isAbsolute(mapping[key])||await realpath(mapping[key])!==mapping[key])throw new Error('workspace_project_directory_unavailable');
      const current=await stat(mapping[key]),identity=mapping.directoryIdentities?.[key];
      if(!current.isDirectory()||identity&&(current.dev!==identity.dev||current.ino!==identity.ino))throw new Error('workspace_project_directory_unavailable');
    }
    if(!inside(mapping.workFolder,mapping.artifactsDir))throw new Error('workspace_project_artifacts_outside_workfolder');
    const tasks=Array.isArray(value.tasks)?value.tasks as WorkspaceProjectTask[]:[];
    const task=input.taskId?tasks.find(t=>t.id===input.taskId||t.id===`${input.projectId}__${input.taskId}`):undefined;
    if(input.taskId&&(!task||task.assignedAgent!==input.logicalAgentId))throw new Error('workspace_project_task_forbidden');
    return {project,mapping,tasks,task};
  }
  async function authorize(context:RoomWorkspaceExecutionContext,taskId?:string){
    if(context.contextScope.kind!=='project')throw new Error('workspace_project_scope_required');
    const value=await resolve({roomId:context.roomId,projectId:context.contextScope.projectId,logicalAgentId:context.logicalAgentId,taskId});
    for(const key of ['roomId','workspaceId','originHostId','bindingId','generation','mappingRevision'] as const)if(context[key]!==value.mapping[key])throw new Error('workspace_project_mapping_changed');
    if(context.effectiveCwd!==value.mapping.workFolder)throw new Error('workspace_project_cwd_mismatch');
    return value;
  }
  async function apply(key:string,pending:Pending,allowNew=false){
    if(pending.applied)return {ok:true,reused:true};
    if(!pending.ticketId){
      let issued=await options.broker.request(pending.context.roomId,'recover-ticket',{claimId:pending.context.claimId,submissionId:pending.submissionId,payloadDigest:pending.payloadDigest});
      if(!issued.ok){
        if(issued.code!=='workspace_ticket_mismatch'||!allowNew)throw new Error(String(issued.code??'workspace_project_ticket_unavailable'));
        await authorize(pending.context,pending.taskId);
        issued=await options.broker.request(pending.context.roomId,'agent-ticket',{logicalAgentId:pending.context.logicalAgentId,claimId:pending.context.claimId,submissionId:pending.submissionId,payloadDigest:pending.payloadDigest});
      }
      const ticket=issued.ticket as {ticketId?:string;payloadDigest?:string;submissionId?:string;roomId?:string;bindingId?:string;generation?:number;contextScope?:unknown;subject?:{claimId?:string}}|undefined;
      if(!issued.ok||!ticket?.ticketId||ticket.payloadDigest!==pending.payloadDigest||ticket.subject?.claimId!==pending.context.claimId||ticket.submissionId!==pending.submissionId||ticket.roomId!==pending.context.roomId||ticket.bindingId!==pending.context.bindingId||ticket.generation!==pending.context.generation||JSON.stringify(ticket.contextScope)!==JSON.stringify(pending.context.contextScope))throw new Error(String(issued.code??'workspace_project_ticket_mismatch'));
      pending.ticketId=ticket.ticketId;options.journal.saveRecord('project-result',key,pending);
    }
    // This is historical application, not a fresh execution grant. A cancellation
    // ordered after the durable ticket must not discard the authorized result.
    const projectId=pending.context.contextScope.kind==='project'?pending.context.contextScope.projectId:'';
    const result=await post(projectId,'result',{taskId:pending.taskId,claimId:pending.context.claimId,ticketId:pending.ticketId,submissionId:pending.submissionId,payloadDigest:pending.payloadDigest,result:pending.result});
    pending.applied=true;options.journal.saveRecord('project-result',key,pending);pendingKeys.delete(key);
    return result;
  }
  return {
    resolve,authorize,
    async listDispatchCandidates(projectId){
      const value=await json(`/projects/${encodeURIComponent(projectId)}/workspace-mapping?dispatchCandidates=true`);
      const project=value.project as Record<string,unknown>|undefined;
      if(project?.requiredProtocol!=='room_workspace_v1')return null;
      if(typeof project.primaryRoomId!=='string')throw new Error('workspace_project_scope_mismatch');
      const mapping=value.mapping as WorkspaceProjectMapping|null;
      if(!mapping||mapping.state!=='active')throw new Error('workspace_project_mapping_required');
      const candidates=Array.isArray(value.dispatchCandidates)?value.dispatchCandidates as WorkspaceProjectTask[]:[];
      return {roomId:project.primaryRoomId,tasks:candidates.filter(t=>typeof t.id==='string'&&typeof t.assignedAgent==='string').map(t=>({taskId:t.id,logicalAgentId:t.assignedAgent!}))};
    },
    async dispatch(context,taskId,signal){
      const value=await authorize(context,taskId);
      signal?.throwIfAborted();
      if(!value.task||context.taskId!==value.task.id)throw new Error('workspace_project_task_claim_mismatch');
      return post(value.mapping.projectId,'dispatch',{taskId:value.task.id,claimId:context.claimId,redeliver:true});
    },
    async submit(context,taskId,result){
      if(context.contextScope.kind!=='project'||!context.taskId)throw new Error('workspace_project_task_claim_required');
      const key=workspaceDigest('project-result-key',{projectId:context.contextScope.projectId,claimId:context.claimId});
      const taskKey=String(context.taskId);
      if(taskId!==taskKey&&`${context.contextScope.projectId}__${taskId}`!==taskKey)throw new Error('workspace_project_task_claim_mismatch');
      const canonicalResult=JSON.parse(JSON.stringify(result)) as Record<string,unknown>;
      const payloadDigest=workspaceDigest('project-result',{projectId:context.contextScope.projectId,taskId:taskKey,claimId:context.claimId,runId:context.runId,result:canonicalResult});
      const prior=options.journal.getRecord<Pending>('project-result',key);
      if(prior&&prior.payloadDigest!==payloadDigest)throw new Error('workspace_project_result_conflict');
      const pending=prior??{context:structuredClone(context),taskId:taskKey,submissionId:context.runId,payloadDigest,result:canonicalResult};
      options.journal.saveRecord('project-result',key,pending);pendingKeys.add(key);return apply(key,pending,true);
    },
    async retryPending(){
      for(const pending of options.journal.listRecords?.<Pending>('project-result')??[]){if(!pending.applied&&pending.context.contextScope.kind==='project')pendingKeys.add(workspaceDigest('project-result-key',{projectId:pending.context.contextScope.projectId,claimId:pending.context.claimId}));}
      await Promise.allSettled([...pendingKeys].map(async key=>{const pending=options.journal.getRecord<Pending>('project-result',key);if(pending)await apply(key,pending);}));
    },
  };
}
