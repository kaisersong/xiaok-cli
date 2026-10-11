import {createKnownDirectoryWriterFence} from '../verification/known-directory-writer-fence.js';
import { assertOrdinarySourceWriterRoute, observeOrdinaryDirectoryWriter } from '../verification/ordinary-source-writer-observation.js';
import {isDeepStrictEqual} from 'node:util';
import {parseCapturedSourceJson,capturedFields,capturedIdentity,capturedInteger,freezeCapturedData} from '../verification/captured-source-json.js';
import { captureGoalCommitForStore } from './completion-projection.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicallySync, type AtomicWriteFile } from '../../utils/atomic-file.js';
import { acquireSaveLock } from '../../ai/runtime/session-store/mutation-lock.js';
import { MAX_GOAL_TURN_LIMIT, type GoalCommitInput, type GoalDocument, type GoalStore } from './types.js';
import { applyGoalCompletionIntentUpdate, parseGoalCompletionIntent, goalApplicationFromState, type GoalCompletionIntent, type GoalCompletionIntentUpdate } from './completion-intent.js';
import { assertGoalTurnAppend } from './turn-ledger.js';
import { applyGoalPublicationAttemptUpdate, finalizeGoalPublicationAttempt, validateCapturedGoalCompletionIntents, parseGoalPublicationJournal, type GoalPublicationAttempt, type GoalPublicationAttemptUpdate } from './publication-attempt.js';

const GOAL_DOCUMENT_SCHEMA_VERSION = 1;

interface StoredGoalDocument extends GoalDocument {
  schemaVersion: typeof GOAL_DOCUMENT_SCHEMA_VERSION;
  storageRevision: number;
}

export class GoalTamperDetectedError extends Error {
  constructor(sessionId: string) {
    super(`Goal document tamper detected for session ${sessionId}`);
    this.name = 'GoalTamperDetectedError';
  }
}

