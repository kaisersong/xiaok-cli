import { randomUUID } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';
import type { CollaborationRoomTurnEnvelope } from './collaboration-room-wake-dispatcher.js';
import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';
import type { RoomWorkspaceExecutionContext, RoomWorkspaceRunOptions, WorkspaceExecutionPort } from './room-workspace-executor.js';
import { RoomWorkspaceLocalStore, resolveWorkspacePath, observeWorkspaceFile, workspaceDigest, pathWithin, type LocalWorkspaceBinding } from './room-workspace-local.js';
import type {WorkspaceProjectAdapter} from './room-workspace-project-adapter.js';
import type {KSwarmTaskHandoff} from './kswarm-runtime-bridge.js';
import type { RoomExternalDiscussionAdapter, RoomExternalDiscussionCapability } from '../shared/room-external-discussion.js';
import { buildExternalDiscussionPrompt } from './room-external-discussion-context.js';

type PhysicalProof = { executorInstanceId: string; kind: 'resources-disposed'; verified: true };
const capability = { contextVersion: 1, resultVersion: 1, releaseVersion: 1, canSetCwd: true, canTrackChildren: true, canRelease: true };

/** Admission, wake ordering and physical cleanup live in main, never renderer. */
export function createRoomWorkspaceRuntime(options: {
  store: RoomWorkspaceLocalStore;
  broker: RoomWorkspaceBrokerPort & { getInstructions?(roomId: string, revision: number): Promise<Record<string, unknown>> };
  wake: { claimWake(input: unknown): Promise<unknown>; completeWake(input: unknown): Promise<unknown>;abandonWake?(input:unknown):Promise<unknown> };
  execute(envelope: CollaborationRoomTurnEnvelope, claimToken: string, workspace?: RoomWorkspaceRunOptions,discussionSignal?:AbortSignal): Promise<{ text: string }>;
  ensureProtocol(): Promise<void>;
  flushOutbox?(): Promise<void>;
  projectAdapter?:WorkspaceProjectAdapter;
  externalDiscussion?: {
    resolve(logicalAgentId:string):Promise<(RoomExternalDiscussionCapability & {logicalAgentId:string}) | null>;
    getHostIdentity(roomId:string):Promise<Record<string,unknown>>;
    execute: RoomExternalDiscussionAdapter['execute'];
  };
  executeProject?(input:{handoff:KSwarmTaskHandoff;workspace:RoomWorkspaceRunOptions;targetParticipantId?:string}):Promise<unknown>;
  notify?(event: { type: 'workspace_changed'; kind: 'workspace_changed'; roomId: string }): void;
}) {
  const running = new Map<string, { roomId: string; controller: AbortController }>();
  const executions = new Set<Promise<{ ok: boolean }>>();
  const activeRuns = new Map<string, { roomId: string; digest: string; controller: AbortController; promise: Promise<{ ok: boolean }> }>();
  const projectPreparations=new Map<string,{roomId:string;controller:AbortController;promise:Promise<Record<string,unknown>>}>();
  let shuttingDown = false;
  const { store, broker } = options;
  const changed = (roomId: string) => options.notify?.({ type: 'workspace_changed', kind: 'workspace_changed', roomId });
  async function request(roomId: string, action: string, input: Record<string, unknown>) {
    const result = await broker.request(roomId, action, input);
    if (!result.ok) throw new Error(String(result.code ?? 'workspace_unavailable'));
    if (!['agent-authorize-read'].includes(action)) changed(roomId);
    return result;
  }
  function bindingFor(context: { roomId: string; bindingId: string; generation: number; workspaceId: string; originHostId?: string }): LocalWorkspaceBinding {
    const binding = store.getBinding(context.bindingId);
    if (!binding || binding.state !== 'active' || binding.roomId !== context.roomId || binding.generation !== context.generation || binding.workspaceId !== context.workspaceId || binding.hostId !== context.originHostId) throw new Error('workspace_binding_unavailable');
    return binding;
  }
  const echo = (context: RoomWorkspaceExecutionContext) => ({
    claimId: context.claimId, logicalAgentId: context.logicalAgentId, protocolVersion: context.protocolVersion,
    runId: context.runId, executorInstanceId: context.executorInstanceId, workspaceId: context.workspaceId,
    originHostId: context.originHostId, hostIncarnation: context.hostIncarnation, bindingId: context.bindingId,
    generation: context.generation, instructionsRevision: context.instructionsRevision,
    ...(context.mappingRevision === undefined ? {} : { mappingRevision: context.mappingRevision }),
  });
  async function acquire(envelope: CollaborationRoomTurnEnvelope, parent?: RoomWorkspaceExecutionContext, childName?: string, signal?: AbortSignal, taskId?:string) {
    signal?.throwIfAborted();
    const project=envelope.contextScope.kind==='project'
      ? await options.projectAdapter?.resolve({roomId:envelope.roomId,projectId:String(envelope.contextScope.projectId),logicalAgentId:envelope.logicalAgentId,taskId:taskId??(typeof parent?.taskId==='string'?parent.taskId:undefined)})
      :undefined;
    if(envelope.contextScope.kind==='project'&&!project?.task)throw new Error('workspace_project_task_required');
    const requestKey = workspaceDigest('acquire-request', { roomId: envelope.roomId, messageId: envelope.roomMessageId, logicalAgentId: envelope.logicalAgentId, parentClaimId: parent?.claimId ?? null, childName: childName ?? null });
    const previousAdmission=store.getRecord<Record<string, unknown>>('admission-request',requestKey);
    if(previousAdmission?.request&&previousAdmission.state!=='received')throw new Error('workspace_admission_recovery_pending');
    const admission = (previousAdmission?.request as Record<string,unknown>|undefined) ?? previousAdmission ?? { runId: randomUUID(), executorInstanceId: randomUUID(), logicalAgentId: envelope.logicalAgentId, taskName: childName ?? envelope.logicalAgentId, contextScope: envelope.contextScope, capability,
      ...(project?{taskId:project.task!.id,projectMappingRevision:project.mapping.mappingRevision}:{}),
      ...(parent ? { parentClaimId: parent.claimId } : {}),
    };
    const journal={requestKey,roomId:envelope.roomId,ownerPid:process.pid,state:'requesting',request:admission};
    store.saveRecord('admission-request', requestKey, journal);
    let result:Record<string,unknown>;
    try { result=await request(envelope.roomId,'acquire',admission); }
    catch(error){store.saveRecord('admission-request',requestKey,{...journal,state:'no-executor'});throw error;}
    const claim = result.claim as unknown as RoomWorkspaceExecutionContext;
    try {
    store.saveRecord('physical-claim', claim.claimId, { claim, ownerPid: process.pid, kind: 'in-process-tracked', released: false });
    store.saveRecord('admission-request',requestKey,{...journal,state:'received',claimId:claim.claimId});
    signal?.throwIfAborted();
    const binding = bindingFor(claim);
    let publishedInstructions = parent?.publishedInstructions ?? '';
    if (!parent && claim.instructionsRevision > 0) {
      const snapshot = broker.getInstructions ? await broker.getInstructions(envelope.roomId, claim.instructionsRevision) : await broker.get(envelope.roomId);
      const instructions = snapshot.instructions as { revision: number; publishedText: string; description?: string; directoryNotes?: unknown; snapshotDigest?: string } | undefined;
      if (!snapshot.ok || !instructions || instructions.revision !== claim.instructionsRevision || instructions.snapshotDigest !== claim.instructionsDigest) throw new Error('workspace_instructions_unavailable');
      publishedInstructions = [instructions.publishedText, instructions.description ?? '', JSON.stringify(instructions.directoryNotes ?? [])].join('\n');
    }
    const confirmedDecisions = parent?.confirmedDecisions ?? (await broker.get(envelope.roomId)).decisions ?? [];
    const scoped = (item: Record<string, unknown>) => item.bindingId === claim.bindingId && item.generation === claim.generation && JSON.stringify(item.contextScope) === JSON.stringify(claim.contextScope);
    const effectiveCwd=project?await resolveWorkspacePath(binding,relative(binding.canonicalRoot,project.mapping.workFolder)):await resolveWorkspacePath(binding,'');
    if(project&&!pathWithin(binding.canonicalRoot,project.mapping.artifactsDir))throw new Error('workspace_project_mapping_outside_root');
    const context: RoomWorkspaceExecutionContext = { ...claim, effectiveCwd, workspaceRoot:{canonicalRoot:binding.canonicalRoot,identity:binding.identity}, publishedInstructions, confirmedDecisions,
      artifactRefs: parent?.artifactRefs ?? store.listArtifacts(claim.roomId).filter(scoped),
      handoffRefs: parent?.handoffRefs ?? store.listHandoffs(claim.roomId).filter(scoped),
      ...(childName ? { agentName: childName } : {}) };
    await request(context.roomId, 'ack', { ...echo(context), actualCwd: context.effectiveCwd, cwdVerified: true });
    signal?.throwIfAborted();
    return context;
    } catch (error) {
      // No executor has been entered. Persist this physical fact even if the
      // remote release fails; it is recoverable, never a fabricated timeout.
      await physicalRelease(claim, { executorInstanceId: claim.executorInstanceId, kind: 'resources-disposed', verified: true }).catch(() => undefined);
      throw error;
    }
  }
  async function physicalRelease(context: RoomWorkspaceExecutionContext, proof: PhysicalProof) {
    store.saveRecord('physical-claim', context.claimId, { claim: context, ownerPid: process.pid, kind: 'in-process-tracked', released: false, releasePending: proof });
    await request(context.roomId, 'release', { ...echo(context), cleanupOutcome: 'released', terminationEvidence: proof });
    store.saveRecord('physical-claim', context.claimId, { claim: context, ownerPid: process.pid, kind: 'in-process-tracked', released: true });
  }
  async function executeRun(envelope: CollaborationRoomTurnEnvelope, controller: AbortController) {
    if (shuttingDown) throw new Error('workspace_runtime_shutting_down');
    let heldWakeToken:string|undefined;
    try {
    const snapshot = await broker.get(envelope.roomId);
    controller.signal.throwIfAborted();
    if (!snapshot.ok) throw new Error(String(snapshot.code ?? 'broker_unavailable'));
    const config = snapshot.config as { workspaceId?: string; phase?: string } | null;
    const external = await options.externalDiscussion?.resolve(envelope.logicalAgentId);
    controller.signal.throwIfAborted();
    if (external) {
      if (external.logicalAgentId !== envelope.logicalAgentId) throw new Error('discussion_identity_mismatch');
      if (!external.supported || external.protocol !== 'room_discussion_v1' || !external.proof
        || ['freshSession','toolsDisabled','mcpDisabled','hooksDisabled'].some(key => external.proof?.[key as keyof typeof external.proof] !== true)) {
        throw new Error(external.reason ?? 'discussion_protocol_unavailable');
      }
      const operationId = workspaceDigest('external-discussion', {roomId:envelope.roomId,sourceMessageId:envelope.roomMessageId,logicalAgentId:envelope.logicalAgentId});
      const prior = store.getRecord<Record<string,unknown>>('external-discussion-operation',operationId);
      if (prior?.phase === 'completed') return {ok:true};
      if (prior?.phase === 'abandoned') throw new Error('discussion_operation_abandoned');
      if (prior) throw new Error('discussion_cleanup_pending');
      const host = await options.externalDiscussion!.getHostIdentity(envelope.roomId);
      controller.signal.throwIfAborted();
      if (host.ok === false || !host.hostId || host.hostIncarnation === undefined) throw new Error('discussion_host_identity_unavailable');
      let journal:Record<string,unknown> = {operationId,roomId:envelope.roomId,sourceMessageId:envelope.roomMessageId,logicalAgentId:envelope.logicalAgentId,contextScope:envelope.contextScope,runtime:external.runtime,hostId:host.hostId,hostIncarnation:host.hostIncarnation,ownerPid:process.pid,phase:'claiming'};
      const save = () => store.saveRecord('external-discussion-operation',operationId,journal);
      save();
      const wake = await request(envelope.roomId,'claim-wake',{roomMessageId:envelope.roomMessageId,logicalAgentId:envelope.logicalAgentId,hostParticipantId:'xiaok-desktop',discussionOnly:true});
      if(typeof wake.claimToken !== 'string')throw new Error('workspace_wake_unavailable');
      heldWakeToken = wake.claimToken;
      journal={...journal,claimToken:wake.claimToken,phase:'claimed'};save();
      controller.signal.throwIfAborted();
      const result = await options.externalDiscussion!.execute({operationId,runtime:external.runtime,
        prompt:buildExternalDiscussionPrompt(envelope,store.listBindings(envelope.roomId).map(binding=>binding.canonicalRoot)),signal:controller.signal,
        async onPrepared(record) {
          if(record.operationId!==operationId||record.runtime!==external.runtime||journal.phase!=='claimed'||record.ownerPid!==process.pid)throw new Error('discussion_owner_mismatch');
          journal={...journal,...record};save();controller.signal.throwIfAborted();
        },
        async onStarted(record) {
          if(record.operationId!==operationId||record.runtime!==external.runtime||journal.phase!=='prepared'||record.neutralRoot!==journal.neutralRoot||!record.processStartIdentity||record.pid<=0||record.processGroupId<=0)throw new Error('discussion_owner_mismatch');
          journal={...journal,...record};save();controller.signal.throwIfAborted();
        },
        async onExited(record) {
          if(record.operationId!==operationId||record.runtime!==external.runtime||record.groupExitVerified!==true||record.pid!==journal.pid||record.processGroupId!==journal.processGroupId||record.processStartIdentity!==journal.processStartIdentity)throw new Error('discussion_exit_evidence_required');
          journal={...journal,...record};save();
        },
      });
      if(result.resourcesReleased!==true||journal.phase!=='released'||journal.groupExitVerified!==true)throw new Error('discussion_cleanup_pending');
      controller.signal.throwIfAborted();
      const completed=await options.wake.completeWake({roomId:envelope.roomId,claimToken:wake.claimToken,reply:result.text?{kind:'text',text:result.text}:{kind:'pass'}}) as {ok:boolean;code?:string};
      if(!completed.ok)throw new Error(completed.code??'workspace_wake_failed');
      heldWakeToken=undefined;
      journal={...journal,phase:'completed'};save();
      return {ok:true};
    }
    if (!config?.workspaceId) {
      const wakeInput = { roomId:envelope.roomId,roomMessageId: envelope.roomMessageId, logicalAgentId: envelope.logicalAgentId, hostParticipantId: 'xiaok-desktop' };
      const wake = (snapshot.requiredProtocol === 'room_workspace_v1'
        ? await request(envelope.roomId, 'claim-wake', { ...wakeInput, discussionOnly: true })
        : await options.wake.claimWake(wakeInput)) as { ok: boolean; claimToken?: string; code?: string };
      if (!wake.ok || !wake.claimToken) throw new Error(wake.code ?? 'workspace_wake_unavailable');
      heldWakeToken=wake.claimToken;
      controller.signal.throwIfAborted();
      // Absence of third argument means explicitly discussion-only registry.
      const result = await options.execute(envelope, wake.claimToken,undefined,controller.signal);
      const complete = await options.wake.completeWake({ roomId:envelope.roomId,claimToken: wake.claimToken, reply: result.text ? { kind: 'text', text: result.text } : { kind: 'pass' } }) as { ok: boolean; code?: string };
      if (!complete.ok) throw new Error(complete.code ?? 'workspace_wake_failed');
      heldWakeToken=undefined;
      return { ok: true };
    }
    if(envelope.contextScope.kind==='project'){
      // No task reference is present in Room chat. This is explicitly discussion
      // only: guarded broker transport rechecks current project membership and
      // primary Room, while Broker binds the token to the source message scope.
      // File mapping/phase is irrelevant: no cwd, file claim or acceptance.
      const wake=await request(envelope.roomId,'claim-wake',{roomMessageId:envelope.roomMessageId,logicalAgentId:envelope.logicalAgentId,hostParticipantId:'xiaok-desktop',discussionOnly:true});
      if(typeof wake.claimToken!=='string')throw new Error('workspace_wake_unavailable');
      heldWakeToken=wake.claimToken;
      controller.signal.throwIfAborted();
      const result=await options.execute(envelope,wake.claimToken,undefined,controller.signal);
      const completed=await options.wake.completeWake({roomId:envelope.roomId,claimToken:wake.claimToken,reply:{kind:'text',text:result.text}}) as {ok:boolean;code?:string};
      if(!completed.ok)throw new Error(completed.code??'workspace_wake_failed');
      heldWakeToken=undefined;
      return {ok:true};
    }
    if (config.phase !== 'active') throw new Error('workspace_not_active');
    await options.ensureProtocol();
    controller.signal.throwIfAborted();
    const context = await acquire(envelope, undefined, undefined, controller.signal);
    running.set(context.claimId, { roomId: context.roomId, controller });
    let rootProof: PhysicalProof | undefined;
    let entered = false;
    const port: WorkspaceExecutionPort = {
      async authorize(current) {
        controller.signal.throwIfAborted();
        const binding = bindingFor(current); await resolveWorkspacePath(binding, '');
        await request(current.roomId, 'agent-authorize-read', { ...echo(current), contextScope: current.contextScope, relativePath: '' });
      },
      async acquireChild(input) {
        await port.authorize(input.parent);
        return acquire({ ...envelope, logicalAgentId: input.parent.logicalAgentId, contextScope: input.parent.contextScope }, input.parent, `${input.taskName}:${input.turn}`, controller.signal);
      },
      async release(current, proof) {
        if (proof.verified !== true || proof.executorInstanceId !== current.executorInstanceId) throw new Error('workspace_release_evidence_required');
        if (current.claimId === context.claimId) rootProof = proof;
        else await physicalRelease(current, proof);
      },
      async submitManifest(current, manifest) {
        await port.authorize(current);
        const binding = bindingFor(current);
        const artifacts = [];
        for (const artifact of manifest.artifacts) {
          const relativePath = isAbsolute(artifact.path) ? relative(binding.canonicalRoot, artifact.path) : artifact.path;
          artifacts.push(await observeWorkspaceFile(binding, relativePath.replace(/\\/g, '/')));
        }
        const submissionId = current.runId;
        const value = { roomId: current.roomId, workspaceId: current.workspaceId, originHostId: current.originHostId, bindingId: current.bindingId, generation: current.generation, workspaceRevision: current.workspaceRevision, contextScope: current.contextScope,
          producerType: 'agent', producerRunId: current.runId, producerClaimId: current.claimId, producerAgentId: current.logicalAgentId, artifacts,
          handoff: { reportedSummary: manifest.summary, completionStatus: 'unverified', unfinished: null, blockers: null, sourceMessageIds: envelope.messages.map(message => message.messageId) },
        };
        const payloadDigest = workspaceDigest('manifest', value);
        const subjectKey = `claim:${current.claimId}`;
        store.prepareSubmission({ subjectKey, submissionId, payloadDigest, manifest: value });
        const issued = await request(current.roomId, 'agent-ticket', { ...echo(current), submissionId, payloadDigest });
        store.commitSubmission(subjectKey, issued.ticket as { ticketId: string; submissionId: string; payloadDigest: string; commitSequence: number });
        await options.flushOutbox?.();
        changed(current.roomId);
      },
    };
    try {
      const wake = await request(envelope.roomId, 'claim-wake', { claimId: context.claimId, logicalAgentId: envelope.logicalAgentId, roomMessageId: envelope.roomMessageId, hostParticipantId: 'xiaok-desktop' });
      if (typeof wake.claimToken !== 'string') throw new Error('workspace_wake_unavailable');
      heldWakeToken=wake.claimToken;
      controller.signal.throwIfAborted();
      entered = true;
      const result = await options.execute(envelope, wake.claimToken, { context, port, signal: controller.signal });
      if (!rootProof) throw new Error('workspace_cleanup_pending');
      const complete = await options.wake.completeWake({ roomId:envelope.roomId,claimToken: wake.claimToken, reply: result.text ? { kind: 'text', text: result.text } : { kind: 'pass' } }) as { ok: boolean; code?: string };
      if (!complete.ok) throw new Error(complete.code ?? 'workspace_wake_failed');
      heldWakeToken=undefined;
      return { ok: true };
    } finally {
      if (!entered) rootProof = { executorInstanceId: context.executorInstanceId, kind: 'resources-disposed', verified: true };
      if (rootProof) { await physicalRelease(context, rootProof); running.delete(context.claimId); }
      changed(context.roomId);
    }
    } finally {
      if(heldWakeToken){
        const cleanup=await options.wake.abandonWake?.({roomId:envelope.roomId,claimToken:heldWakeToken,reason:'execution_failed'}) as {ok?:boolean;code?:string}|undefined;
        if(cleanup?.ok===false)throw new Error(cleanup.code??'workspace_wake_cleanup_pending');
      }
    }
  }
  async function cancelRoom(roomId: string) {
    for(const entry of projectPreparations.values())if(entry.roomId===roomId)entry.controller.abort(new DOMException('Project admission cancelled','AbortError'));
    for (const entry of activeRuns.values()) if (entry.roomId === roomId) entry.controller.abort(new DOMException('Room task cancelled by user', 'AbortError'));
    const cancellations = [];
    for (const [claimId, entry] of running) if (entry.roomId === roomId) {
      entry.controller.abort(new DOMException('Room task cancelled by user', 'AbortError'));
      cancellations.push(request(roomId, 'cancel', { claimId }));
    }
    const results = await Promise.allSettled(cancellations);
    if (results.some(result => result.status === 'rejected')) throw new Error('workspace_cancel_sync_pending');
    for(const [claimId,entry] of running){
      const record=store.getRecord<ProjectRecord>('project-execution',claimId);
      if(entry.roomId===roomId&&record&&['prepared','dispatched'].includes(record.status)&&!projectExecutions.has(claimId)){
        store.saveRecord('project-execution',claimId,{...record,status:'cancelled'});
        await physicalRelease(record.context,{executorInstanceId:record.context.executorInstanceId,kind:'resources-disposed',verified:true});running.delete(claimId);
      }
    }
  }
  type ProjectRecord={context:RoomWorkspaceExecutionContext;taskId:string;requestId:string;status:'prepared'|'dispatched'|'executing'|'completed'|'cancelled'};
  const projectExecutions=new Map<string,Promise<{ok:true}|{ok:false;error:string}>>();
  type ProjectPrepareInput={roomId:string;projectId:string;taskId:string;logicalAgentId:string;requestId:string};
  async function executePrepareProjectTask(input:ProjectPrepareInput,controller:AbortController,requestKey:string):Promise<Record<string,unknown>>{
    if(shuttingDown)throw new Error('workspace_runtime_shutting_down');
    if(!options.projectAdapter||!options.executeProject)throw new Error('workspace_project_executor_unavailable');
    if(!input.requestId)throw new Error('workspace_project_request_id_required');
    const identityKey=workspaceDigest('project-request-identity',{roomId:input.roomId,requestId:input.requestId});
    const identity=store.getRecord<{payloadDigest:string}>('project-request-identity',identityKey);
    if(identity&&identity.payloadDigest!==requestKey)throw new Error('workspace_idempotency_conflict');
    store.saveRecord('project-request-identity',identityKey,{payloadDigest:requestKey});
    const saved=store.getRecord<{claimId:string}>('project-request',requestKey);
    const previous=saved?store.getRecord<ProjectRecord>('project-execution',saved.claimId):null;
    if(previous?.status==='completed')return {ok:true,claimId:previous.context.claimId,runId:previous.context.runId,reused:true};
    if(previous?.status==='cancelled')throw new Error('workspace_project_request_cancelled');
    await options.ensureProtocol();controller.signal.throwIfAborted();
    const envelope:CollaborationRoomTurnEnvelope={roomId:input.roomId,roomTitle:'Project task',roomRevision:0,roomMessageId:`project-task:${input.requestId}`,logicalAgentId:input.logicalAgentId,contextScope:{kind:'project',projectId:input.projectId},messages:[],attachmentPaths:[],contextWindow:{fromSequence:0,toSequence:0,totalMessages:0,isComplete:true,snapshotAt:new Date().toISOString()}};
    const context=previous?.context??await acquire(envelope,undefined,undefined,controller.signal,input.taskId);
    const prior=store.getRecord<ProjectRecord>('project-execution',context.claimId);
    if(prior&&['executing','completed'].includes(prior.status))return {ok:true,claimId:context.claimId,runId:context.runId,reused:true};
    const record:ProjectRecord={context,taskId:String(context.taskId),requestId:input.requestId,status:'prepared'};
    store.saveRecord('project-execution',context.claimId,record);
    store.saveRecord('project-request',requestKey,{claimId:context.claimId});
    running.set(context.claimId,{roomId:context.roomId,controller});
    // A lost response is not evidence that no handoff was sent. The pending
    // record/claim remains authoritative and can be retried using requestId.
    const dispatched=await options.projectAdapter.dispatch(context,record.taskId,controller.signal);
    const latest=store.getRecord<ProjectRecord>('project-execution',context.claimId)!;
    if(latest.status==='prepared')store.saveRecord('project-execution',context.claimId,{...latest,status:'dispatched'});
    changed(context.roomId);return {ok:true,claimId:context.claimId,runId:context.runId,dispatched};
  }
  function prepareProjectTask(input:ProjectPrepareInput){
    const key=workspaceDigest('project-prepare-request',input);
    const prior=projectPreparations.get(key);if(prior)return prior.promise;
    const controller=new AbortController();
    const promise=executePrepareProjectTask(input,controller,key);
    projectPreparations.set(key,{roomId:input.roomId,controller,promise});
    const tracked=promise.then(()=>({ok:true}),()=>({ok:false}));executions.add(tracked);
    void promise.finally(()=>{projectPreparations.delete(key);executions.delete(tracked);}).catch(()=>{});
    return promise;
  }
  async function executeProjectHandoff(input:{handoff:KSwarmTaskHandoff;targetParticipantId?:string;signal?:AbortSignal}):Promise<{ok:true}|{ok:false;error:string}>{
    const {handoff}=input,claimId=String(handoff.workspaceContext?.claimId??'');
    const record=store.getRecord<ProjectRecord>('project-execution',claimId);
    if(!record||!options.projectAdapter||!options.executeProject)return {ok:false,error:'workspace_project_admission_required'};
    if(record.status==='completed')return {ok:true};
    const context=record.context;
    if(record.status==='cancelled'||handoff.runId!==context.runId||handoff.task.id!==record.taskId||handoff.project.id!==(context.contextScope.kind==='project'?context.contextScope.projectId:'')||(input.targetParticipantId&&input.targetParticipantId!==context.logicalAgentId))return {ok:false,error:'workspace_project_handoff_mismatch'};
    for(const key of ['workspaceId','originHostId','hostIncarnation','bindingId','generation','mappingRevision','executorInstanceId'] as const)if(handoff.workspaceContext?.[key]!==context[key])return {ok:false,error:'workspace_project_handoff_mismatch'};
    const controller=running.get(claimId)?.controller??new AbortController();
    const signal=input.signal?AbortSignal.any([controller.signal,input.signal]):controller.signal;
    let rootProof:PhysicalProof|undefined,entered=false;
    running.set(claimId,{roomId:context.roomId,controller});
    const port:WorkspaceExecutionPort={
      async authorize(current){
        signal.throwIfAborted();const binding=bindingFor(current);await resolveWorkspacePath(binding,'');
        await options.projectAdapter!.authorize(current,record.taskId);
        await request(current.roomId,'agent-authorize-read',{...echo(current),contextScope:current.contextScope,relativePath:''});
      },
      async acquireChild(child){
        await port.authorize(child.parent);
        const envelope:CollaborationRoomTurnEnvelope={roomId:context.roomId,roomTitle:'Project child',roomRevision:0,roomMessageId:`project-task:${record.requestId}`,logicalAgentId:context.logicalAgentId,contextScope:context.contextScope,messages:[],attachmentPaths:[],contextWindow:{fromSequence:0,toSequence:0,totalMessages:0,isComplete:true,snapshotAt:new Date().toISOString()}};
        return acquire(envelope,child.parent,`${child.taskName}:${child.turn}`,signal,record.taskId);
      },
      async release(current,proof){
        if(proof.verified!==true||proof.executorInstanceId!==current.executorInstanceId)throw new Error('workspace_release_evidence_required');
        if(current.claimId===claimId)rootProof=proof;else await physicalRelease(current,proof);
      },
      async submitManifest(current,manifest){
        if(current.claimId!==claimId)throw new Error('workspace_project_root_submission_required');
        const info=await options.projectAdapter!.authorize(current,record.taskId);await port.authorize(current);
        const binding=bindingFor(current),artifacts=[];
        for(const artifact of manifest.artifacts){
          const absolute=isAbsolute(artifact.path)?artifact.path:await resolveWorkspacePath(binding,relative(binding.canonicalRoot,current.effectiveCwd)+'/'+artifact.path);
          if(!pathWithin(info.mapping.artifactsDir,absolute))throw new Error('workspace_project_artifact_outside_mapping');
          const observed=await observeWorkspaceFile(binding,relative(binding.canonicalRoot,absolute).replace(/\\/g,'/'));
          artifacts.push({path:absolute,kind:artifact.kind??'other',label:artifact.label??relative(info.mapping.artifactsDir,absolute),contentHash:observed.contentHash,size:observed.size});
        }
        await options.projectAdapter!.submit(current,record.taskId,{summary:manifest.summary,artifacts,workFolder:current.effectiveCwd,workspacePath:current.effectiveCwd,provenance:{runtimeSource:'desktop-agent-runtime',producingAgent:current.logicalAgentId,desktopTaskId:current.runId}});
      },
    };
    try{
      await port.authorize(context);
      store.saveRecord('project-execution',claimId,{...record,status:'executing'});
      entered=true;
      await options.executeProject({handoff,targetParticipantId:input.targetParticipantId,workspace:{context,port,signal}});
      if(!rootProof)throw new Error('workspace_cleanup_pending');
      store.saveRecord('project-execution',claimId,{...record,status:'completed'});
      return {ok:true};
    }catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)};}
    finally{
      if(!entered)rootProof={executorInstanceId:context.executorInstanceId,kind:'resources-disposed',verified:true};
      if(rootProof){await physicalRelease(context,rootProof);running.delete(claimId);}
      changed(context.roomId);
    }
  }
  function runProjectTask(input:{handoff:KSwarmTaskHandoff;targetParticipantId?:string;signal?:AbortSignal}){
    if(shuttingDown)return Promise.resolve({ok:false as const,error:'workspace_runtime_shutting_down'});
    const key=String(input.handoff.workspaceContext?.claimId??'');
    const prior=projectExecutions.get(key);if(prior)return prior;
    const promise=executeProjectHandoff(input);projectExecutions.set(key,promise);
    const tracked=promise.then(result=>({ok:result.ok}));executions.add(tracked);
    void promise.finally(()=>{projectExecutions.delete(key);executions.delete(tracked);}).catch(()=>{});
    return promise;
  }
  function run(envelope: CollaborationRoomTurnEnvelope) {
    const key = workspaceDigest('run-key', { roomId: envelope.roomId, messageId: envelope.roomMessageId, logicalAgentId: envelope.logicalAgentId });
    const digest = workspaceDigest('envelope', JSON.parse(JSON.stringify(envelope)));
    const current = activeRuns.get(key);
    if (current) return current.digest === digest ? current.promise : Promise.reject(new Error('workspace_idempotency_conflict'));
    const controller = new AbortController();
    const execution = executeRun(envelope, controller); executions.add(execution);
    activeRuns.set(key, { roomId: envelope.roomId, digest, controller, promise: execution });
    void execution.finally(() => { executions.delete(execution); activeRuns.delete(key); }).catch(() => undefined);
    return execution;
  }
  let externalRecovery:Promise<{completed:number;abandoned:number;pending:number}>|undefined;
  function recoverExternalDiscussions() {
    if(externalRecovery)return externalRecovery;
    const sweep=async()=>{
      const report={completed:0,abandoned:0,pending:0};
      const gone=(pid:unknown,group=false)=>{
        if(!Number.isSafeInteger(pid)||Number(pid)<=0||Number(pid)===process.pid)return false;
        if(group&&process.platform==='win32')return false;
        try{process.kill(group?-Number(pid):Number(pid),0);return false;}
        catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
      };
      for(let record of store.listRecords<Record<string,unknown>>('external-discussion-operation')){
        if(['completed','abandoned'].includes(String(record.phase)))continue;
        const key=String(record.operationId);
        const persist=(patch:Record<string,unknown>)=>{record={...record,...patch};store.saveRecord('external-discussion-operation',key,record);};
        try{
          const activeKey=workspaceDigest('run-key',{roomId:record.roomId,messageId:record.sourceMessageId,logicalAgentId:record.logicalAgentId});
          if(shuttingDown||activeRuns.has(activeKey)){report.pending++;continue;}
          if(typeof record.claimToken!=='string'){persist({recoveryState:'unknown_pending'});report.pending++;continue;}
          let physical=record.phase==='released'&&record.groupExitVerified===true;
          if(!physical&&gone(record.ownerPid)){
            if(record.phase==='claimed')physical=true; // adapter entry has not occurred
            if(record.phase==='running'&&typeof record.processStartIdentity==='string'&&gone(record.processGroupId,true)){
              physical=true;persist({phase:'released',groupExitVerified:true,recoveryEvidence:'owner-and-group-esrch'});
            }
          }
          if(!physical){persist({recoveryState:record.phase==='prepared'?'unknown_pending':'cleanup_pending'});report.pending++;continue;}
          const response=await broker.request(String(record.roomId),'recover-wake',{claimToken:record.claimToken});
          const wake=response.wake as Record<string,unknown>|undefined;
          if(!response.ok||!wake||wake.roomId!==record.roomId||wake.roomMessageId!==record.sourceMessageId||wake.logicalAgentId!==record.logicalAgentId
            ||workspaceDigest('scope',wake.contextScope)!==workspaceDigest('scope',record.contextScope))throw new Error('discussion_wake_recovery_mismatch');
          if(wake.wakeStatus==='completed'){persist({phase:'completed',recoveryState:'recovered'});report.completed++;continue;}
          if(!['claimed','failed'].includes(String(wake.wakeStatus)))throw new Error('discussion_wake_recovery_pending');
          const abandoned=await options.wake.abandonWake?.({roomId:record.roomId,claimToken:record.claimToken,reason:'execution_failed'}) as {ok?:boolean;wakeStatus?:string}|undefined;
          if(!abandoned?.ok)throw new Error('discussion_wake_cleanup_pending');
          if(abandoned.wakeStatus==='completed'){persist({phase:'completed',recoveryState:'recovered'});report.completed++;}
          else if(abandoned.wakeStatus==='failed'){persist({phase:'abandoned',recoveryState:'recovered'});report.abandoned++;}
          else throw new Error('discussion_wake_cleanup_unconfirmed');
        }catch(error){persist({recoveryState:'cleanup_pending',recoveryError:error instanceof Error?error.message:String(error)});report.pending++;}
      }
      return report;
    };
    externalRecovery=sweep();void externalRecovery.finally(()=>{externalRecovery=undefined;}).catch(()=>{});
    return externalRecovery;
  }
  async function shutdown() {
    shuttingDown = true;
    for(const entry of projectPreparations.values())entry.controller.abort(new DOMException('Workspace owner shutting down','AbortError'));
    for (const entry of activeRuns.values()) entry.controller.abort(new DOMException('Workspace owner shutting down', 'AbortError'));
    for (const entry of running.values()) entry.controller.abort(new DOMException('Workspace owner shutting down', 'AbortError'));
    await Promise.allSettled([...executions]);
    if(externalRecovery)await externalRecovery;
    // The handoff receiver is fenced above and all admissions have settled.
    // Pending dispatch records have never entered a physical runner, so this
    // owner can now prove cancellation instead of abandoning their claims.
    for(const roomId of new Set([...running.values()].map(entry=>entry.roomId)))await cancelRoom(roomId);
  }
  return { run, cancelRoom, shutdown,prepareProjectTask,runProjectTask,recoverExternalDiscussions };
}
