import { isDeepStrictEqual } from 'node:util';

/** Monetary quantities are integer billionths of the ledger currency. */
export interface SemanticBudgetPolicy { grantId: string; maxCalls: number; maxCostUnits: number; expiresAt: number }
export type SemanticReservationStatus = 'reserved' | 'dispatched' | 'settled' | 'unknown' | 'cancelled_before_dispatch';
export interface SemanticReservationInput {
  operationId: string; grantId: string; bodyDigest: string; sourceHistoryDigest: string;
  model: string; priceRevision: string; maximumCostUnits: number;
}
export interface SemanticReservation extends SemanticReservationInput { status: SemanticReservationStatus }
export interface SemanticCommit {
  operationId: string; sourceHistoryDigest: string; nextHistoryDigest: string; anchorDigest: string;
}
export interface SemanticCompactionLedger {
  version: 1; currency: string; generation: number; policies: SemanticBudgetPolicy[];
  reservations: SemanticReservation[]; commits: SemanticCommit[];
}
export const SEMANTIC_LEDGER_LIMITS = Object.freeze({ policies: 16, reservations: 256, bytes: 256 * 1024 });
function failure(): never { throw new Error('SEMANTIC_COMPACTION_LEDGER_INVALID'); }
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function object(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) failure();
  if (Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !('value' in d))) failure();
}
const reservationKeys = ['operationId', 'grantId', 'bodyDigest', 'sourceHistoryDigest', 'model', 'priceRevision', 'maximumCostUnits'];
const transitions: Record<SemanticReservationStatus, readonly SemanticReservationStatus[]> = {
  reserved: ['reserved', 'dispatched', 'unknown', 'cancelled_before_dispatch'],
  dispatched: ['dispatched', 'settled', 'unknown'], settled: ['settled'], unknown: ['unknown'],
  cancelled_before_dispatch: ['cancelled_before_dispatch'],
};
function validateReservationInput(v: unknown): asserts v is SemanticReservationInput {
  object(v, reservationKeys);
  if (![v.operationId, v.grantId, v.model].every(id)
    || ![v.bodyDigest, v.sourceHistoryDigest, v.priceRevision].every(digest)
    || !integer(v.maximumCostUnits) || v.maximumCostUnits === 0) failure();
}
function validateCommit(v: unknown): asserts v is SemanticCommit {
  object(v, ['operationId', 'sourceHistoryDigest', 'nextHistoryDigest', 'anchorDigest']);
  if (!id(v.operationId) || ![v.sourceHistoryDigest, v.nextHistoryDigest, v.anchorDigest].every(digest)) failure();
}
function unique(values: string[]): void { if (new Set(values).size !== values.length) failure(); }

/** Serialization validator, never a capability issuer. Untrusted input cannot authorize a write. */
export function validateSemanticCompactionLedger(value: unknown): SemanticCompactionLedger {
  object(value, ['version', 'currency', 'generation', 'policies', 'reservations', 'commits']);
  if (value.version !== 1 || typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)
    || !integer(value.generation) || !Array.isArray(value.policies) || !Array.isArray(value.reservations)
    || !Array.isArray(value.commits) || value.policies.length > SEMANTIC_LEDGER_LIMITS.policies
    || value.reservations.length > SEMANTIC_LEDGER_LIMITS.reservations
    || value.commits.length > value.reservations.length || value.generation !== value.commits.length) failure();
  const policies = value.policies as SemanticBudgetPolicy[];
  const reservations = value.reservations as SemanticReservation[];
  const commits = value.commits as SemanticCommit[];
  for (const policy of policies) {
    object(policy, ['grantId', 'maxCalls', 'maxCostUnits', 'expiresAt']);
    if (!id(policy.grantId) || !integer(policy.maxCalls) || policy.maxCalls < 1
      || policy.maxCalls > SEMANTIC_LEDGER_LIMITS.reservations || !integer(policy.maxCostUnits)
      || policy.maxCostUnits === 0 || !integer(policy.expiresAt)) failure();
  }
  unique(policies.map(p => p.grantId));
  for (const reservation of reservations) {
    object(reservation, [...reservationKeys, 'status']);
    if (!Object.hasOwn(transitions, reservation.status)) failure();
    const { status: _, ...input } = reservation; validateReservationInput(input);
    if (!policies.some(p => p.grantId === reservation.grantId)) failure();
  }
  unique(reservations.map(r => r.operationId));
  for (const policy of policies) {
    const used = reservations.filter(r => r.grantId === policy.grantId);
    // Even cancelled/unknown attempts remain charged. No uncertain refund can revive budget.
    const cost = used.reduce((total, r) => total + r.maximumCostUnits, 0);
    if (used.length > policy.maxCalls || !integer(cost) || cost > policy.maxCostUnits) failure();
  }
  for (const commit of commits) {
    validateCommit(commit);
    const reservation = reservations.find(r => r.operationId === commit.operationId);
    if (!reservation || reservation.status !== 'settled' || reservation.sourceHistoryDigest !== commit.sourceHistoryDigest) failure();
  }
  unique(commits.map(c => c.operationId));
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > SEMANTIC_LEDGER_LIMITS.bytes) failure();
  return structuredClone(value) as unknown as SemanticCompactionLedger;
}

