import { readInstalledCurrentOwner } from '../../src/runtime/verification/installed-owner-state.js';
import { createInstalledVerificationClient } from '../../src/runtime/verification/controller-client.js';
import { createOwnerEnrollmentClient } from '../../src/runtime/verification/completion-client.js';
import { createInstalledLoopApplicationClient } from '../../src/runtime/verification/installed-loop-application.js';
import { loopHostSubjectOwner } from '../../src/runtime/verification/loop-host-subject.js';
import { canonicalVerificationJson as json } from '../../src/runtime/verification/protocol.js';
import { goalVerificationRegistration } from '../../src/runtime/goal/verification-definition.js';
import { captureLoopProducerValue } from './loop-scan-publication-body.js';
import type { LoopStore, LoopNativeAttempt, LoopNativePhase } from './loop-store.js';

interface ReauthorizationWrite {
  store: LoopStore; parent: Readonly<LoopNativeAttempt>; enrollmentSourceAttemptId: string;
  targetJson: string; historyJson: string; now: number; check(afterInsert?: boolean): void;
}
const reauthorizations = new WeakMap<object, ReauthorizationWrite>();
/** Store can consume a fixed workflow's one-use decision, never a supplied DTO. */
export function consumeLoopNativeReauthorization(token: object, store: LoopStore): ReauthorizationWrite {
  const write = token && typeof token === 'object' ? reauthorizations.get(token) : undefined;
  if (token && typeof token === 'object') reauthorizations.delete(token);
  if (!write || write.store !== store) throw Error('loop_native_reauthorization_ticket');
  return write;
}
interface NativeReauthorization extends NativeAction { expectedRevision: number }
interface NativeAction {
  attemptId: string;
  requestSource: 'user' | 'agent' | 'scheduler';
  signal?: AbortSignal;
}
interface NativeReservation {
  candidateId: string;
  expectedLatestAttemptId: string | null;
  requestSource: 'user' | 'agent' | 'scheduler';
}

/** Main-owned request lifecycle. A ready row is historical binding information,
 * never verification, a publication grant, or a business completion write. */