const knownGoalWriters=new WeakMap<object,{fence:ReturnType<typeof createKnownDirectoryWriterFence>;closed:boolean;pending?:Promise<void>}>();
export class FileGoalStore implements GoalStore {
  private readonly digests = new Map<string, { digest: string; storageRevision: number }>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir: string,
    private readonly atomicWrite: AtomicWriteFile = writeFileAtomicallySync,
  ) {knownGoalWriters.set(this,{fence:createKnownDirectoryWriterFence(rootDir,'goal-file-root'),closed:false});}

  async load(sessionId: string): Promise<GoalDocument | null> {
    const raw = this.readRaw(sessionId);
    if (raw === null) return null;
    return parseDocument(raw);
  }

  async commit(input: GoalCommitInput): Promise<void> {
    // Capture before the queue yields: later caller mutations must not change
    // the state or evidence that this CAS was asked to persist.
    const captured = captureGoalCommitForStore(this, input);
    await this.withQueue(() => this.commitLocked(captured.input, captured.assertProjection));
  }

  async loadCompletionIntent(sessionId: string, intentId: string): Promise<GoalCompletionIntent | null> {
    const document = await this.load(sessionId);
    return document?.completionIntents?.find(intent => intent.intentId === intentId
      && intent.application.sessionId === sessionId) ?? null;
  }

  async listCompletionAttempts(sessionId: string, intentId: string): Promise<GoalPublicationAttempt[]> {
    const document = await this.load(sessionId);
    return document?.completionAttempts?.filter(row => row.intentId === intentId && row.application.sessionId === sessionId) ?? [];
  }

  async updateCompletionAttempt(sessionId: string, update: GoalPublicationAttemptUpdate): Promise<void> {
    const captured = structuredClone(update);
    await this.editCompletionJournal(sessionId, document => {
      const intent = document.completionIntents?.find(row => row.intentId === captured.next.intentId && row.application.sessionId === sessionId);
      if (!intent) throw Error('goal_attempt_intent_missing');
      document.completionAttempts = applyGoalPublicationAttemptUpdate(document.completionAttempts ?? [], intent, captured);
    });
  }

  async finalizeCompletionAttempt(sessionId: string, attemptId: string): Promise<GoalCompletionIntent> {
    let result!: GoalCompletionIntent;
    await this.editCompletionJournal(sessionId, document => {
      const attempt = document.completionAttempts?.find(row => row.attemptId === attemptId && row.application.sessionId === sessionId);
      const intent = document.completionIntents?.find(row => row.intentId === attempt?.intentId && row.application.sessionId === sessionId);
      if (!intent) throw Error('goal_attempt_intent_missing');
      result = finalizeGoalPublicationAttempt(intent, document.completionAttempts ?? [], attemptId);
      document.completionIntents = document.completionIntents!.map(row => row.intentId === result.intentId ? result : row);
    });
    return structuredClone(result);
  }

  private async editCompletionJournal(sessionId: string, edit: (document: GoalDocument) => void): Promise<void> {
    await this.withQueue(async () => {
      const raw = this.readRaw(sessionId);
      if (raw === null) throw Error('goal_intent_document_missing');
      const document = parseDocument(raw); edit(document);
      const nextRaw = JSON.stringify({ schemaVersion: GOAL_DOCUMENT_SCHEMA_VERSION, ...document, storageRevision: nextStorageRevision(raw) }, null, 2);
      assertOrdinarySourceWriterRoute();
      this.atomicWrite(this.filePath(sessionId), nextRaw);
      this.remember(sessionId, nextRaw);
    });
  }

  async updateCompletionIntent(sessionId: string, update: GoalCompletionIntentUpdate): Promise<void> {
    const captured = structuredClone(update);
    await this.withQueue(async () => {
      const raw = this.readRaw(sessionId);
      if (raw === null) throw Error('goal_intent_document_missing');
      const document = parseDocument(raw);
      if (captured.next.application.sessionId !== sessionId) throw Error('goal_intent_identity');
      const completionIntents = applyGoalCompletionIntentUpdate(document.completionIntents ?? [], captured);
      const nextRaw = JSON.stringify({ schemaVersion: GOAL_DOCUMENT_SCHEMA_VERSION, ...document, completionIntents, storageRevision: nextStorageRevision(raw) }, null, 2);
      assertOrdinarySourceWriterRoute();
      this.atomicWrite(this.filePath(sessionId), nextRaw);
      this.remember(sessionId, nextRaw);
    });
  }

  /** User-only cooperative fence; other producers and legacy history stay unknown. */
  fenceKnownWriter(requestSource: 'user' | 'agent' | 'scheduler'): Promise<void> {
    const owner=knownGoalWriters.get(this);
    if(!owner||arguments.length!==1)return Promise.reject(Error('known_writer_fence_owner'));
    if(requestSource!=='user')return Promise.reject(Error('known_writer_fence_request_source'));
    if(!['darwin','linux'].includes(process.platform))return Promise.reject(Error('known_writer_fence_platform'));
    if(owner.pending)return owner.pending;
    owner.closed=true;const accepted=this.queue;
    const work=Promise.resolve().then(async()=>{await accepted;const release=acquireSaveLock(join(this.rootDir,'.goal-store.save.lock'));try{owner.fence.persist();}finally{release();}});
    owner.pending=work;void work.then(()=>{if(owner.pending===work)owner.pending=undefined;},()=>{if(owner.pending===work)owner.pending=undefined;});return work;
  }

  private async withQueue(action: () => Promise<void>): Promise<void> {
    if(knownGoalWriters.get(this)?.closed)throw Error('goal_store_closed');
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    let releaseLock: (() => void) | undefined;
    try {
      assertOrdinarySourceWriterRoute();
      mkdirSync(this.rootDir, { recursive: true });
      releaseLock = acquireSaveLock(join(this.rootDir, '.goal-store.save.lock'));
      knownGoalWriters.get(this)!.fence.assertOpen();
      observeOrdinaryDirectoryWriter(this.rootDir, 'goal-file-root');
      assertOrdinarySourceWriterRoute();
      await action();
    } finally {
      try { releaseLock?.(); } finally { release(); }
    }
  }

  private async commitLocked(input: GoalCommitInput, assertProjection: (current: GoalDocument['state'] | null) => void): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    const raw = this.readRaw(input.sessionId);
    const current = raw === null ? null : parseDocument(raw);
    const revision = current?.state.revision ?? null;
    if (revision !== input.expectedRevision) {
      throw new Error(`stale goal revision: expected ${input.expectedRevision}, found ${revision}`);
    }
    assertProjection(current?.state ?? null);
    assertGoalTurnAppend(current?.turns ?? [], input.turns, input.next);
    const document: StoredGoalDocument = {
      schemaVersion: GOAL_DOCUMENT_SCHEMA_VERSION,
      storageRevision: nextStorageRevision(raw),
      state: structuredClone(input.next),
      events: [...(current?.events ?? []), ...structuredClone(input.events)],
      turns: [...(current?.turns ?? []), ...structuredClone(input.turns)],
      evidence: [...(current?.evidence ?? []), ...structuredClone(input.evidence)],
      completionIntents: applyGoalCompletionIntentUpdate(current?.completionIntents ?? [], input.completionIntent, input.next),
      completionAttempts: structuredClone(current?.completionAttempts ?? []),
    };
    const nextRaw = JSON.stringify(document, null, 2);
    assertOrdinarySourceWriterRoute();
    this.atomicWrite(this.filePath(input.sessionId), nextRaw);
    this.remember(input.sessionId, nextRaw);
  }

  private readRaw(sessionId: string): string | null {
    const filePath = this.filePath(sessionId);
    const known = this.digests.get(sessionId);
    if (!existsSync(filePath)) {
      if (known) throw new GoalTamperDetectedError(sessionId);
      return null;
    }
    const raw = readFileSync(filePath, 'utf8'), version = storageRevision(raw), hash = digest(raw);
    if (known && (version < known.storageRevision || hash !== known.digest && version === known.storageRevision)) {
      throw new GoalTamperDetectedError(sessionId);
    }
    // This detects accidental/out-of-band same-version rewrites. The public
    // file version is not authority; protected completion still needs its ticket.
    this.digests.set(sessionId, { digest: hash, storageRevision: version });
    return raw;
  }

  private remember(sessionId: string, raw: string): void {
    this.digests.set(sessionId, { digest: digest(raw), storageRevision: storageRevision(raw) });
  }

  private filePath(sessionId: string): string {
    return join(this.rootDir, `${sessionId}.goal.json`);
  }
}

