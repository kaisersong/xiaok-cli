import type {RoomWorkspaceSnapshot} from '../shared/room-workspace-contract.js';
import type {TimedActionRecord,OverdueRecoveryContext} from './timed-action-types.js';

export function createRoomScheduledTaskDispatch(options:{
  getWorkspace:(roomId:string)=>Promise<RoomWorkspaceSnapshot>;
  sendWake:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;
  dispatch:(input:{roomId:string;roomMessageId:string;logicalAgentIds:string[]})=>Promise<unknown>;
  onError?:(error:unknown)=>void;
}) {
  return async (action:TimedActionRecord,context:OverdueRecoveryContext):Promise<{taskId:string}>=>{
    if(action.executor.kind!=='agent_task'||!action.executor.roomTarget)throw new Error('room_schedule_target_required');
    if(!action.userApprovedAuto)throw new Error('room_schedule_approval_required');
    const target=action.executor.roomTarget,snapshot=await options.getWorkspace(target.roomId);
    if(!snapshot.ok||snapshot.phase!=='active'||!snapshot.permissions.canRead||snapshot.bindingId!==target.bindingId||snapshot.generation!==target.generation)throw new Error('room_schedule_binding_unavailable');
    const result=await options.sendWake({roomId:target.roomId,targetAgentId:target.logicalAgentId,text:action.executor.prompt,scheduleId:action.id,idempotencyKey:`scheduled:${action.id}:${context.scheduledDueAt}`});
    if(!result.ok&&result.code!=='room_message_duplicate')throw new Error(String(result.code??'room_schedule_dispatch_failed'));
    const message=result.message as {messageId?:string}|undefined;
    if(!message?.messageId)throw new Error('room_schedule_message_missing');
    // Same admission model as ordinary background tasks: scheduler owns durable
    // delivery; workspace runtime owns the newly admitted execution and cleanup.
    setImmediate(()=>{void options.dispatch({roomId:target.roomId,roomMessageId:message.messageId!,logicalAgentIds:[target.logicalAgentId]}).catch(error=>options.onError?.(error));});
    return {taskId:message.messageId};
  };
}