export function createLoopNativeWorkflow(options: {
  store: LoopStore;
  assertAdmission: () => void;
  now?: () => number;
}) {
  const { store, assertAdmission: admission } = options;
  const now = options.now ?? Date.now;
  const pending = new Map<string, Promise<Readonly<LoopNativeAttempt>>>();
  let closed = false;
  let draining: Promise<void> | undefined;

  function ingress() { if (closed) throw Error('loop_native_closed'); }
  function admit() {
    ingress();
    const result: unknown = admission();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => {});
      throw Error('loop_native_admission_sync');
    }
    ingress();
  }
  function parseAction(raw: NativeAction, action: 'advance' | 'recover'): NativeAction {
    if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error('loop_native_input');
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some(key => typeof key !== 'string')
      || Object.values(descriptors).some(value => !('value' in value))) throw Error('loop_native_input');
    const { signal: signalDescriptor, ...data } = descriptors;
    const input = captureLoopProducerValue(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.value])));
    if (Object.keys(input).sort().join(',') !== 'attemptId,requestSource'
      || typeof input.attemptId !== 'string' || !input.attemptId || Buffer.byteLength(input.attemptId) > 160
      || /[\x00-\x1f\x7f]/.test(input.attemptId)) throw Error('loop_native_input');
    if (!['user', 'scheduler'].includes(input.requestSource) || action === 'advance' && input.requestSource !== 'user') throw Error('loop_native_source');
    const signal: AbortSignal | undefined = signalDescriptor?.value;
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw Error('loop_native_input');
    signal?.throwIfAborted();
    return { ...input, signal } as NativeAction;
  }

  async function run(input: NativeAction, action: 'advance' | 'recover'): Promise<Readonly<LoopNativeAttempt>> {
    ingress();
    const { attemptId, requestSource, signal } = input;
    const target = store.getLoopNativeAttemptTarget(attemptId);
    let row = target.attempt;
    if (['ready', 'retired', 'stale', 'needs_reauthorization'].includes(row.phase)) return row;

    function current() {
      signal?.throwIfAborted();
      admit();
      store.assertLoopNativeAttemptCurrent(attemptId);
    }
    function save(phase: LoopNativePhase) {
      // Capture the clock before the final admission fence: even a synchronous
      // host callback must not revoke permission after we have checked it.
      const timestamp = Math.max(now(), row.updatedAt);
      if (phase === 'enrolling' || phase === 'binding') current();
      if (phase === 'enrolled' || phase === 'ready') {
        try { current(); } catch { phase = 'stale'; }
      }
      row = store.advanceLoopNativeAttempt({ attemptId, expectedRevision: row.revision, phase, requestSource, now: timestamp });
      return row;
    }
    async function enrollment(fresh: boolean): Promise<boolean> {
      if (row.kind !== 'enrollment-and-application') throw Error('loop_native_attempt_lineage');
      const enrollmentRequestId = row.enrollmentRequestId;
      if (fresh) save('enrolling');
      const client = createInstalledVerificationClient();
      try {
        const owner = createOwnerEnrollmentClient(client.completionTransport);
        const request = {
          requestId: enrollmentRequestId,
          enrollment: { ...loopHostSubjectOwner(target.binding.subject), loopSubject: target.binding.subject, invocations: [] },
          registration: goalVerificationRegistration(target.definition),
        };
        if (fresh) {
          current();
          const prepared = await owner.prepareRequest(request, signal);
          if (prepared.created) {
            current();
            await owner.authorize(prepared.challenge, signal);
          } else fresh = false;
        }
        const recovered = await owner.recoverRequest(request, signal);
        save(recovered.state === 'committed' ? 'enrolled' : 'retired');
        return fresh;
      } finally { client.dispose(); }
    }
    async function application(fresh: boolean): Promise<void> {
      if (fresh) save('binding');
      // The first enrollment can publish the profile route. Do not capture an
      // unavailable route before that actual enrollment has committed.
      const client = createInstalledLoopApplicationClient(target.binding, requestSource);
      try {
        if (fresh) {
          current();
          const prepared = await client.prepareRequest(row.applicationRequestId, signal);
          if (prepared.created && !prepared.challenge.alreadyCommitted) {
            current();
            await client.authorize(prepared.challenge, signal);
          }
        }
        const recovered = await client.recoverRequest(row.applicationRequestId, signal);
        if (recovered.state === 'committed') {
          const observation = recovered.observation;
          const exact = observation?.state === 'active' && observation.pendingTransitionId === null
            && observation.pendingTarget === null && json(observation.current?.binding) === json(target.binding);
          save(exact ? 'ready' : 'stale');
        } else if (recovered.state === 'reauthorization_required' || recovered.state === 'registration_changed') {
          save('needs_reauthorization');
        } else if (recovered.state !== 'pending') save('retired');
      } finally { client.dispose(); }
    }

    // An already claimed phase can only reconcile its original request. It
    // cannot regain the original challenge ticket or open the next review.
    if (row.phase === 'enrolling') { await enrollment(false); return row; }
    if (row.phase === 'binding') { await application(false); return row; }
    if (action === 'recover') return row;
    if (row.phase === 'reserved' && !await enrollment(true)) return row;
    if (row.phase === 'enrolled') await application(true);
    return row;
  }

  async function reauthorize(input: NativeReauthorization): Promise<Readonly<LoopNativeAttempt>> {
    const { attemptId, expectedRevision, signal } = input;
    const target = store.getLoopNativeAttemptTarget(attemptId), parent = target.attempt;
    const history = store.listLoopNativeAttempts(parent.candidateId);
    const targetJson = json(target), historyJson = json(history);
    if (parent.revision !== expectedRevision || history.at(-1)?.attemptId !== attemptId
      || !(parent.phase === 'needs_reauthorization' || parent.kind === 'application-reauthorization' && parent.phase === 'retired')) throw Error('loop_native_reauthorization_state');
    const enrollmentSourceAttemptId = parent.kind === 'enrollment-and-application' ? parent.attemptId : parent.enrollmentSourceAttemptId;
    const ancestor = history.find(row => row.attemptId === enrollmentSourceAttemptId);
    if (!ancestor || ancestor.kind !== 'enrollment-and-application') throw Error('loop_native_attempt_lineage');
    const requested = loopHostSubjectOwner(target.binding.subject), route = readInstalledCurrentOwner(requested), routeJson = json(route);
    if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered') throw Error('loop_native_reauthorization_owner');
    function check(afterInsert = false) {
      signal?.throwIfAborted(); admit();
      if (json(readInstalledCurrentOwner(requested)) !== routeJson) throw Error('loop_native_reauthorization_owner');
      if (json(store.getLoopNativeAttemptTarget(attemptId)) !== targetJson
        || !afterInsert && json(store.listLoopNativeAttempts(parent.candidateId)) !== historyJson) throw Error('loop_native_attempt_conflict');
      signal?.throwIfAborted();
    }
    check(); store.assertLoopNativeAttemptCurrent(attemptId);
    const installed = createInstalledVerificationClient();
    try {
      const enrollment = await createOwnerEnrollmentClient(installed.completionTransport).recoverRequest({
        requestId: ancestor.enrollmentRequestId,
        enrollment: { ...requested, loopSubject: target.binding.subject, invocations: [] },
        registration: goalVerificationRegistration(target.definition),
      }, signal);
      check();
      if (enrollment.state !== 'committed' || json(enrollment.owner) !== json(route.owner)) throw Error('loop_native_reauthorization_enrollment');
    } finally { installed.dispose(); }
    const client = createInstalledLoopApplicationClient(target.binding, 'user');
    try {
      let cursor: Readonly<LoopNativeAttempt> = parent, eligible = false;
      for (let count = 0; count < history.length; count++) {
        check(); const recovered = await client.recoverRequest(cursor.applicationRequestId, signal); check();
        const observation = recovered.observation;
        const active = observation?.state === 'active' && observation.pendingTransitionId === null
          && observation.pendingTarget === null && json(observation.current?.binding) === json(target.binding);
        if (recovered.state === 'registration_changed') throw Error('loop_native_reauthorization_registration');
        if (active && (recovered.state === 'committed' || recovered.state === 'reauthorization_required')) { eligible = true; break; }
        if (recovered.state === 'reauthorization_required' && recovered.challengePhase === 'approved'
          && observation?.state === 'pending' && observation.pendingTransitionId
          && json(observation.pendingTarget) === json(target.binding)) { eligible = true; break; }
        if (!['not_prepared', 'not_approved'].includes(recovered.state) || cursor.kind !== 'application-reauthorization' || cursor.phase !== 'retired') throw Error('loop_native_reauthorization_pending');
        const previous = history.find(row => row.attemptId === cursor.reauthorizesAttemptId);
        if (!previous || previous.ordinal !== cursor.ordinal - 1) throw Error('loop_native_attempt_lineage');
        cursor = previous;
      }
      if (!eligible) throw Error('loop_native_reauthorization_pending');
      const timestamp = Math.max(now(), parent.updatedAt); check();
      const token = Object.freeze({});
      reauthorizations.set(token, { store, parent, enrollmentSourceAttemptId, targetJson, historyJson, now: timestamp, check });
      const retry = store.applyLoopNativeReauthorization(token);
      // This same explicit user operation may open the newly journalled request.
      // Recovery of that row only reconciles its original request after restart.
      return await run({ attemptId: retry.attemptId, requestSource: 'user', signal }, 'advance');
    } finally { client.dispose(); }
  }

  function scheduleReauthorization(raw: NativeReauthorization): Promise<Readonly<LoopNativeAttempt>> {
    try {
      ingress();
      if (!raw || typeof raw !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error('loop_native_input');
      const descriptors = Object.getOwnPropertyDescriptors(raw);
      if (Reflect.ownKeys(raw).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !('value' in d))
        || !Object.hasOwn(descriptors, 'expectedRevision')) throw Error('loop_native_input');
      const expectedRevision: unknown = descriptors.expectedRevision!.value;
      if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw Error('loop_native_input');
      const { expectedRevision: removedRevision, ...actionDescriptors } = descriptors;
      const input = { ...parseAction(Object.fromEntries(Object.entries(actionDescriptors).map(([k, d]) => [k, d.value])) as NativeAction, 'advance'), expectedRevision };
      admit();
      if (pending.has(input.attemptId)) throw Error('loop_native_reauthorization_busy');
      const operation = Promise.resolve().then(() => reauthorize(input));
      pending.set(input.attemptId, operation);
      const remove = () => { if (pending.get(input.attemptId) === operation) pending.delete(input.attemptId); };
      void operation.then(remove, remove); return operation;
    } catch (error) { return Promise.reject(error); }
  }

  function schedule(raw: NativeAction, action: 'advance' | 'recover'): Promise<Readonly<LoopNativeAttempt>> {
    try {
      ingress();
      const input = parseAction(raw, action);
      if (action === 'advance') admit();
      const existing = pending.get(input.attemptId);
      if (existing) return existing;
      // Register before calling any transport, including synchronously
      // reentrant host adapters. SQLite CAS remains the cross-instance owner.
      const operation = Promise.resolve().then(() => run(input, action));
      pending.set(input.attemptId, operation);
      const remove = () => { if (pending.get(input.attemptId) === operation) pending.delete(input.attemptId); };
      void operation.then(remove, remove);
      return operation;
    } catch (error) { return Promise.reject(error); }
  }

  return Object.freeze({
    reserve(raw: NativeReservation): Readonly<LoopNativeAttempt> {
      ingress();
      const input = captureLoopProducerValue(raw);
      if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'candidateId,expectedLatestAttemptId,requestSource') throw Error('loop_native_input');
      if (input.requestSource !== 'user') throw Error('loop_native_source');
      const timestamp = now();
      admit();
      return store.reserveLoopNativeAttempt({ ...input, now: timestamp });
    },
    reauthorizeApplication(raw: NativeReauthorization) { return scheduleReauthorization(raw); },
    advance(raw: NativeAction) { return schedule(raw, 'advance'); },
    recover(raw: NativeAction) { return schedule(raw, 'recover'); },
    get(attemptId: string) { return store.getLoopNativeAttempt(attemptId); },
    list(candidateId: string) { return store.listLoopNativeAttempts(candidateId); },
    close(): Promise<void> {
      closed = true;
      // The Main owner closes SQLite only after this actual drain completes.
      // A timeout or cancellation request is not evidence of quiescence.
      return draining ??= Promise.allSettled([...pending.values()]).then(() => {});
    },
  });
}