/** Persistent facts are append-only. Normal store.save must separately disallow mutations. */
export function mergeSemanticCompactionLedgers(
  previous: SemanticCompactionLedger | undefined, next: SemanticCompactionLedger | undefined,
): SemanticCompactionLedger | undefined {
  if (previous === undefined) return next === undefined ? undefined : validateSemanticCompactionLedger(next);
  const old = validateSemanticCompactionLedger(previous);
  if (next === undefined) return old;
  const current = validateSemanticCompactionLedger(next);
  if (old.currency !== current.currency || old.generation > current.generation) failure();
  for (const policy of old.policies) {
    if (!isDeepStrictEqual(policy, current.policies.find(p => p.grantId === policy.grantId))) failure();
  }
  for (const reservation of old.reservations) {
    const newer = current.reservations.find(r => r.operationId === reservation.operationId);
    if (!newer) failure();
    const { status: oldStatus, ...oldIdentity } = reservation;
    const { status: newStatus, ...newIdentity } = newer;
    if (!isDeepStrictEqual(oldIdentity, newIdentity) || !transitions[oldStatus].includes(newStatus)) failure();
  }
  // Preserve commit ordering: generation is the exact append index, not a caller-controlled counter.
  for (let i = 0; i < old.commits.length; i++) if (!isDeepStrictEqual(old.commits[i], current.commits[i])) failure();
  return current;
}
export function reserveSemanticCompaction(
  ledger: SemanticCompactionLedger, input: SemanticReservationInput, now: number,
): SemanticCompactionLedger {
  const current = validateSemanticCompactionLedger(ledger); validateReservationInput(input);
  if (!integer(now)) failure();
  const existing = current.reservations.find(r => r.operationId === input.operationId);
  if (existing) {
    const { status: _, ...identity } = existing;
    if (!isDeepStrictEqual(identity, input)) failure();
    return current;
  }
  const policy = current.policies.find(p => p.grantId === input.grantId);
  if (!policy || now >= policy.expiresAt) failure();
  current.reservations.push({ ...structuredClone(input), status: 'reserved' });
  return validateSemanticCompactionLedger(current);
}
export function transitionSemanticReservation(
  ledger: SemanticCompactionLedger, operationId: string, status: SemanticReservationStatus,
): SemanticCompactionLedger {
  const next = validateSemanticCompactionLedger(ledger);
  const reservation = next.reservations.find(r => r.operationId === operationId);
  if (!reservation || !transitions[reservation.status].includes(status)) failure();
  reservation.status = status;
  return validateSemanticCompactionLedger(next);
}
export function commitSemanticCompaction(ledger: SemanticCompactionLedger, fact: SemanticCommit): SemanticCompactionLedger {
  const next = validateSemanticCompactionLedger(ledger); validateCommit(fact);
  const existing = next.commits.find(c => c.operationId === fact.operationId);
  if (existing) { if (!isDeepStrictEqual(existing, fact)) failure(); return next; }
  next.commits.push(structuredClone(fact)); next.generation += 1;
  return validateSemanticCompactionLedger(next);
}
