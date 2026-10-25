import { randomUUID } from 'node:crypto';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { parseGoalApplicationBinding, type GoalApplicationBinding } from '../verification/goal-application-binding.js';
import type { PublicationChallenge, PublicationObservation, PublicationRequestRecovery, PublicationSource } from '../verification/publication-client.js';
import { parseGoalCompletionIntent, validateGoalCompletionIntentRevision, type GoalCompletionIntent } from './completion-intent.js';

export interface GoalPublicationAttempt {
  attemptId: string;
  intentId: string;
  application: Readonly<GoalApplicationBinding>;
  requestSource: PublicationSource;
  sequence: number;
  revision: number;
  status: 'preparing' | 'prepared' | 'authorizing' | 'pending' | 'not_prepared' | 'not_approved' | 'committed' | 'cancelled';
  challenge: Readonly<PublicationChallenge> | null;
  observation: Readonly<PublicationObservation> | null;
  retirement: Exclude<PublicationRequestRecovery, { status: 'settlement_exists' }> | null;
  createdAt: number;
  updatedAt: number;
}
export interface GoalPublicationAttemptUpdate { expectedRevision: number | null; next: GoalPublicationAttempt }
const terminal = new Set<GoalPublicationAttempt['status']>(['not_prepared', 'not_approved', 'committed', 'cancelled']);
export function isGoalPublicationAttemptTerminal(attempt: GoalPublicationAttempt): boolean { return terminal.has(attempt.status); }
export function createGoalPublicationAttempt(intent: GoalCompletionIntent, requestSource: PublicationSource, now: number, sequence: number): GoalPublicationAttempt {
  return { attemptId: `goal_publish_${randomUUID()}`, intentId: intent.intentId, application: structuredClone(intent.application),
    requestSource, sequence, revision: 1, status: 'preparing', challenge: null, observation: null, retirement: null, createdAt: now, updatedAt: now };
}
function keys(raw: unknown, expected: string[]): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== [...expected].sort().join(',')) throw Error('goal_attempt_shape');
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 160 || /[\x00-\x1f\x7f]/.test(value)) throw Error('goal_attempt_identity');
}
function parseAttempt(raw: GoalPublicationAttempt, intent: GoalCompletionIntent): GoalPublicationAttempt {
  const value = JSON.parse(json(raw)) as GoalPublicationAttempt;
  keys(value, ['attemptId','intentId','application','requestSource','sequence','revision','status','challenge','observation','retirement','createdAt','updatedAt']);
  id(value.attemptId); id(value.intentId);
  value.application = parseGoalApplicationBinding(value.application);
  if (value.intentId !== intent.intentId || json(value.application) !== json(intent.application)) throw Error('goal_attempt_identity');
  if (!['user','agent','scheduler'].includes(value.requestSource)
    || ![value.sequence, value.revision].every(n => Number.isSafeInteger(n) && n >= 1)
    || ![value.createdAt, value.updatedAt].every(n => Number.isSafeInteger(n) && n >= intent.createdAt)
    || value.updatedAt < value.createdAt) throw Error('goal_attempt_value');
  if (!['preparing','prepared','authorizing','pending', ...terminal].includes(value.status)) throw Error('goal_attempt_status');
  // Reuse the original strict challenge/observation parser. This parses facts,
  // never returns the publication client's original one-use approval object.
  if (value.challenge !== null) {
    parseGoalCompletionIntent({ ...intent, status: value.observation?.status === 'committed' ? 'committed'
      : value.observation?.status === 'cancelled' ? 'cancelled' : value.observation !== null ? 'pending' : 'prepared',
      challenge: value.challenge, observation: value.observation });
  } else if (value.observation !== null) throw Error('goal_attempt_observation');
  if (value.status === 'preparing' && (value.challenge !== null || value.observation !== null || value.retirement !== null)) throw Error('goal_attempt_preparing');
  if (value.status === 'not_prepared') {
    if (value.challenge !== null || value.observation !== null) throw Error('goal_attempt_retirement');
    keys(value.retirement, ['status']);
    if (value.retirement.status !== 'not_prepared') throw Error('goal_attempt_retirement');
  } else if (value.status === 'not_approved') {
    if (value.challenge === null || value.observation !== null) throw Error('goal_attempt_retirement');
    keys(value.retirement, ['status','owner','challengeId','operationId','fullTupleHash','challenge']);
    const r = value.retirement;
    if (r.status !== 'not_approved') throw Error('goal_attempt_retirement');
    id(r.operationId);
    if (r.challengeId !== value.challenge.challengeId || json(r.challenge) !== json(value.challenge)
      || json(r.owner) !== json(value.challenge.owner) || r.fullTupleHash !== value.challenge.fullTupleHash) throw Error('goal_attempt_retirement');
  } else if (value.retirement !== null) throw Error('goal_attempt_retirement');
  if (!['preparing','not_prepared'].includes(value.status) && value.challenge === null) throw Error('goal_attempt_challenge');
  if (['prepared','authorizing'].includes(value.status) && value.observation !== null) throw Error('goal_attempt_observation');
  if (value.status === 'pending' && value.observation?.status !== 'unknown') throw Error('goal_attempt_observation');
  if (['committed','cancelled'].includes(value.status) && value.observation?.status !== value.status) throw Error('goal_attempt_terminal');
  return value;
}
const transitions: Record<GoalPublicationAttempt['status'], readonly GoalPublicationAttempt['status'][]> = {
  preparing: ['prepared','pending','not_prepared','not_approved','committed','cancelled'],
  prepared: ['authorizing','pending','not_approved','committed','cancelled'],
  authorizing: ['pending','not_approved','committed','cancelled'], pending: ['pending','committed','cancelled'],
  not_prepared: [], not_approved: [], committed: [], cancelled: [],
};
/** Pure journal validation invoked inside the actual store's transaction/queue. */
export function applyGoalPublicationAttemptUpdate(current: readonly GoalPublicationAttempt[], intent: GoalCompletionIntent, update: GoalPublicationAttemptUpdate): GoalPublicationAttempt[] {
  const next = parseAttempt(update.next, intent), found = current.find(row => row.attemptId === next.attemptId);
  if ((found?.revision ?? null) !== update.expectedRevision) throw Error('goal_attempt_stale_revision');
  const related = current.filter(row => row.intentId === intent.intentId).sort((a, b) => a.sequence - b.sequence);
  const last = related.at(-1);
  if (!found) {
    if (intent.status !== 'claimed' || next.status !== 'preparing' || next.revision !== 1 || related.length >= 32
      || next.sequence !== related.length + 1 || last && (!isGoalPublicationAttemptTerminal(last) || last.status === 'committed')
      || next.sequence > 1 && next.requestSource !== 'user') throw Error('goal_attempt_creation');
    return [...structuredClone(current), next];
  }
  if (last?.attemptId !== found.attemptId || next.revision !== found.revision + 1
    || !transitions[found.status].includes(next.status) || next.updatedAt < found.updatedAt) throw Error('goal_attempt_transition');
  for (const key of ['attemptId','intentId','application','requestSource','sequence','createdAt'] as const) {
    if (json(next[key]) !== json(found[key])) throw Error('goal_attempt_identity');
  }
  if (found.challenge && json(next.challenge) !== json(found.challenge)) throw Error('goal_attempt_challenge_changed');
  if (found.observation && (!next.observation || next.observation.operationId !== found.observation.operationId
    || next.observation.businessRevision !== found.observation.businessRevision)) throw Error('goal_attempt_operation_changed');
  return current.map(row => row.attemptId === next.attemptId ? next : structuredClone(row));
}
/** The store supplies its own original row, never a caller-provided observation. */
export function finalizeGoalPublicationAttempt(intent: GoalCompletionIntent, attempts: readonly GoalPublicationAttempt[], attemptId: string): GoalCompletionIntent {
  const related = attempts.filter(row => row.intentId === intent.intentId).sort((a, b) => a.sequence - b.sequence);
  const raw = related.at(-1);
  if (!raw || raw.attemptId !== attemptId) throw Error('goal_attempt_not_current');
  const attempt = parseAttempt(raw, intent);
  if (attempt.status !== 'committed') throw Error('goal_attempt_not_committed');
  if (intent.status === 'committed' && json(intent.challenge) === json(attempt.challenge)
    && json(intent.observation) === json(attempt.observation)) return structuredClone(intent);
  if (intent.status !== 'claimed') throw Error('goal_attempt_claim_terminal');
  return parseGoalCompletionIntent({ ...intent, revision: intent.revision + 1, status: 'committed', challenge: attempt.challenge,
    observation: attempt.observation, updatedAt: Math.max(intent.updatedAt, attempt.updatedAt) });
}

