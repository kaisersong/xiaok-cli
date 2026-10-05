import type { BrowserWindow } from 'electron';
import { captureExecutionValue, executionFields, executionIdentity, parseLoopVerificationCommand, parseLoopVerificationObligationForTarget, type LoopVerificationExecution } from './loop-verification-execution.js';
import { consumeProductValidationMaterials, type ValidationMaterialDraft } from '../../src/runtime/verification/product-material-authorization.js';
import { parseVerificationOperationRequestObservation, type VerificationOperationRequestObservation } from '../../src/runtime/verification/verification-operation-request.js';
import { parseMaterialRequestObservation, type MaterialRequestObservation } from '../../src/runtime/verification/material-request.js';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FileSessionStore } from '../../src/ai/runtime/session-store/file-store.js';
import { computeSessionHistoryDigest, type PersistedSessionSnapshot } from '../../src/ai/runtime/session-store/store.js';
import { createSessionExecutionAuthority, createSessionExecutionContext, type SessionExecutionLease } from '../../src/ai/runtime/session-store/execution-authority.js';
import { canonicalVerificationJson as json } from '../../src/runtime/verification/protocol.js';
import { createInstalledVerificationClient } from '../../src/runtime/verification/controller-client.js';
import { createOwnerEnrollmentClient } from '../../src/runtime/verification/completion-client.js';
import { createInstalledLoopApplicationClient } from '../../src/runtime/verification/installed-loop-application.js';
import { loopHostSubjectOwner } from '../../src/runtime/verification/loop-host-subject.js';
import { goalVerificationRegistration } from '../../src/runtime/goal/verification-definition.js';
import { captureLoopProducerValue } from './loop-scan-publication-body.js';
import type { LoopStore, LoopVerificationSession } from './loop-store.js';

type Source = 'user' | 'agent' | 'scheduler';
interface Prepare { nativeAttemptId: string; obligationId: string; requestSource: Source }
interface Recover { id: string; requestSource: Source }
interface Verify extends Recover { exactCommand: ValidationMaterialDraft['exactCommand']; expiresAt: number }

/** Main's actual local verification session allocation. Neither the local
 * ready marker nor its invocation IDs authorize native review or execution. */