function parseDocument(raw: string): GoalDocument {
  const parsed = JSON.parse(raw) as StoredGoalDocument;
  if (parsed.schemaVersion !== GOAL_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported Goal document schema: ${String(parsed.schemaVersion)}`);
  }
  return {
    state: structuredClone(parsed.state),
    events: structuredClone(parsed.events ?? []),
    turns: structuredClone(parsed.turns ?? []),
    evidence: structuredClone(parsed.evidence ?? []),
    completionIntents: structuredClone(parsed.completionIntents ?? []),
    completionAttempts: structuredClone(parsed.completionAttempts ?? []),
  };
}

function digest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}


function storageRevision(raw: string | null): number {
  if (raw === null) return 0;
  const document = JSON.parse(raw);
  const value = Object.hasOwn(document, 'storageRevision') ? document.storageRevision : 0;
  if (!Number.isSafeInteger(value) || value < 0) throw Error('goal_storage_revision');
  return value;
}
function nextStorageRevision(raw: string | null): number {
  const version = storageRevision(raw);
  if (version === Number.MAX_SAFE_INTEGER) throw Error('goal_storage_revision_exhausted');
  return version + 1;
}

/** Untrusted declarations from one captured container. Registration and
 * cross-source relationships remain the full collector's responsibility. */
export function readCapturedGoalSessions(raw: string, sessionId: string) {
  const value = parseCapturedSourceJson(raw) as StoredGoalDocument;
  capturedFields(value, ['schemaVersion','state'], ['storageRevision','events','turns','evidence','completionIntents','completionAttempts']);
  capturedIdentity(sessionId); storageRevision(raw);
  for (const key of ['events','turns','evidence','completionIntents','completionAttempts'] as const) {
    if (value[key] != null && !Array.isArray(value[key])) throw Error('captured_goal_array');
  }
  const document = parseDocument(raw), state = document.state;
  capturedFields(state, ['goalId','revision','epoch','sessionId','objective','expectedEvidenceKinds','status',
    'turnsUsed','tokensUsed','activeWallClockMs','budgetLimits','consecutiveBlockedTurns','createdAt','updatedAt'],
    ['forkedFromGoalId','completionCriterion','terminalReason','pendingCompletionIntentId','blockerFingerprint']);
  capturedIdentity(state.goalId);
  if (state.sessionId !== sessionId || !['active','paused','blocked','complete','cancelled'].includes(state.status)) throw Error('captured_goal_identity');
  for (const key of ['revision','epoch'] as const) capturedInteger(state[key], 1);
  for (const key of ['turnsUsed','tokensUsed','activeWallClockMs','consecutiveBlockedTurns','createdAt'] as const) capturedInteger(state[key]);
  capturedInteger(state.updatedAt, state.createdAt);
  capturedFields(state.budgetLimits, ['turnLimit'], ['tokenLimit','activeWallClockLimitMs']);
  capturedInteger(state.budgetLimits.turnLimit, 1);
  if (state.budgetLimits.turnLimit > MAX_GOAL_TURN_LIMIT) throw Error('captured_goal_budget');
  for (const key of ['tokenLimit','activeWallClockLimitMs'] as const) if (state.budgetLimits[key] !== undefined) capturedInteger(state.budgetLimits[key], 1);
  for (const key of ['terminalReason','blockerFingerprint'] as const) if (state[key] !== undefined && typeof state[key] !== 'string') throw Error('captured_goal_string');
  if (state.pendingCompletionIntentId !== undefined) capturedIdentity(state.pendingCompletionIntentId);
  if (state.forkedFromGoalId !== undefined) capturedIdentity(state.forkedFromGoalId);
  if (typeof state.objective !== 'string' || state.completionCriterion !== undefined && typeof state.completionCriterion !== 'string'
    || !Array.isArray(state.expectedEvidenceKinds) || new Set(state.expectedEvidenceKinds).size !== state.expectedEvidenceKinds.length
    || state.expectedEvidenceKinds.some(kind => !['answer','file_artifact','command_action','project_update'].includes(kind))) throw Error('captured_goal_business_fields');
  goalApplicationFromState(state);
  const goals = new Set([state.goalId]), tasks = new Set<string>(), events = new Set<string>(), evidenceIds = new Set<string>();
  for (const event of document.events) {
    capturedFields(event, ['eventId','goalId','revision','type','actor','recordedAt'], ['reason']);
    capturedIdentity(event.eventId); capturedIdentity(event.goalId); capturedInteger(event.revision, 1); capturedInteger(event.recordedAt);
    if (events.has(event.eventId) || typeof event.type !== 'string' || !event.type || !['user','agent','runtime'].includes(event.actor)
      || event.reason !== undefined && typeof event.reason !== 'string') throw Error('captured_goal_event');
    events.add(event.eventId); goals.add(event.goalId);
  }
  const turns = new Map<string, GoalDocument['turns']>(), turnKeys = new Set<string>();
  for (const turn of document.turns) {
    capturedFields(turn, ['goalId','epoch','turnId','tokensUsed','activeWallClockMs','recordedAt']);
    capturedIdentity(turn.goalId); capturedInteger(turn.epoch, 1);
    const group = JSON.stringify([turn.goalId, turn.epoch]), current = turns.get(group) ?? [];
    assertGoalTurnAppend(current, [turn], turn); current.push(turn); turns.set(group, current);
    turnKeys.add(JSON.stringify([turn.goalId, turn.epoch, turn.turnId])); goals.add(turn.goalId);
  }
  const references = new Map<string, {ownerKind: GoalDocument['evidence'][number]['record']['ownerKind']; ownerId: string}>();
  for (const evidence of document.evidence) {
    capturedFields(evidence, ['goalId','epoch','goalTurnId','evidenceId','record','recordedAt']);
    capturedIdentity(evidence.goalId); capturedIdentity(evidence.goalTurnId); capturedIdentity(evidence.evidenceId);
    capturedInteger(evidence.epoch, 1); capturedInteger(evidence.recordedAt);
    if (evidenceIds.has(evidence.evidenceId) || !turnKeys.has(JSON.stringify([evidence.goalId,evidence.epoch,evidence.goalTurnId]))) throw Error('captured_goal_evidence');
    evidenceIds.add(evidence.evidenceId); goals.add(evidence.goalId);
    const record = evidence.record;
    capturedFields(record, ['ownerKind','ownerId','kind','summary'], ['uri','metadata']); capturedIdentity(record.ownerId);
    if (!['task','loop_stage','loop_run','project','goal'].includes(record.ownerKind)
      || !['answer','file_artifact','command_action','project_update','log_diagnostic','blocked'].includes(record.kind)
      || typeof record.summary !== 'string' || record.uri !== undefined && typeof record.uri !== 'string'
      || record.metadata !== undefined && (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata))) throw Error('captured_goal_evidence_record');
    references.set(JSON.stringify([record.ownerKind,record.ownerId]), {ownerKind:record.ownerKind,ownerId:record.ownerId});
  }
  const intents = (document.completionIntents ?? []).map(parseGoalCompletionIntent);
  for (const intent of intents) {
    if (intent.application.sessionId !== sessionId) throw Error('captured_goal_intent_session');
    if(intent.application.goalId===state.goalId&&intent.application.epoch===state.epoch&&!isDeepStrictEqual(intent.application,goalApplicationFromState(state)))throw Error('captured_goal_intent_application');
    goals.add(intent.application.goalId); tasks.add(intent.taskId);
  }
  const attempts=parseGoalPublicationJournal(intents, document.completionAttempts ?? []);
  validateCapturedGoalCompletionIntents(intents, attempts);
  if (state.pendingCompletionIntentId !== undefined) {
    const pending = intents.find(intent => intent.intentId === state.pendingCompletionIntentId);
    if (!pending || !isDeepStrictEqual(pending.application, goalApplicationFromState(state))) throw Error('captured_goal_pending_intent');
  }
  // Derive only after every original document and journal check succeeds.
  // Group by the original envelope/application identity, never the current Goal.
  type Association = {
    goalId: string; logicalContainerId: string;
    completionTasks: Array<{intentId: string; taskId: string; epoch: number; originalPath: string}>;
    evidenceOwners: Array<GoalDocument['evidence'][number]['record'] & {
      epoch: number; goalTurnId: string; evidenceId: string; originalPath: string; recordedAt: number;
    }>;
  };
  const associations = new Map<string, Association>([...goals].sort().map(goalId => [goalId, {
    goalId, logicalContainerId: sessionId, completionTasks: [], evidenceOwners: [],
  }]));
  intents.forEach((intent, index) => associations.get(intent.application.goalId)!.completionTasks.push({
    intentId: intent.intentId, taskId: intent.taskId, epoch: intent.application.epoch,
    originalPath: `completionIntents[${index}]`,
  }));
  document.evidence.forEach((evidence, index) => associations.get(evidence.goalId)!.evidenceOwners.push({
    ...evidence.record, epoch: evidence.epoch, goalTurnId: evidence.goalTurnId,
    evidenceId: evidence.evidenceId, originalPath: `evidence[${index}]`, recordedAt: evidence.recordedAt,
  }));
  return freezeCapturedData({kind: 'captured-source-declarations' as const, containerSessionId: sessionId,
    goalAssociations: [...associations.values()],
    publication:{intents,attempts},
    declaredGoalIds: Object.freeze([...goals].sort()), declaredTaskIds: Object.freeze([...tasks].sort()),
    referencedOwners: Object.freeze([...references].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,v]) => v)),
    forkedFromGoalId: state.forkedFromGoalId ?? null,
  });
}
