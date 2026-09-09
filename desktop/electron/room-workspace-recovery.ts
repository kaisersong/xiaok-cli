import { RoomWorkspaceLocalStore, workspaceDigest } from './room-workspace-local.js';
import type { RoomWorkspaceBrokerPort } from './room-workspace-service.js';

type Claim = Record<string, unknown> & { roomId: string; claimId: string; executorInstanceId: string; hostIncarnation: number; originHostId: string };
type Evidence = { executorInstanceId: string; kind: 'process-exit' | 'resources-disposed' | 'session-disposed'; verified: true };
type PhysicalRecord = { claim: Claim; ownerPid: number; kind: string; released: boolean; releasePending?: Evidence };
type PendingSubmission = { subjectKey: string; submissionId: string; payloadDigest: string; manifest: Record<string, unknown> };
type PendingConfirmation = { recordKey: string; roomId: string; artifactId: string; versionId: string; bindingId: string; generation: number; workspaceId: string; submissionId: string; payloadDigest: string; committed: boolean };
type RecoveryReport = { released: number; committed: number; pending: number };
type AdmissionRecord={requestKey:string;roomId:string;ownerPid:number;state:string;request:Record<string,unknown>};
const identityKeys = ['roomId', 'claimId', 'executorInstanceId', 'runId', 'logicalAgentId', 'protocolVersion', 'workspaceId', 'originHostId', 'bindingId', 'generation', 'instructionsRevision', 'instructionsDigest', 'mappingRevision', 'workspaceRevision', 'membershipRevision', 'parentClaimId', 'projectId'] as const;

