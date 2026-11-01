/** Main-process-only integration module. Never expose these objects through IPC.
 * Current production composition lacks readonlyAdmission: attachment fails before
 * services are created and before any model/network request. No runner is injected.
 */
import {appendFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readJson,inside,digest} from './harness.mjs';

const terminal=new Set(['completed','failed','cancelled']);
export async function attachMainHarness({sessionRoot,kswarmService,readonlyAdmission,bindLaunchService}){
 const session=readJson(join(sessionRoot,'session.json')),plan=readJson(join(sessionRoot,'plan.json'));
 if(realpathSync(session.root)!==realpathSync(sessionRoot)||!inside(sessionRoot,session.dataRoot)||!inside(sessionRoot,session.workspace)||!inside(sessionRoot,session.configDir))throw Error('isolated_session_required');
 const eventPath=join(sessionRoot,'events.jsonl');
 const append=value=>appendFileSync(eventPath,JSON.stringify({schemaVersion:1,at:new Date().toISOString(),pid:process.pid,...value})+'\n',{mode:0o600});
 append({type:'owner_started',source:'main',modelCalls:0});
 // A default PermissionManager, a prompt, OS chmod, an allowlisted tool *description*,
 // or a boolean from renderer is NOT this port. Production must own and enforce it.
 if(!readonlyAdmission){append({type:'blocked',code:'foreground_readonly_ceiling_missing',modelCalls:0});throw Error('foreground_readonly_ceiling_missing');}
 if(process.env.XIAOK_CONFIG_DIR!==session.configDir)throw Error('private_config_dir_required_before_import');
 for(const method of ['inspect','run','assertCurrent','close'])if(typeof readonlyAdmission[method]!=='function')throw Error('readonly_admission_contract_missing');
 const proof=await readonlyAdmission.inspect({workspaceRoot:session.workspace,dataRoot:session.dataRoot,permissionMode:'default'});
 if(proof?.mode!=='read_only'||proof.permissionMode!=='default'||proof.defaultRunner!==true||proof.foregroundAdmission!==true||proof.allDescendants!==true||proof.externalEffectsDenied!==true||proof.globalStoresIsolated!==true||proof.callBudgetEnforced!==true||!proof.evidencePaths?.length)throw Error('readonly_admission_unproven');
 // The proof is audit metadata; run/assertCurrent MUST be the actual main-owned
 // capability owner. Do not fabricate this object to force a run.
 append({type:'readonly_preflight',proof});
 const {createDesktopServices}=await import('../../desktop/electron/desktop-services.ts');
 const {AssistantLaunchService}=await import('../../desktop/electron/assistant-launch-service.ts');
 const services=createDesktopServices({dataRoot:session.dataRoot,workspaceRoot:session.workspace,kswarmService});
 let launch;
 const issued=new Map(),inflight=new Set();let closed=false,stopReason=null,knownTokens=0;
 const started=performance.now();
 const lookup=taskId=>services.assistantTaskAdmission.lookup(taskId);
 const boundary=()=>{if(closed||stopReason)throw Error(stopReason??'harness_closed');if(performance.now()-started>plan.budgets.maxWallMs)throw Error('wall_budget_exhausted');if(issued.size>=plan.budgets.maxRootAdmissions)throw Error('admission_budget_exhausted');if(inflight.size)throw Error('singleflight_required');readonlyAdmission.assertCurrent(proof);};
 const withScope=action=>readonlyAdmission.run({proof,permissionMode:'default',workspaceRoot:session.workspace,dataRoot:session.dataRoot,maxTaskMs:plan.budgets.maxTaskMs,maxToolIterations:plan.budgets.maxToolIterations,maxKnownTotalTokens:plan.budgets.maxKnownTotalTokens,maxKnownCostUsd:plan.budgets.maxKnownCostUsd},action);
 async function runRow({rowId,proposal,humanObservation=null,sourceClass='real_current_publication'}){
  boundary();const row=plan.rows.find(r=>r.id===rowId);if(!row||issued.has(rowId))throw Error('unplanned_or_already_issued');
  if(!['ordinary','double_confirm','lookup_after_reply_loss'].includes(row.scenario))throw Error('scenario_requires_real_restart_or_block_repair_owner_touchpoints');
  if(row.path==='C'&&sourceClass!=='real_current_publication')throw Error('synthetic_source_not_real_C');
  const t0=performance.now();issued.set(rowId,{taskId:null});inflight.add(rowId);
  append({type:'admission_started',rowId,path:row.path,instructionDigest:row.instructionDigest,workspace:session.workspace,permissionMode:'default',sourceClass,humanObservation});
  let taskId=null,operationId=null,draftId=null,apiCalls=0,status='unknown',snapshot,failedCode=null,needsInput=null,detachApproval=()=>{};
  const inputObserved=new AbortController();
  try{
   await withScope(async()=>{
    if(row.path==='C'){
     if(!launch){launch=await bindLaunchService({services,dataRoot:session.dataRoot,workspaceRoot:session.workspace});if(!(launch instanceof AssistantLaunchService))throw Error('real_launch_service_required');}
     if(!proposal?.id||!Number.isSafeInteger(proposal.revision))throw Error('real_current_proposal_required');
     apiCalls++;const draft=await launch.prepare({proposalId:proposal.id,expectedRevision:proposal.revision,requestSource:'user'});draftId=draft.id;
     // Same exact bytes across A/B/C, and no existing-thread/Goal inheritance.
     if(draft.instruction!==row.instruction||draft.domain.cwd!==session.workspace||draft.threadTarget)throw Error('matched_instruction_workspace_new_thread_required');
     append({type:'prepared',rowId,draftId,instructionDigest:digest(draft.instruction)});
     const confirmation={draftId,instruction:row.instruction,requestSource:'user'};
     apiCalls++;let op;
     if(row.scenario==='double_confirm'){
      apiCalls++;const receipts=await Promise.all([launch.confirm(confirmation),launch.confirm(confirmation)]);
      if(receipts[0].operationId!==receipts[1].operationId||receipts[0].taskId!==receipts[1].taskId)throw Error('duplicate_confirmation_identity_mismatch');op=receipts[0];
     }else if(row.scenario==='lookup_after_reply_loss'){
      // Deliberately withhold the actual confirm receipt from the harness consumer.
      // This is controlled response-loss injection, not a real network incident.
      await launch.confirm(confirmation);apiCalls++;op=(await launch.get({draftId,requestSource:'user'})).operation;
      if(!op)throw Error('lookup_after_withheld_receipt_unknown');
      append({type:'fault_injection',rowId,kind:'controlled_confirm_receipt_withheld',syntheticFault:true,realAdmission:true});
     }else op=await launch.confirm(confirmation);
     operationId=op.operationId;taskId=op.taskId;
     append({type:'launch_receipt',rowId,draftId,operationId,taskId,state:op.state,threadId:op.threadId});
     if(!taskId)throw Error('launch_not_attached');
    }else{
     // A and B share the real send admission; B's prefill is observed in the GUI.
     apiCalls++;({taskId}=await services.createTask({prompt:row.instruction,materials:[],permissionMode:'default',watchdogMs:plan.budgets.maxTaskMs,maxToolLoopIterations:plan.budgets.maxToolIterations}));
    }
    issued.set(rowId,{taskId,draftId,operationId});
    append({type:'task_bound',rowId,taskId,operationId,draftId});
    if(services.multiAgent){
     const multi=services.multiAgent,actual=await lookup(taskId),threadId=actual?.context?.threadId;
     if(!threadId)throw Error('actual_thread_unavailable');
     const access=multi.service.createUserAccess({requestSource:'user',actorId:`desktop-user:${multi.profileId}`,threadId,profileId:multi.profileId,workspaceId:multi.workspaceId});
     const observeApproval=()=>{const current=multi.service.getSnapshot({access});if(current.pendingApprovalCount>0){needsInput={kind:'tool_approval',approvalIds:(current.pendingApprovals??[]).map(item=>item.approvalId)};append({type:'needs_input',rowId,taskId,...needsInput,autogrant:false});inputObserved.abort();}};
     detachApproval=multi.service.subscribe(access,observeApproval);observeApproval();
    }
    const signal=AbortSignal.any([inputObserved.signal,AbortSignal.timeout(plan.budgets.maxTaskMs)]);
    for await(const event of services.subscribeTask(taskId,{signal})){
     // Raw task records remain private in dataRoot/tasks; no console/provider secrets.
     append({type:'task_event',rowId,taskId,eventType:event.type,eventDigest:digest(JSON.stringify(event))});
     if(event.type==='needs_user'){needsInput={kind:'question',questionId:event.question.questionId};append({type:'needs_input',rowId,taskId,...needsInput,autogrant:false});inputObserved.abort();break;}
     if(event.type==='task_terminal')break;
    }
    snapshot=await lookup(taskId);status=snapshot?.status??'unknown';
    if(!terminal.has(status))throw Error('terminal_receipt_unknown');
    if(row.path==='C'){
     const binding=snapshot.assistantBinding;if(binding?.operationId!==operationId||binding?.threadId!==snapshot.context?.threadId)throw Error('actual_assistant_binding_mismatch');
     await launch.get({draftId,requestSource:'user'});
    }
   });
  }catch(error){failedCode=needsInput?null:typeof error?.code==='string'?error.code:'execution_or_receipt_unconfirmed';stopReason=needsInput?'needs_input':failedCode;
   // Cancel only this run's actual task. A cancellation request is not a terminal receipt.
   if(taskId&&!needsInput){try{await services.cancelTask(taskId,'assistant_handoff_harness_stop');snapshot=await lookup(taskId);if(terminal.has(snapshot?.status))status=snapshot.status;}catch{}}
   if(!needsInput)append({type:'failure',rowId,taskId,operationId,code:failedCode,errorClass:error?.name??'Error',unknown:!terminal.has(status)});
  }finally{detachApproval();inflight.delete(rowId);}
  if(needsInput){snapshot=await lookup(taskId);status='needs_input';stopReason='needs_input';}
  const usage=snapshot?.usage??'unknown';
  // Usage schema/currency must be inspected in evidence; never infer missing token fields as zero.
  const inTokens=usage.inputTokens,outTokens=usage.outputTokens;
  if(usage.known===true&&Number.isSafeInteger(inTokens)&&Number.isSafeInteger(outTokens)){knownTokens+=inTokens+outTokens;if(knownTokens>=plan.budgets.maxKnownTotalTokens)stopReason='token_budget_exhausted';}
  else stopReason??='usage_unknown_stop_before_next_admission';
  const measurement={type:'measurement',rowId,path:row.path,cohort:row.cohort,scenario:row.scenario,dataClass:taskId?'real_model_execution_unverified':'admission_attempt_no_execution_proof',taskId,operationId,draftId,terminalStatus:status,elapsedMs:performance.now()-t0,apiCalls,humanObservation,needsInput,autogrant:false,failures:failedCode?[failedCode]:[],unknownReceipts:terminal.has(status)||needsInput?0:1,duplicateExecutions:'unknown_pending_owner_audit',modelUsage:usage,costUsd:null,acceptance:{reviewed:false,passed:false},stopReason};
  append(measurement);return measurement;
 }
 return {services,runRow,
  recordUiTouchpoint(input){const row=plan.rows.find(r=>r.id===input.rowId);if(!row)throw Error('unplanned_row');append({type:'ui_touchpoint',rowId:row.id,path:row.path,source:'real_ui_trace_required',observation:input.observation});},
  recordOwnedPid({pid,owner,evidencePath}){if(!Number.isSafeInteger(pid)||pid<1||!owner||!evidencePath)throw Error('pid_manifest_invalid');append({type:'owned_pid',childPid:pid,owner,evidencePath});},
  async close(){closed=true;for(const {taskId}of issued.values())if(taskId){const s=await lookup(taskId);if(s&&!terminal.has(s.status))await services.cancelTask(taskId,'assistant_handoff_harness_close');}
   await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();await readonlyAdmission.close();append({type:'owner_closed',trackedTasks:[...issued.values()],pidAudit:'main must attach actual owned-child close receipts; no residual-zero claim from this marker'});
  },
 };
}