/** Checks the complete stored journal without replaying native effects. */
export function validateCapturedGoalCompletionIntents(intents: readonly GoalCompletionIntent[], attempts: readonly GoalPublicationAttempt[]): void {
  const journal = parseGoalPublicationJournal(intents, attempts);
  for (const original of intents) {
    const intent = parseGoalCompletionIntent(original);
    if (intent.status === 'committed' && intent.revision === 2) {
      const last = journal.filter(row => row.intentId === intent.intentId).at(-1);
      if (!last) throw Error('goal_intent_finalization_missing');
      if (intent.updatedAt < last.updatedAt) throw Error('goal_intent_finalization_time');
      // Reuse the original finalizer's idempotent branch: it checks current
      // committed attempt and exact challenge/observation, without any IO.
      finalizeGoalPublicationAttempt(intent, journal, last.attemptId);
    } else validateGoalCompletionIntentRevision(intent);
  }
}

/** Checks the complete stored journal without replaying native effects. */
export function parseGoalPublicationJournal(intents: readonly GoalCompletionIntent[], raw: readonly GoalPublicationAttempt[]): GoalPublicationAttempt[] {
  const byIntent = new Map<string, GoalCompletionIntent>();
  for (const item of intents) {
    const intent = parseGoalCompletionIntent(item);
    if (byIntent.has(intent.intentId)) throw Error('goal_journal_duplicate_intent');
    byIntent.set(intent.intentId, intent);
  }
  const seen = new Set<string>(), grouped = new Map<string, GoalPublicationAttempt[]>();
  return raw.map(item => {
    const intent = byIntent.get(item?.intentId);
    if (!intent) throw Error('goal_journal_orphan_attempt');
    const value = parseAttempt(item, intent), previous = grouped.get(value.intentId) ?? [], last = previous.at(-1);
    if (seen.has(value.attemptId) || previous.length >= 32 || value.sequence !== previous.length + 1
      || value.sequence > 1 && value.requestSource !== 'user'
      || last && (!isGoalPublicationAttemptTerminal(last) || last.status === 'committed')) throw Error('goal_journal_sequence');
    let states = new Set<GoalPublicationAttempt['status']>(['preparing']);
    for (let left = value.revision - 1; left > 0; left--) {
      const next = new Set([...states].flatMap(state => transitions[state]));
      if (next.size === states.size && [...next].every(state => states.has(state))) break;
      states = next;
    }
    if (!states.has(value.status)) throw Error('goal_journal_revision');
    seen.add(value.attemptId); previous.push(value); grouped.set(value.intentId, previous);
    return value;
  });
}
