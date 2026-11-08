import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
import type {Database} from 'better-sqlite3';
import type {ControllerPeer} from './controller-public-daemon.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
import type {createMigrationMarkerJournal} from './migration-marker-journal.js';
import {createRoomTurnCustody, type RoomTurnCustody} from './original-sdk-custody.js';
import {reservePendingVerificationProfile} from './profile-owner-registry.js';
import {runVerificationTransaction} from './storage-budget.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {
  MAIN_ROOT_FAMILY_PURPOSE, mainRootFamilyTargets, mainRootFamilyReviewHash,
  parseMainRootFamilyEnrollmentRecord, parseMainRootFamilyPrincipal, parseMainRootFamilyRequest,
  type MainRootFamilyEnrollmentRecord as Record, type MainRootFamilyPrincipal as Principal, type MainRootFamilyReview,
} from './main-root-family-enrollment-data.js';

export interface MainRootFamilyEnrollmentPorts {
  readonly publication: ReturnType<typeof createMigrationMarkerJournal>;
  assertCurrent(): void;
  approve(review: Readonly<MainRootFamilyReview>, signal: AbortSignal): Promise<{uid: number; auditSessionId: number; reviewHash: string}>;
}
interface Call {stock: RoomTurnCustody; operation?: Promise<unknown>; blocked: boolean}
const retainedAuthorities = new Set<object>();
const apply = Reflect.apply, NativePromise = Promise, NativeAbortController = AbortController;

/** Private component of the original OwnerEnrollment/database lifetime. This
 * stage collects consent for a pending request; it has no accepted/activation
 * method, and never publishes the global ordinary-writer fence/profile index. */