/** A recovery owner replays local facts, never grants new execution or deletes files. */
export function createRoomWorkspaceRecovery(options: {
  store: RoomWorkspaceLocalStore;
  broker: RoomWorkspaceBrokerPort & { getHost?(roomId: string): Promise<{ hostId: string; hostIncarnation: number }> };
  isMutationOwner(): boolean;
  flushOutbox(): Promise<void>;
  recoverAdditional?(): Promise<void>;
  notify?(roomId: string): void;
  retryIntervalMs?: number;
}) {
  const { store, broker } = options;
  const inFlight = new Map<string, Promise<RecoveryReport>>();
  let stopped = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sweep: Promise<void> | undefined;
  const allowed = () => !stopped && options.isMutationOwner();
  const submissions = (roomId?: string): PendingSubmission[] => store.listPendingSubmissions(roomId);
  function positiveExit(pid: number) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }
  async function request(roomId: string, action: string, input: Record<string, unknown>) {
    if (!allowed()) throw new Error('workspace_recovery_not_owner');
    const result = await broker.request(roomId, action, input);
    if (!result.ok) throw new Error(String(result.code ?? 'broker_unavailable'));
    return result;
  }
  function sameClaim(left: Claim, right: Claim) { return identityKeys.every(key => left[key] === right[key]) && workspaceDigest('scope', left.contextScope) === workspaceDigest('scope', right.contextScope); }
  function proofFor(record: PhysicalRecord): Evidence | null {
    if (record.kind !== 'in-process-tracked') return null;
    if (positiveExit(record.ownerPid)) return { executorInstanceId: record.claim.executorInstanceId, kind: 'process-exit', verified: true };
    const proof = record.releasePending;
    // An unknown live PID is not an executor we can reattach. In particular,
    // heartbeat expiry and an empty runtime Map are not evidence of exit.
    if (record.ownerPid !== process.pid || proof?.verified !== true || proof.executorInstanceId !== record.claim.executorInstanceId || !['resources-disposed', 'session-disposed'].includes(proof.kind)) return null;
    return proof;
  }
  async function release(record: PhysicalRecord) {
    const proof = proofFor(record);
    if (!proof || !allowed()) return false;
    let claim = record.claim;
    const host = broker.getHost ? await broker.getHost(claim.roomId) : null;
    if (!allowed() || (host && host.hostId !== claim.originHostId)) return false;
    if (host && host.hostIncarnation !== claim.hostIncarnation) {
      // Broker persists a receipt for this exact CAS and evidence. Replaying
      // it repairs a lost response without exposing project claims via GET.
      const takeover = () => request(claim.roomId, 'takeover', { claimId: claim.claimId, expectedHostIncarnation: claim.hostIncarnation, recoveryEvidence: { ...proof, kind: proof.kind === 'process-exit' ? 'process-exit' : 'attached' } });
      let result: Record<string, unknown>;
      try { result = await takeover(); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'workspace_host_fenced') throw error;
        // A second process restart may have lost the first takeover receipt.
        // Exact-ID recovery inspection is main/owner/same-installation only;
        // it grants no execution and does not change the room display scope.
        const inspected = await request(claim.roomId, 'recover-claim', { claimId: claim.claimId });
        const current = inspected.claim as Claim;
        if (!current || !sameClaim(claim, current) || !Number.isSafeInteger(current.hostIncarnation)) throw new Error('workspace_claim_mismatch');
        claim = current;
        result = claim.hostIncarnation === host.hostIncarnation ? inspected : await takeover();
      }
      const next = result.claim as Claim;
      if (!next || !sameClaim(claim, next) || next.hostIncarnation !== host.hostIncarnation) throw new Error('workspace_claim_mismatch');
      claim = next;
      if (!allowed()) return false;
      store.saveRecord('physical-claim', claim.claimId, { ...record, claim, releasePending: proof });
    }
    const released = await request(claim.roomId, 'release', { ...claim, cleanupOutcome: 'released', terminationEvidence: proof });
    const confirmed = released.claim as Claim;
    if (!confirmed || !sameClaim(claim, confirmed) || confirmed.hostIncarnation !== claim.hostIncarnation || confirmed.executionState !== 'released') throw new Error('workspace_release_unconfirmed');
    if (!allowed()) return false;
    store.saveRecord('physical-claim', claim.claimId, { ...record, claim: confirmed, released: true, releasePending: proof });
    return true;
  }
  async function recoverSubmission(pending: PendingSubmission) {
    const manifest = pending.manifest;
    if (typeof manifest.roomId !== 'string' || workspaceDigest('manifest', manifest) !== pending.payloadDigest) return false;
    const claimId = pending.subjectKey.startsWith('claim:') ? pending.subjectKey.slice('claim:'.length) : undefined;
    if (claimId ? manifest.producerType !== 'agent' || manifest.producerClaimId !== claimId : manifest.producerType !== 'user') return false;
    const result = await request(manifest.roomId, 'recover-ticket', { submissionId: pending.submissionId, payloadDigest: pending.payloadDigest, ...(claimId ? { claimId } : {}) });
    const ticket = result.ticket as Record<string, any> | undefined;
    if (!ticket || ticket.submissionId !== pending.submissionId || ticket.payloadDigest !== pending.payloadDigest || ticket.roomId !== manifest.roomId || ticket.bindingId !== manifest.bindingId || ticket.generation !== manifest.generation || ticket.workspaceId !== manifest.workspaceId || (manifest.originHostId !== undefined && ticket.originHostId !== manifest.originHostId) || workspaceDigest('scope', ticket.contextScope) !== workspaceDigest('scope', manifest.contextScope) || !Number.isSafeInteger(ticket.commitSequence) || typeof ticket.ticketId !== 'string') return false;
    if (claimId ? ticket.subject?.kind !== 'agentClaim' || ticket.subject.claimId !== claimId : ticket.subject?.kind !== 'authenticatedUserAction' || pending.subjectKey !== `user:${ticket.subject.userPrincipal}:${pending.submissionId}`) return false;
    if (!Array.isArray(ticket.allowedEventKinds) || !ticket.allowedEventKinds.includes('artifact.registered')) return false;
    if (!allowed()) return false;
    store.commitSubmission(pending.subjectKey, ticket as { ticketId: string; submissionId: string; payloadDigest: string; commitSequence: number });
    return true;
  }
  async function recoverConfirmation(pending: PendingConfirmation) {
    if (pending.recordKey !== workspaceDigest('confirmation-request', { roomId: pending.roomId, submissionId: pending.submissionId }) || pending.payloadDigest !== workspaceDigest('confirmation', { artifactId: pending.artifactId, versionId: pending.versionId })) return false;
    const result = await request(pending.roomId, 'recover-ticket', { submissionId: pending.submissionId, payloadDigest: pending.payloadDigest, confirmation: true });
    const ticket = result.ticket as Record<string, any> | undefined;
    if (!ticket || ticket.roomId !== pending.roomId || ticket.submissionId !== pending.submissionId || ticket.payloadDigest !== pending.payloadDigest || ticket.bindingId !== pending.bindingId || ticket.generation !== pending.generation || ticket.workspaceId !== pending.workspaceId || ticket.versionId !== pending.versionId || ticket.subject?.kind !== 'authenticatedUserAction' || ticket.subject.userPrincipal !== 'user.local' || ticket.subject.actionId !== pending.submissionId || !Array.isArray(ticket.allowedEventKinds) || !ticket.allowedEventKinds.includes('artifact.confirmed') || typeof ticket.ticketId !== 'string' || !Number.isSafeInteger(ticket.commitSequence)) return false;
    const artifact = store.listArtifacts(pending.roomId).find(item => item.artifactId === pending.artifactId && item.versionId === pending.versionId);
    if (!artifact || artifact.bindingId !== pending.bindingId || artifact.generation !== pending.generation || artifact.workspaceId !== pending.workspaceId || !allowed()) return false;
    // confirmArtifact's outbox unique key makes a crash between these two
    // durable writes safe to replay with the same historical ticket.
    store.confirmArtifact(pending.roomId, pending.versionId, ticket as { ticketId: string; payloadDigest: string; commitSequence: number });
    store.saveRecord('pending-confirmation', pending.recordKey, { ...pending, committed: true });
    return true;
  }
  async function run(roomId: string): Promise<RecoveryReport> {
    const report = { released: 0, committed: 0, pending: 0 };
    if (!allowed()) return report;
    for(const admission of store.listRecords<AdmissionRecord>('admission-request').filter(item=>item.roomId===roomId&&['requesting','no-executor'].includes(item.state))){
      if(!allowed())break;
      const exited=positiveExit(admission.ownerPid);
      if(!exited&&!(admission.ownerPid===process.pid&&admission.state==='no-executor')){report.pending++;continue;}
      try{
        const inspected=await request(roomId,'recover-admission',{request:admission.request});
        const claim=inspected.claim as Claim;
        if(!claim||claim.roomId!==roomId||claim.runId!==admission.request.runId||claim.executorInstanceId!==admission.request.executorInstanceId||claim.logicalAgentId!==admission.request.logicalAgentId||workspaceDigest('scope',claim.contextScope)!==workspaceDigest('scope',admission.request.contextScope))throw new Error('workspace_claim_mismatch');
        if(!allowed())break;
        // No in-process request failure proves anything about an already running
        // executor. Only the old process's positive exit can cover that state.
        if(!exited&&claim.executionState!=='admitted')throw new Error('workspace_admission_recovery_pending');
        if(!store.getRecord('physical-claim',claim.claimId))store.saveRecord('physical-claim',claim.claimId,{claim,ownerPid:admission.ownerPid,kind:'in-process-tracked',released:false,...(!exited?{releasePending:{executorInstanceId:claim.executorInstanceId,kind:'resources-disposed',verified:true}}:{})});
        store.saveRecord('admission-request',admission.requestKey,{...admission,state:'recovered',claimId:claim.claimId});
      }catch{report.pending++;}
    }
    for (const record of store.listRecords<PhysicalRecord>('physical-claim').filter(item => item.claim?.roomId === roomId && !item.released)) {
      if (!allowed()) break;
      try { if (await release(record)) report.released++; else report.pending++; }
      catch { report.pending++; }
    }
    for (const pending of submissions(roomId)) {
      if (!allowed()) break;
      try { if (await recoverSubmission(pending)) report.committed++; else report.pending++; }
      catch { report.pending++; }
    }
    for (const pending of store.listRecords<PendingConfirmation>('pending-confirmation').filter(item => item.roomId === roomId && !item.committed)) {
      if (!allowed()) break;
      try { if (await recoverConfirmation(pending)) report.committed++; else report.pending++; }
      catch { report.pending++; }
    }
    if (allowed()) await options.flushOutbox().catch(() => undefined);
    if (allowed() && (report.released > 0 || report.committed > 0)) {
      try { options.notify?.(roomId); } catch { /* View invalidation is not a durable fact. */ }
    }
    return report;
  }
  function recoverRoom(roomId: string): Promise<RecoveryReport> {
    const current = inFlight.get(roomId);
    if (current) return current;
    const work = run(roomId).finally(() => { if (inFlight.get(roomId) === work) inFlight.delete(roomId); });
    inFlight.set(roomId, work);
    return work;
  }
  async function tick() {
    if (!allowed()) return;
    const rooms = new Set<string>();
    for(const admission of store.listRecords<AdmissionRecord>('admission-request'))if(['requesting','no-executor'].includes(admission.state)&&typeof admission.roomId==='string')rooms.add(admission.roomId);
    for (const record of store.listRecords<PhysicalRecord>('physical-claim')) if (!record.released && record.claim?.roomId) rooms.add(record.claim.roomId);
    for (const pending of submissions()) if (typeof pending.manifest.roomId === 'string') rooms.add(pending.manifest.roomId);
    for (const pending of store.listRecords<PendingConfirmation>('pending-confirmation')) if (!pending.committed && typeof pending.roomId === 'string') rooms.add(pending.roomId);
    for (const event of store.pendingOutbox()) { const manifest = event.manifest as Record<string, unknown> | undefined; if (typeof manifest?.roomId === 'string') rooms.add(manifest.roomId); }
    for (const roomId of rooms) { if (!allowed()) break; await recoverRoom(roomId); }
    // A future outbox event may not carry a manifest room. Delivery belongs
    // to the existing outbox owner, so it must not depend on our room index.
    if (rooms.size === 0 && allowed() && store.pendingOutbox().length) await options.flushOutbox().catch(() => undefined);
    if (allowed()) await options.recoverAdditional?.().catch(() => undefined);
  }
  function schedule() {
    if (stopped) return;
    sweep = tick().catch(() => undefined).finally(() => {
      if (!stopped) { timer = setTimeout(schedule, Math.max(100, options.retryIntervalMs ?? 5_000)); timer.unref?.(); }
    });
  }
  return {
    recoverRoom,
    start() { if (started || stopped) return; started = true; schedule(); },
    async stop() { stopped = true; if (timer) clearTimeout(timer); await Promise.allSettled([...(sweep ? [sweep] : []), ...inFlight.values()]); },
  };
}