export function createLoopVerificationSessionHost(options: {
  store: LoopStore; sessionRoot: string; workspaceRoot: string; window?: BrowserWindow; getWindow?: () => BrowserWindow | undefined;
  assertAdmission(): void; now?: () => number;
}) {
  const { store, assertAdmission: admission } = options;
  const getWindow = options.getWindow?.bind(options) ?? (() => options.window);
  const root = resolve(options.sessionRoot), workspace = realpathSync(options.workspaceRoot);
  const sessions = new FileSessionStore(root), now = options.now ?? Date.now;
  const pending = new Map<string, Promise<Readonly<LoopVerificationSession>>>();
  const verificationPending = new Map<string, { digest: string; window: BrowserWindow | undefined; work: Promise<Readonly<LoopVerificationExecution>> }>();
  let closed = false, drain: Promise<void> | undefined;
  function ingress() { if (closed) throw Error('loop_verification_host_closed'); }
  function admit(nativeAttemptId: string) {
    ingress();
    const result: unknown = admission();
    if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('loop_verification_host_admission_sync'); }
    ingress(); store.assertLoopNativeAttemptCurrent(nativeAttemptId);
  }
  function input<T extends Prepare | Recover>(raw: T, keys: string[], fresh: boolean): T {
    const value = captureLoopProducerValue(raw);
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw Error('loop_verification_host_input');
    for (const item of Object.values(value)) if (typeof item !== 'string' || !item || Buffer.byteLength(item) > 160 || /[\x00-\x1f\x7f]/.test(item)) throw Error('loop_verification_host_input');
    if (!['user', 'scheduler'].includes(value.requestSource) || fresh && value.requestSource !== 'user') throw Error('loop_verification_host_source');
    return value;
  }
  function originalSnapshot(row: Readonly<LoopVerificationSession>): PersistedSessionSnapshot {
    const target = store.getLoopNativeAttemptTarget(row.nativeAttemptId);
    const text = json({ version: 1, kind: 'loop-verification-request', id: row.id, nativeAttemptId: row.nativeAttemptId,
      candidateId: row.candidateId, bindingHash: target.attempt.bindingHash, definitionHash: target.attempt.definitionHash,
      obligationId: row.obligationId, sessionId: row.sessionId, operationId: row.operationId, validationInvocationId: row.validationInvocationId });
    return { sessionId: row.sessionId, cwd: workspace, createdAt: row.createdAt, updatedAt: row.createdAt,
      lineage: [row.sessionId], messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      usage: { inputTokens: 0, outputTokens: 0 }, compactions: [], memoryRefs: [], approvalRefs: [], backgroundJobRefs: [] };
  }
  function assertOriginal(actual: PersistedSessionSnapshot, expected: PersistedSessionSnapshot) {
    const exact = { ...expected, executionProtected: true, storeRevision: 1, historyDigest: computeSessionHistoryDigest(expected) };
    if (json(captureLoopProducerValue(actual)) !== json(exact)) throw Error('loop_verification_session_snapshot_changed');
  }
  async function readOriginal(row: Readonly<LoopVerificationSession>, expected: PersistedSessionSnapshot) {
    const path = join(root, row.sessionId + '.json');
    let before: ReturnType<typeof lstatSync> | undefined;
    try { before = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (before && (!before.isFile() || before.isSymbolicLink())) throw Error('loop_verification_session_file');
    const actual = await sessions.load(row.sessionId);
    if (actual) {
      const after = lstatSync(path);
      if (!before || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw Error('loop_verification_session_file_changed');
      assertOriginal(actual, expected);
    } else if (before) throw Error('loop_verification_session_deleted');
    return actual;
  }
  function readOriginalSync(row: Readonly<LoopVerificationSession>, expected: PersistedSessionSnapshot) {
    const path = join(root, row.sessionId + '.json'), before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) throw Error('loop_verification_session_file');
    const actual = sessions.loadSync(row.sessionId), after = lstatSync(path);
    if (!actual || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw Error('loop_verification_session_file_changed');
    assertOriginal(actual, expected);
  }
  async function enrollOriginal(original: Readonly<LoopVerificationSession>, expected: PersistedSessionSnapshot, source: Source, lease: SessionExecutionLease, action: 'advance' | 'recover') {
    let row = original;
    if (['enrolled', 'retired', 'stale'].includes(row.phase) || row.phase === 'session_ready' && action === 'recover') return row;
    if (!['session_ready', 'enrolling'].includes(row.phase)) throw Error('loop_verification_session_not_ready');
    const target = store.getLoopNativeAttemptTarget(row.nativeAttemptId);
    let application: ReturnType<typeof createInstalledLoopApplicationClient> | undefined;
    const client = createInstalledVerificationClient(), owner = createOwnerEnrollmentClient(client.completionTransport);
    function finalCurrent() {
      admit(row.nativeAttemptId); lease.assertCurrent();
      if (json(store.getLoopVerificationSession(row.id)) !== json(row)) throw Error('loop_verification_session_conflict');
      // No await or caller callback after this canonical file read and before
      // the native request. A lease alone does not stop external file changes.
      readOriginalSync(row, expected);
    }
    async function requireApplication() {
      application ??= createInstalledLoopApplicationClient(target.binding, source);
      const observation = await application.inspect();
      if (observation.state !== 'active' || observation.pendingTransitionId !== null || observation.pendingTarget !== null
        || json(observation.current?.binding) !== json(target.binding)) throw Error('loop_verification_application_changed');
      finalCurrent();
    }
    function save(phase: 'enrolling' | 'enrolled' | 'retired' | 'stale', timestamp: number) {
      row = store.advanceLoopVerificationEnrollment({ id: row.id, expectedRevision: row.revision, phase, requestSource: source, now: timestamp });
      return row;
    }
    const request = { requestId: row.enrollmentRequestId,
      enrollment: { ...loopHostSubjectOwner(target.binding.subject), invocations: [{ sessionIdentity: row.sessionId, compoundOperationId: row.operationId, validationInvocationId: row.validationInvocationId }] },
      registration: goalVerificationRegistration(target.definition) };
    try {
      if (row.phase === 'session_ready') {
        const timestamp = Math.max(now(), row.updatedAt);
        await requireApplication(); finalCurrent(); save('enrolling', timestamp);
        await requireApplication(); finalCurrent();
        const prepared = await owner.prepareRequest(request);
        if (prepared.created) { await requireApplication(); finalCurrent(); await owner.authorize(prepared.challenge); }
      }
      const recovered = await owner.recoverRequest(request);
      const timestamp = Math.max(now(), row.updatedAt);
      if (recovered.state !== 'committed') return save('retired', timestamp);
      let phase: 'enrolled' | 'stale' = 'enrolled';
      try { await requireApplication(); finalCurrent(); } catch { phase = 'stale'; }
      return save(phase, timestamp);
    } finally { application?.dispose(); client.dispose(); }
  }
  async function prepareOriginal(row: Readonly<LoopVerificationSession>, source: Source, enrollmentAction?: 'advance' | 'recover') {
    const timestamp = Math.max(now(), row.updatedAt);
    const expected = originalSnapshot(row);
    const authority = createSessionExecutionAuthority({ root, sessionIdentity: row.sessionId,
      hostContext: createSessionExecutionContext({ requestSource: source, ownerId: row.id, scopeId: row.candidateId }) });
    let lease: SessionExecutionLease | undefined;
    try {
      lease = await authority.acquire({ invocationId: row.operationId, kind: 'recovery' });
      const held = lease;
      return await held.trackInFlight(Promise.resolve().then(async () => {
        held.assertCurrent();
        let actual = await readOriginal(row, expected);
        if (!actual) {
          if (row.phase !== 'reserved') throw Error('loop_verification_session_file_missing');
          admit(row.nativeAttemptId);
          await sessions.compareAndSave({ expectedStoreRevision: 0, expectedHistoryDigest: computeSessionHistoryDigest({ messages: [] }), nextSnapshot: expected, lease: held,
            beforeCommit() { admit(row.nativeAttemptId); held.assertCurrent(); } });
          actual = await readOriginal(row, expected);
          if (!actual) throw Error('loop_verification_session_file_missing');
        }
        held.assertCurrent();
        const current = store.getLoopVerificationSession(row.id);
        if (!current) throw Error('loop_verification_session_missing');
        const identity = (value: Readonly<LoopVerificationSession>) => { const { phase, revision, updatedAt, ...fixed } = value; return json(fixed); };
        if (identity(current) !== identity(row)) throw Error('loop_verification_session_target_changed');
        if (current.phase !== 'reserved') return enrollmentAction ? enrollOriginal(current, expected, source, held, enrollmentAction) : current;
        // This acknowledgement records the file already read above. It can be
        // saved after pause; it never starts a native action or marks success.
        held.assertCurrent();
        return store.acknowledgeLoopVerificationSession({ id: current.id, expectedRevision: current.revision, requestSource: source, now: timestamp });
      }));
    } finally { if (lease) await lease.releaseAfterDrain(); authority.dispose(); }
  }
  function schedule(key: string, work: () => Promise<Readonly<LoopVerificationSession>>) {
    const existing = pending.get(key); if (existing) return existing;
    const operation = Promise.resolve().then(() => { ingress(); return work(); });
    pending.set(key, operation);
    const remove = () => { if (pending.get(key) === operation) pending.delete(key); };
    void operation.then(remove, remove); return operation;
  }
  function enrollment(raw: Recover, action: 'advance' | 'recover'): Promise<Readonly<LoopVerificationSession>> {
    try {
      ingress(); const value = input(raw, ['id', 'requestSource'], action === 'advance'), row = store.getLoopVerificationSession(value.id);
      if (!row) throw Error('loop_verification_session_missing');
      if (row.phase === 'reserved') throw Error('loop_verification_session_not_ready');
      return schedule(json([row.nativeAttemptId, row.obligationId]), () => prepareOriginal(row, value.requestSource, action));
    } catch (error) { return Promise.reject(error); }
  }
  async function executeVerification(session: Readonly<LoopVerificationSession>, source: 'user' | 'scheduler', fresh: Verify | undefined, window: BrowserWindow | undefined) {
    const expected = originalSnapshot(session), target = store.getLoopNativeAttemptTarget(session.nativeAttemptId);
    const authority = createSessionExecutionAuthority({ root, sessionIdentity: session.sessionId,
      hostContext: createSessionExecutionContext({ requestSource: source, ownerId: session.id, scopeId: session.candidateId }) });
    let lease: SessionExecutionLease | undefined;
    try {
      lease = await authority.acquire({ invocationId: session.operationId, kind: 'recovery' });
      const held = lease;
      return await held.trackInFlight(Promise.resolve().then(async () => {
        if (!await readOriginal(session, expected)) throw Error('loop_verification_session_file_missing');
        function originalCurrent() {
          held.assertCurrent();
          if (json(store.getLoopVerificationSession(session.id)) !== json(session)) throw Error('loop_verification_session_conflict');
          readOriginalSync(session, expected);
        }
        function permission() {
          ingress(); const result: unknown = admission();
          if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error('loop_verification_host_admission_sync'); }
          if (fresh && (!window || window.isDestroyed() || getWindow() !== window)) throw Error('loop_verification_execution_window');
          ingress(); originalCurrent();
        }
        permission();
        let row = store.listLoopVerificationExecutions(session.id)[0];
        const isFresh = !row;
        if (fresh && row && (json(row.exactCommand) !== json(fresh.exactCommand) || row.expiresAt !== fresh.expiresAt)) throw Error('loop_verification_execution_conflict');
        if (!row) {
          if (!fresh || !window) throw Error('loop_verification_execution_window');
          const timestamp = now(); admit(session.nativeAttemptId); originalCurrent();
          row = store.reserveLoopVerificationExecution({ sessionRecordId: session.id, exactCommand: fresh.exactCommand, expiresAt: fresh.expiresAt, requestSource: source, now: timestamp });
        }
        if (['terminal','retired'].includes(row.phase)) return row;
        const client = createInstalledVerificationClient();
        const verificationCall = client.verificationTransport.call.bind(client.verificationTransport);
        const materialCall = client.materialRequestTransport.call.bind(client.materialRequestTransport);
        let application: ReturnType<typeof createInstalledLoopApplicationClient> | undefined;
        const query = { requestId: row.verificationRequestId, invocation: row.invocation, obligationId: row.obligationId };
        const stamp = () => Math.max(now(), row.updatedAt);
        function current() {
          admit(session.nativeAttemptId);
          if (fresh && (!window || window.isDestroyed() || getWindow() !== window)) throw Error('loop_verification_execution_window');
          originalCurrent();
          if (json(store.getLoopVerificationExecution(row.id)) !== json(row)) throw Error('loop_verification_execution_conflict');
        }
        async function requireApplication() {
          application ??= createInstalledLoopApplicationClient(target.binding, source);
          const observation = await application.inspect();
          if (observation.state !== 'active' || observation.pendingTransitionId !== null || observation.pendingTarget !== null || json(observation.current?.binding) !== json(target.binding)) throw Error('loop_verification_application_changed');
          current();
        }
        function observe(facts: { materialObservation?: Readonly<MaterialRequestObservation>; verificationObservation?: Readonly<VerificationOperationRequestObservation> } = {}) {
          row = store.observeLoopVerificationExecution({ id: row.id, expectedRevision: row.revision, requestSource: source, now: stamp(), ...facts });
          return row;
        }
        async function observeWithMaterials(verificationObservation: Readonly<VerificationOperationRequestObservation>, recovering: boolean) {
          const canRetire = verificationObservation.state === 'not_prepared' || verificationObservation.state === 'retired'
            || verificationObservation.state === 'operation' && verificationObservation.operation.state === 'cancelled';
          permission();
          const method = recovering && canRetire ? 'materials.retireRequest' : 'materials.lookupRequest';
          const materialObservation = parseMaterialRequestObservation(await materialCall(method, { requestId: row.materialRequestId, invocation: row.invocation, ...(method === 'materials.retireRequest' ? { requestSource: source } : {}) }));
          if (verificationObservation.state === 'operation' && verificationObservation.operation.state !== 'cancelled') {
            const handoff = materialObservation.handoff;
            if (handoff?.state !== 'attached' || handoff.ownerKey !== json(verificationObservation.owner)
              || json(handoff.expected) !== json(verificationObservation.operation.expected)
              || json(handoff.invocation) !== json(row.invocation) || handoff.scopeDigest !== verificationObservation.operation.expected.scopeDigest)
              throw Error('loop_verification_execution_handoff');
          }
          // Preserve the original approval for completed or possibly running
          // operations. Retirement here would invalidate their proof scope.
          return observe({ verificationObservation, materialObservation });
        }
        try {
          if (!isFresh) {
            // Recovery owns no fresh grant. Pause or a newer candidate must not
            // block retirement of these original requests.
            permission();
            const verificationObservation = parseVerificationOperationRequestObservation(await verificationCall('verification.recoverRequest', { ...query, requestSource: source }));
            return await observeWithMaterials(verificationObservation, true);
          }
          await requireApplication(); current();
          const observation = parseLoopVerificationObligationForTarget(await verificationCall('verification.inspectObligation', { invocation: row.invocation, obligationId: row.obligationId }), session, target);
          await requireApplication(); current();
          const { authorizeDesktopValidationMaterials } = await import('./desktop-validation-materials.js');
          await requireApplication(); current();
          const authorized = await authorizeDesktopValidationMaterials({ requestSource: 'user', window: window!, cwd: workspace,
            operation: { purpose: 'isolated-command', invocation: row.invocation, exactCommand: row.exactCommand, expiresAt: row.expiresAt },
            client: client.materialAuthorization, assertCurrent: current,
            request: { requestId: row.materialRequestId, async beforeStep(step) {
              await requireApplication(); current();
              row = store.recordLoopVerificationMaterialStep({ id: row.id, expectedRevision: row.revision, step, requestSource: 'user', now: stamp() });
              await requireApplication(); current();
            } } });
          if (!authorized) {
            if (row.phase === 'selecting') return store.cancelLoopVerificationSelection({ id: row.id, expectedRevision: row.revision, requestSource: 'user', now: stamp() });
            return observe();
          }
          await requireApplication(); current();
          const plan = consumeProductValidationMaterials(authorized, { purpose: 'isolated-command', invocation: row.invocation, exactCommand: row.exactCommand });
          row = store.beginLoopVerificationPrepare({ id: row.id, expectedRevision: row.revision, observation, requestSource: 'user', now: stamp() });
          current();
          const prepared = await verificationCall('verification.prepareRequest', { ...query, expectedAttemptEpoch: observation.attemptEpoch, requestSource: 'user', mountPlanHandle: plan.mountPlanHandle }) as { created: boolean; observation?: VerificationOperationRequestObservation; operationHandle?: { id: string; secret: string }; attemptId?: string };
          if (!prepared.created) {
            if (!prepared.observation) throw Error('loop_verification_execution_response');
            return await observeWithMaterials(parseVerificationOperationRequestObservation(prepared.observation), false);
          }
          await requireApplication(); current();
          if (!prepared.operationHandle || !prepared.attemptId) throw Error('loop_verification_execution_response');
          row = store.beginLoopVerificationDispatch({ id: row.id, expectedRevision: row.revision, operationId: prepared.operationHandle.id, attemptId: prepared.attemptId, requestSource: 'user', now: stamp() });
          current(); await verificationCall('verification.dispatch', { operationHandle: prepared.operationHandle });
          // The terminal response is history even if the user paused while the
          // controller ran. It never changes local Loop business completion.
          const completed = parseVerificationOperationRequestObservation(await verificationCall('verification.lookupRequest', query));
          return await observeWithMaterials(completed, false);
        } catch (error) {
          if (!['terminal','retired'].includes(row.phase)) {
            try { observe(); } catch { /* Preserve original journal on CAS/storage failure. */ }
          }
          throw error;
        } finally { application?.dispose(); client.dispose(); }
      }));
    } finally { if (lease) await lease.releaseAfterDrain(); authority.dispose(); }
  }
  function verification(raw: Verify | Recover, action: 'verify' | 'recover'): Promise<Readonly<LoopVerificationExecution>> {
    try {
      ingress(); const value = captureExecutionValue(raw);
      executionFields(value, action === 'verify' ? ['id','exactCommand','expiresAt','requestSource'] : ['id','requestSource']);
      executionIdentity(value.id);
      if (!['user','scheduler'].includes(value.requestSource) || action === 'verify' && value.requestSource !== 'user') throw Error('loop_verification_host_source');
      if (action === 'verify') { const plan = value as Verify; plan.exactCommand = parseLoopVerificationCommand(plan.exactCommand); if (!Number.isSafeInteger(plan.expiresAt)) throw Error('loop_verification_execution_input'); }
      const execution = action === 'recover' ? store.getLoopVerificationExecution(value.id) : undefined;
      if (action === 'recover' && !execution) throw Error('loop_verification_execution_missing');
      const session = store.getLoopVerificationSession(execution?.sessionRecordId ?? value.id);
      if (!session || session.phase !== 'enrolled') throw Error('loop_verification_execution_session');
      const key = session.id, digest = json({ action, value }), previous = verificationPending.get(key);
      const window = action === 'verify' ? getWindow() : undefined;
      if (previous) { if (previous.digest !== digest || previous.window !== window || window?.isDestroyed()) throw Error('loop_verification_execution_conflict'); return previous.work; }
      const work = Promise.resolve().then(() => { ingress(); return executeVerification(session, value.requestSource as 'user'|'scheduler', action === 'verify' ? value as Verify : undefined, window); });
      verificationPending.set(key, { digest, window, work });
      const remove = () => { if (verificationPending.get(key)?.work === work) verificationPending.delete(key); };
      void work.then(remove, remove); return work;
    } catch (error) { return Promise.reject(error); }
  }
  return Object.freeze({
    prepare(raw: Prepare): Promise<Readonly<LoopVerificationSession>> {
      try {
        ingress(); const value = input(raw, ['nativeAttemptId', 'obligationId', 'requestSource'], true);
        return schedule(json([value.nativeAttemptId, value.obligationId]), async () => {
          const timestamp = now(); admit(value.nativeAttemptId);
          const previous = store.listLoopVerificationSessions(value.nativeAttemptId).find(row => row.obligationId === value.obligationId);
          const row = previous ?? store.reserveLoopVerificationSession({ ...value, sessionId: sessions.createSessionId(), now: timestamp });
          return prepareOriginal(row, value.requestSource);
        });
      } catch (error) { return Promise.reject(error); }
    },
    recover(raw: Recover): Promise<Readonly<LoopVerificationSession>> {
      try {
        ingress(); const value = input(raw, ['id', 'requestSource'], false), row = store.getLoopVerificationSession(value.id);
        if (!row) throw Error('loop_verification_session_missing');
        return schedule(json([row.nativeAttemptId, row.obligationId]), () => prepareOriginal(row, value.requestSource));
      } catch (error) { return Promise.reject(error); }
    },
    enroll(raw: Recover) { return enrollment(raw, 'advance'); },
    recoverEnrollment(raw: Recover) { return enrollment(raw, 'recover'); },
    verify(raw: Verify) { return verification(raw, 'verify'); },
    recoverVerification(raw: Recover) { return verification(raw, 'recover'); },
    get(id: string) { return store.getLoopVerificationSession(id); },
    list(nativeAttemptId: string) { return store.listLoopVerificationSessions(nativeAttemptId); },
    close(): Promise<void> { closed = true; return drain ??= Promise.allSettled([...pending.values(), ...[...verificationPending.values()].map(item => item.work)]).then(() => {}); },
  });
}