export function createMainRootFamilyEnrollmentAuthority(input: {
  database: Database; authorityId: string; ports: MainRootFamilyEnrollmentPorts;
  clock(): ReceiverClockEvidence;
  resolvePrincipal(peer: ControllerPeer): Principal & {source: 'macos-local-generateduid'};
}) {
  const {database: db, authorityId, ports} = input, publication = ports.publication;
  const boot = randomUUID(), calls = new Set<Call>(), approvals = new Map<string, AbortController>();
  const owner = Object.freeze({database: db, calls, publication});
  let sealed = false, unknown = false, ending: Promise<void> | undefined;
  const current = ports.assertCurrent.bind(ports), approve = ports.approve.bind(ports);
  function local(mutation = false) {
    if (sealed) throw Error('main_root_enrollment_closed');
    if (mutation && (unknown || [...calls].some(call => call.blocked))) throw Error('main_root_enrollment_physical_pending');
  }
  function checkCurrent(call: Call, mutation = false) {
    local(mutation);call.stock.syncVoid(current, undefined, []);local(mutation);call.stock.accepted();
  }
  function syncData(call: Call, method: Function, args: unknown[]) {
    let value: unknown;
    call.stock.syncVoid(() => { value = apply(method, undefined, args); call.stock.inventory(value); }, undefined, []);
    call.stock.accepted(); return value;
  }
  function principal(call: Call, peer: ControllerPeer): Readonly<Principal> {
    const raw = syncData(call, input.resolvePrincipal, [peer]);
    if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Reflect.ownKeys(raw).length !== 5) throw Error('main_root_enrollment_principal');
    const values: {[key: string]: unknown} = {};
    for (const name of ['uid', 'gid', 'auditSessionId', 'accountGeneration', 'source']) {
      const row = Object.getOwnPropertyDescriptor(raw, name);
      if (!row || !Object.hasOwn(row, 'value')) throw Error('main_root_enrollment_principal');
      values[name] = row.value;
    }
    if (values.source !== 'macos-local-generateduid' || values.uid !== peer.uid || values.gid !== peer.gid || values.auditSessionId !== peer.auditSessionId) throw Error('main_root_enrollment_principal');
    return parseMainRootFamilyPrincipal({uid: values.uid, gid: values.gid, auditSessionId: values.auditSessionId, accountGeneration: values.accountGeneration});
  }
  function clock(call: Call) {
    if (!db.inTransaction) throw Error('main_root_enrollment_transaction');
    const raw = syncData(call, input.clock, []) as ReceiverClockEvidence;
    if (!raw || typeof raw !== 'object' || types.isProxy(raw)) throw Error('main_root_enrollment_clock');
    const out: {[key: string]: any} = {};
    for (const name of ['domainId', 'qualificationEpoch', 'lowerBound', 'upperBound', 'evidenceHash']) {
      const row = Object.getOwnPropertyDescriptor(raw, name);
      if (!row || !Object.hasOwn(row, 'value')) throw Error('main_root_enrollment_clock');
      out[name] = row.value;
    }
    if (Reflect.ownKeys(raw).length !== 5 || typeof out.domainId !== 'string' || !out.domainId || !Number.isSafeInteger(out.qualificationEpoch) || out.qualificationEpoch < 1 || !Number.isSafeInteger(out.lowerBound) || !Number.isSafeInteger(out.upperBound) || out.lowerBound < 0 || out.upperBound < out.lowerBound || typeof out.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(out.evidenceHash)) throw Error('main_root_enrollment_clock');
    const old = db.prepare('SELECT last_lower FROM main.owner_enrollment_clock WHERE domain_id=? AND qualification_epoch=?').get(out.domainId, out.qualificationEpoch) as {last_lower: number} | undefined;
    if (old && out.lowerBound < old.last_lower) throw Error('main_root_enrollment_clock');
    db.prepare('INSERT INTO main.owner_enrollment_clock VALUES(?,?,?) ON CONFLICT(domain_id,qualification_epoch) DO UPDATE SET last_lower=excluded.last_lower').run(out.domainId, out.qualificationEpoch, out.lowerBound);
    return out as unknown as ReceiverClockEvidence;
  }
  function read(p: Readonly<Principal>, operationId: string): Readonly<Record> {
    const records = publication.readMainRootFamilyIntents(p), record = records.find(row => row.review.operationId === operationId);
    if (!record) throw Error('main_root_enrollment_principal');
    const profile = db.prepare('SELECT account_id,profile_id FROM main.verification_profiles WHERE uid=?').get(p.uid) as {account_id: string; profile_id: string} | undefined;
    if (!profile || profile.account_id !== p.accountGeneration.toLowerCase() || profile.profile_id !== record.review.profileId) throw Error('main_root_enrollment_principal');
    return record;
  }
  function view(record: Readonly<Record>) {
    const cancelled = record.phase === 'cancelled';
    return Object.freeze({operationId: record.review.operationId, profileId: record.review.profileId,
      phase: cancelled ? 'cancelled' : 'pending', consent: record.phase === 'prepared' ? 'required' : record.phase,
      pendingOnly: true, activation: 'unavailable', blockers: Object.freeze(['activation_evidence_required']),
      physicalCompletion: 'not-attested'});
  }
  function replace(before: Readonly<Record>, phase: Record['phase'], approval?: Record['approval']) {
    const {approval: prior, ...base} = before;
    const next = parseMainRootFamilyEnrollmentRecord({...base, phase, ...(approval ?? prior ? {approval: approval ?? prior} : {})});
    publication.replaceMainRootFamilyIntent(before, next); return next;
  }
  function publish(record: Readonly<Record>) {
    publication.publishMainRootFamilyPending(record);
    runVerificationTransaction(db, () => { publication.acknowledgeMainRootFamilyPending(record); });
  }
  function invoke<T>(work: (call: Call) => T | Promise<T>, mutation = false): Promise<T> {
    local(mutation);
    if (db.inTransaction) return NativePromise.reject(Error('main_root_enrollment_outer_transaction'));
    const call: Call = {stock: createRoomTurnCustody(), blocked: false}; calls.add(call);
    const result = call.stock.root(async () => { checkCurrent(call, mutation); return work(call); });
    call.operation = result;
    const settled = () => {
      try { call.stock.assertPhysicalKnown(); calls.delete(call); }
      catch {
        call.blocked = true;
        void call.stock.waitPhysicalKnown().then(() => { calls.delete(call); }, () => { unknown = true; retainedAuthorities.add(owner); });
      }
    };
    void result.then(settled, settled); return result;
  }
  return Object.freeze({
    prepare(raw: unknown, peer: ControllerPeer) {
      const request = parseMainRootFamilyRequest(raw, 'prepare');
      return invoke(call => {
        const p = principal(call, peer); checkCurrent(call, true);
        return runVerificationTransaction(db, () => {
          const records = publication.readMainRootFamilyIntents(p), old = records.find(row => row.requestId === request.requestId);
          if (old) return view(read(p, old.review.operationId));
          if (records.some(row => row.phase !== 'cancelled')) throw Error('main_root_enrollment_conflict');
          const c = clock(call), profile = reservePendingVerificationProfile(db, {uid: p.uid, accountId: p.accountGeneration.toLowerCase()});
          const operationId = syncData(call, randomUUID, []), challengeId = syncData(call, randomUUID, []);
          const record = parseMainRootFamilyEnrollmentRecord({version: 1, purpose: MAIN_ROOT_FAMILY_PURPOSE, state: 'pending', phase: 'prepared', boot, requestId: request.requestId,
            review: {version: 1, purpose: MAIN_ROOT_FAMILY_PURPOSE, authorizationScope: 'pending-only', authorityId, operationId, challengeId, profileId: profile.profile_id, principal: p,
              deadline: {domainId: c.domainId, qualificationEpoch: c.qualificationEpoch, notBefore: c.lowerBound, validUntil: c.upperBound + 300000}, targets: mainRootFamilyTargets()}});
          checkCurrent(call, true); publication.prepareMainRootFamilyIntent(record); return view(record);
        });
      }, true);
    },
    authorize(raw: unknown, peer: ControllerPeer, signal: AbortSignal) {
      const request = parseMainRootFamilyRequest(raw, 'mutation');
      return invoke(async call => {
        const p = principal(call, peer);
        const record = runVerificationTransaction(db, () => {
          const old = read(p, request.operationId);
          if (old.phase === 'cancelled') throw Error('main_root_enrollment_cancelled');
          if (old.boot !== boot || old.phase !== 'prepared') throw Error('main_root_enrollment_consumed');
          const c = clock(call), d = old.review.deadline;
          if (json(old.review.principal) !== json(p) || c.domainId !== d.domainId || c.qualificationEpoch !== d.qualificationEpoch || c.lowerBound < d.notBefore || c.upperBound >= d.validUntil) throw Error('main_root_enrollment_deadline');
          return replace(old, 'authorizing');
        });
        const controller = new NativeAbortController(); approvals.set(record.review.operationId, controller);
        try {
          const approval = await call.stock.sdk<{uid: number; auditSessionId: number; reviewHash: string}>(approve, undefined, [record.review, AbortSignal.any([signal, controller.signal])]);
          call.stock.accepted(); checkCurrent(call, true);
          const approved = runVerificationTransaction(db, () => {
            const old = read(p, request.operationId);
            if (controller.signal.aborted || old.phase === 'cancelled') throw Error('main_root_enrollment_cancelled');
            const c = clock(call), d = record.review.deadline;
            if (c.domainId !== d.domainId || c.qualificationEpoch !== d.qualificationEpoch || c.lowerBound < d.notBefore || c.upperBound >= d.validUntil) throw Error('main_root_enrollment_deadline');
            if (!approval || types.isProxy(approval) || Reflect.ownKeys(approval).length !== 3 || approval.uid !== p.uid || approval.auditSessionId !== p.auditSessionId || approval.reviewHash !== mainRootFamilyReviewHash(record.review)) throw Error('main_root_enrollment_approval');
            return replace(old, 'authorized', approval);
          });
          publish(approved); return view(approved);
        } catch (error) {
          if (!sealed) {
            try {runVerificationTransaction(db, () => { const old = read(p, request.operationId); if (old.phase === 'authorizing') replace(old, 'failed'); });}
            catch (secondary) {call.stock.inventory(secondary);}
          }
          throw error;
        } finally { approvals.delete(record.review.operationId); }
      }, true);
    },
    read(raw: unknown, peer: ControllerPeer) {
      const request = parseMainRootFamilyRequest(raw, 'read');
      return invoke(call => { const p = principal(call, peer); return view(read(p, request.operationId)); });
    },
    recover(raw: unknown, peer: ControllerPeer) {
      const request = parseMainRootFamilyRequest(raw, 'mutation');
      return invoke(call => {
        const p = principal(call, peer); let record = read(p, request.operationId);
        if (record.phase === 'authorizing' && record.boot !== boot) record = runVerificationTransaction(db, () => replace(record, 'unknown'));
        publish(record); return view(record);
      }, true);
    },
    cancel(raw: unknown, peer: ControllerPeer) {
      const request = parseMainRootFamilyRequest(raw, 'mutation');
      return invoke(call => {
        const p = principal(call, peer), record = runVerificationTransaction(db, () => {
          const old = read(p, request.operationId); return old.phase === 'cancelled' ? old : replace(old, 'cancelled');
        });
        approvals.get(record.review.operationId)?.abort(); publish(record); return view(record);
      });
    },
    close() {
      if (ending) return ending;
      sealed = true; for (const controller of approvals.values()) controller.abort();
      return ending = (async () => {
        await NativePromise.allSettled([...calls].map(call => call.operation));
        const results = await NativePromise.allSettled([...calls].map(call => call.stock.waitPhysicalKnown()));
        let failure: {error: unknown} | undefined;
        for (const result of results) if (result.status === 'rejected') failure ??= {error: result.reason};
        try { await publication.closeMainRootFamily(); } catch (error) { failure ??= {error}; }
        if (failure || unknown) { retainedAuthorities.add(owner); throw failure ? failure.error : Error('main_root_enrollment_physical_unknown'); }
      })();
    },
  });
}
