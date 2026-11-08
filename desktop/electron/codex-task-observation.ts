import type { DatabaseSync } from 'node:sqlite';
import type { NativeEvent } from './codex-native-transport.js';
import type { NativeSnapshot } from '../shared/codex-native-types.js';
import type { NativeActor, NativeApprovalInventory, NativeTaskTurn } from './codex-native-service.js';
import type { CodexNativeService } from './codex-native-service.js';
import type { TaskRunnerInput } from '../../src/runtime/task-host/task-runtime-host.js';
import { parseNativeApprovalOwner } from '../../src/runtime/task-host/native-approval-owner.js';
import { assertOriginalCodexBridgeLifecycle, assertOriginalCodexRunObservation } from './codex-task-bridge.js';

type Run={nativeId:string;threadId:string;sessionId:string;turn?:NativeTaskTurn};
type Ticket={input:TaskRunnerInput;run:Run;id:string;initial:NativeSnapshot};
type Service={native:CodexNativeService;actor:NativeActor;runs:Map<string,Run>;closing:boolean};
/** Only the original run() can publish a ticket. No callback/table grants exist. */
export function createCodexRunObservation(owner:unknown,originalTicket:unknown) {
  assertOriginalCodexRunObservation(owner,originalTicket);
  const service=owner as Service,{input,run,id,initial}=originalTicket as Ticket;
  const offsets=new Map(initial.messages.map(m=>[m.id,m.text.length])),questions=new Set<string>();
  let answer='',started=false,settled=false,closed=false,chain=Promise.resolve();
  const eventBase={sessionId:input.sessionId,turnId:input.taskId,intentId:'codex',stepId:'codex'};
  let resolve!:()=>void,reject!:(e:unknown)=>void;const done=new Promise<void>((a,b)=>{resolve=a;reject=b;});
  void done.catch(()=>{});
    const pump=async()=>{
      if(closed||settled)return;assertOriginalCodexRunObservation(owner,originalTicket);const view=service.native.get(service.actor,id);
      let inventory:NativeApprovalInventory|undefined;
      if(run.turn)try{
        service.native.assertTaskTurnCurrent(service.actor,run.turn);
        inventory=service.native.readApprovalInventory(service.actor,id);
      }catch(error){
        if(!(error instanceof Error)||!['native_access_denied','native_task_turn_stale','native_approval_inventory_unavailable'].includes(error.message))throw error;
        // Unknown is not an empty inventory. The original terminal source will
        // close the work after the original send/receipt actually settles.
      }
      if(inventory){
        const current=()=>{
          if(service.closing||service.runs.get(input.taskId)!==run||!run.turn)return false;
          try{service.native.assertTaskTurnCurrent(service.actor,run.turn);service.native.assertApprovalInventoryCurrent(service.actor,inventory!);return true;}
          catch(error){if(error instanceof Error&&['native_access_denied','native_task_turn_stale','native_approval_inventory_stale','native_approval_inventory_unavailable'].includes(error.message))return false;throw error;}
        };
        for(const a of inventory.questions)if(!questions.has(a.token)){
          if(!current())return;
          const owner=parseNativeApprovalOwner({schemaVersion:1,kind:'codex_native_approval',taskSessionId:input.sessionId,nativeIncarnation:inventory.incarnation,
            nativeSessionId:inventory.sessionId,nativeThreadId:inventory.nativeThreadId,nativeTurnId:inventory.turnId,nativeTurnGeneration:inventory.generation,approvalToken:a.token,requestDigest:a.requestDigest});
          questions.add(a.token);await input.emitRuntimeEvent({type:'approval_required',...eventBase,approvalId:a.token,prompt:a.description,owner,choices:[{id:'approve',label:'允许一次 / Allow once'},{id:'deny',label:'拒绝 / Deny'}]});
        }
        for(const token of [...questions])if(!inventory.questions.some(a=>a.token===token)){
          if(!current())return;
          questions.delete(token);await input.emitRuntimeEvent({type:'approval_resolved',...eventBase,approvalId:token});
        }
      }
      if(!started)return;
      for(const m of view.messages){if(m.role!=='assistant')continue;const from=offsets.get(m.id)??0;const delta=m.text.slice(from);offsets.set(m.id,m.text.length);if(delta){answer+=delta;await input.emitRuntimeEvent({type:'assistant_delta',...eventBase,delta});}}
      if(view.status==='error'){reject(new Error(view.error||'native_execution_failed'));return;}
      if(view.status==='idle'&&view.queued===0){settled=true;await input.emitRuntimeEvent({type:'receipt_emitted',...eventBase,note:JSON.stringify({summary:answer,artifacts:[]})});resolve();}
    };
    const event=(event:NativeEvent)=>{
      if(closed)return;assertOriginalCodexRunObservation(owner,originalTicket);
      const item=event.params?.item;if(!item||!['commandExecution','fileChange','mcpToolCall'].includes(item.type))return;
      const toolName=`codex.${item.type}`;
      if(event.method==='item/started') chain=chain.then(()=>input.emitRuntimeEvent({type:'pre_tool_use',...eventBase,toolName,toolUseId:item.id,toolInput:item})).catch(reject);
      if(event.method==='item/completed') {
        const failed=item.status==='failed'||item.status==='declined'||(typeof item.exitCode==='number'&&item.exitCode!==0);
        chain=chain.then(()=>input.emitRuntimeEvent(failed
          ? {type:'post_tool_use_failure',...eventBase,toolName,toolUseId:item.id,toolInput:item,error:String(item.aggregatedOutput??item.error??item.status)}
          : {type:'post_tool_use',...eventBase,toolName,toolUseId:item.id,toolInput:item,toolResponse:item.aggregatedOutput??item})).catch(reject);
      }
    };
  return Object.freeze({done,event,notify(){if(!closed)chain=chain.then(pump).catch(reject);},start(){if(closed)throw Error('CODEX_RUN_OBSERVER_RETIRED');started=true;},fail(raw:unknown){reject(raw);},waitChain(){return chain;},retire(){closed=true;}});
}

/** Pure display context; it supplies no Source, actor, callback or SDK grant. */
export function codexTaskPrompt(input:TaskRunnerInput,initial:NativeSnapshot,priorOwned:boolean|undefined):string {
  const needsContext=!initial.messages.length||priorOwned===false;
  const history=needsContext&&input.history.length?`Previous conversation context:\n${JSON.stringify(input.history)}\n\n`:'';
  const attachments=input.materials.map(m=>`${m.originalName}: ${m.workspacePath}`).join('\n');
  return `${history}${input.prompt}${attachments?`\n\nAttached working copies:\n${attachments}`:''}`;
}

export function assertCodexTaskRoute(owner:unknown,input:{taskId:string;threadId:string;sessionId?:string},actor:NativeActor):void {
  assertOriginalCodexBridgeLifecycle(owner);
  const service=owner as Service&{db:DatabaseSync;authorize(actor:NativeActor):void};service.authorize(actor);
  const route=service.db.prepare('SELECT thread_id FROM routes WHERE task_id=?').get(input.taskId);
  if(!route||route.thread_id!==input.threadId||input.sessionId!==undefined&&service.runs.get(input.taskId)?.sessionId!==input.sessionId)throw Error('native_task_route_forbidden');
}
