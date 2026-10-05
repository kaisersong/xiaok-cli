import { assertOrdinarySourceWriterRoute, observeOrdinaryDirectoryWriter } from '../verification/ordinary-source-writer-observation.js';
import {parseGoalForkSourceSnapshot,type GoalForkSourceSnapshot} from '../verification/owner-enrollment-review.js';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { acquireSaveLock } from '../../ai/runtime/session-store/mutation-lock.js';
import { writeFileAtomicallySync, type AtomicWriteFile } from '../../utils/atomic-file.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { parseGoalApplicationBinding, type GoalApplicationBinding } from '../verification/goal-application-binding.js';
import { createGoalState } from './reducer.js';
import { goalVerificationRegistration, parseGoalVerificationDefinition, type GoalVerificationDefinition } from './verification-definition.js';
import type { GoalState } from './types.js';

type Status = 'reserved' | 'enrolling' | 'enrolled' | 'binding' | 'ready' | 'applied' | 'retired' | 'stale';
export interface GoalNativeMutation {
  id: string;
  revision: number;
  sessionId: string;
  kind: 'create' | 'replace' | 'fork';
  forkSource?: {stateHash:string;snapshot:Readonly<GoalForkSourceSnapshot>};
  previous: null | { goalId: string; epoch: number; revision: number; createdAt: number; forkedFromGoalId: string | null; stateHash: string };
  target: Readonly<GoalApplicationBinding>;
  turnLimit: number;
  definition: Readonly<GoalVerificationDefinition>;
  enrollmentRequestId: string;
  applicationRequestId: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
}
export interface GoalNativeMutationUpdate {
  sessionId: string;
  requestSource: 'user' | 'agent' | 'scheduler';
  expectedRevision: number | null;
  next: GoalNativeMutation;
}
const LIMIT = 2 * 1024 ** 2;
const edges: Record<Status, readonly Status[]> = {
  reserved: ['enrolling', 'retired', 'stale'], enrolling: ['enrolled', 'retired', 'stale'],
  enrolled: ['binding', 'retired', 'stale'], binding: ['ready', 'retired', 'stale'],
  ready: ['applied', 'stale'], applied: [], retired: [], stale: [],
};
function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('goal_native_journal_shape');
}
export function isGoalNativeJournalId(value: unknown): value is string {
  return typeof value === 'string' && !!value && Buffer.byteLength(value) <= 160 && !/[\x00-\x1f\x7f]/.test(value);
}
function id(value: unknown): void {
  if (!isGoalNativeJournalId(value)) throw Error('goal_native_journal_id');
}

function integer(value: unknown, minimum = 0): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw Error('goal_native_journal_number');
}
export function parseGoalNativeMutation(raw: unknown): GoalNativeMutation {
  const value = JSON.parse(json(raw));
  shape(value, ['id', 'revision', 'sessionId', 'kind', 'previous', 'target', 'turnLimit', 'definition',
    'enrollmentRequestId', 'applicationRequestId', 'status', 'createdAt', 'updatedAt', ...(Object.hasOwn(value,'forkSource')?['forkSource']:[])]);
  [value.id, value.sessionId, value.enrollmentRequestId, value.applicationRequestId].forEach(id);
  integer(value.revision, 1); integer(value.createdAt); integer(value.updatedAt);
  if (value.updatedAt < value.createdAt || !Object.hasOwn(edges, value.status)
    || !['create', 'replace', 'fork'].includes(value.kind) || value.enrollmentRequestId === value.applicationRequestId) throw Error('goal_native_journal_value');
  value.target = parseGoalApplicationBinding(value.target);
  if (!value.target.expectedEvidenceKinds.length) throw Error('goal_native_journal_evidence');
  value.definition = parseGoalVerificationDefinition(value.definition);
  if (value.target.sessionId !== value.sessionId) throw Error('goal_native_journal_session');
  integer(value.turnLimit, 1);
  if (value.turnLimit > 50) throw Error('goal_native_journal_budget');
  if (value.previous !== null) {
    const previous = value.previous;
    shape(previous, ['goalId', 'epoch', 'revision', 'createdAt', 'forkedFromGoalId', 'stateHash']);
    id(previous.goalId); integer(previous.epoch, 1); integer(previous.revision, 1); integer(previous.createdAt);
    if (previous.forkedFromGoalId !== null) id(previous.forkedFromGoalId);
    if (typeof previous.stateHash !== 'string' || !/^[a-f0-9]{64}$/.test(previous.stateHash)
      || previous.createdAt > value.createdAt) throw Error('goal_native_journal_previous');
  }
  if (value.kind === 'replace') {
    if (!value.previous || value.previous.goalId !== value.target.goalId || value.target.epoch <= value.previous.epoch
      || !Number.isSafeInteger(value.previous.revision + 1)) throw Error('goal_native_journal_previous');
  } else if (value.target.epoch !== 1 || value.previous?.goalId === value.target.goalId) throw Error('goal_native_journal_previous');
  if(value.forkSource!==undefined){
    shape(value.forkSource,['stateHash','snapshot']);
    if(typeof value.forkSource.stateHash!=='string'||!/^[a-f0-9]{64}$/.test(value.forkSource.stateHash))throw Error('goal_native_fork_source');
    value.forkSource.snapshot=parseGoalForkSourceSnapshot(value.forkSource.snapshot);
    const source=value.forkSource.snapshot.source;
    const original = value.forkSource.snapshot.registration.obligations;
    const derived = goalVerificationRegistration(value.definition).obligations;
    if (derived.length < original.length || json(derived.slice(0, original.length)) !== json(original)
      || value.kind === 'fork' && derived.length !== original.length) throw Error('goal_native_fork_definition');
    if (value.kind === 'fork') {
      const application = value.forkSource.snapshot.application;
      if (value.target.objective !== application.objective
        || value.target.completionCriterion !== application.completionCriterion
        || json(value.target.expectedEvidenceKinds) !== json(application.expectedEvidenceKinds)) throw Error('goal_native_fork_application');
    }
    if(value.kind==='create'||source.owner.ownerId===value.target.goalId||source.sessionId===value.sessionId
      ||value.kind==='replace'&&value.previous.forkedFromGoalId!==source.owner.ownerId)throw Error('goal_native_fork_source');
  }
  if(value.kind==='fork'&&(!value.forkSource||value.previous!==null))throw Error('goal_native_fork_source');
  return value as GoalNativeMutation;
}

/** Hash exactly the durable Goal JSON, omitting optional undefined fields. */
export function goalNativeStateHash(state: GoalState | null): string {
  return createHash('sha256').update(json(JSON.parse(JSON.stringify(state)))).digest('hex');
}

/** Deterministic draft only. Calling this function never activates a Goal. */
export function goalNativeCandidate(raw: unknown): GoalState {
  const value = parseGoalNativeMutation(raw), previous = value.kind === 'replace' ? value.previous! : null;
  return { ...createGoalState({ goalId: value.target.goalId, sessionId: value.sessionId, objective: value.target.objective,
    ...(value.target.completionCriterion === null ? {} : { completionCriterion: value.target.completionCriterion }),
    expectedEvidenceKinds: [...value.target.expectedEvidenceKinds], turnLimit: value.turnLimit,
    ...(value.kind==='fork' ? {forkedFromGoalId:value.forkSource!.snapshot.source.owner.ownerId} : previous?.forkedFromGoalId ? { forkedFromGoalId: previous.forkedFromGoalId } : {}),
    now: previous?.createdAt ?? value.createdAt }), epoch: value.target.epoch,
    revision: previous ? previous.revision + 1 : 1, updatedAt: value.createdAt };
}

function validateRecords(sessionId: string, raw: unknown): GoalNativeMutation[] {
  if (!Array.isArray(raw) || raw.length > 32) throw Error('goal_native_journal_capacity');
  const ids = new Set<string>(), requests = new Set<string>();
  return raw.map(item => {
    const value = parseGoalNativeMutation(item);
    if (value.sessionId !== sessionId) throw Error('goal_native_journal_session');
    if (ids.has(value.id) || requests.has(value.enrollmentRequestId) || requests.has(value.applicationRequestId)) throw Error('goal_native_journal_duplicate');
    ids.add(value.id); requests.add(value.enrollmentRequestId); requests.add(value.applicationRequestId); return value;
  });
}

/** Main/CLI-owned recovery facts, not authorization. The byte/count bounds are
 * per session, including all terminal records; no whole-profile bound is claimed. */
export class FileGoalNativeJournal {
  constructor(private readonly rootDir: string, private readonly atomicWrite: AtomicWriteFile = writeFileAtomicallySync) {}

  load(sessionId: string): GoalNativeMutation[] {
    id(sessionId);
    let fd: number;
    try { fd = openSync(this.path(sessionId), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    let encoded: string;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > LIMIT) throw Error('goal_native_journal_capacity');
      const bytes = Buffer.alloc(LIMIT + 1); let size = 0, read: number;
      do { read = readSync(fd, bytes, size, bytes.length - size, null); size += read; } while (read && size < bytes.length);
      if (size > LIMIT) throw Error('goal_native_journal_capacity');
      encoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
    } finally { closeSync(fd); }
    return parseGoalNativeJournalDocument(JSON.parse(encoded), sessionId);
  }

  put(raw: GoalNativeMutationUpdate): void {
    // Capture before filesystem locking, the writer or any host callback.
    const value = JSON.parse(json(raw));
    shape(value, ['sessionId', 'requestSource', 'expectedRevision', 'next']); id(value.sessionId);
    if (value.requestSource !== 'user' && value.requestSource !== 'scheduler') throw Error('goal_native_journal_source');
    if (value.expectedRevision !== null) integer(value.expectedRevision, 1);
    const next = parseGoalNativeMutation(value.next);
    if (next.sessionId !== value.sessionId) throw Error('goal_native_journal_session');
    if (value.requestSource === 'scheduler' && (value.expectedRevision === null || ['reserved', 'enrolling', 'binding'].includes(next.status))) throw Error('goal_native_journal_source');
    assertOrdinarySourceWriterRoute();
    mkdirSync(this.rootDir, { recursive: true });
    const release = acquireSaveLock(join(this.rootDir, '.goal-native.save.lock'));
    try {
      observeOrdinaryDirectoryWriter(this.rootDir, 'goal-file-root');
      assertOrdinarySourceWriterRoute();
      const records = this.load(value.sessionId), index = records.findIndex(row => row.id === next.id), before = records[index];
      if ((before?.revision ?? null) !== value.expectedRevision) throw Error('goal_native_journal_revision');
      if (!before) {
        if (next.revision !== 1 || next.status !== 'reserved') throw Error('goal_native_journal_initial');
        records.push(next);
      } else {
        if (next.revision !== before.revision + 1 || next.updatedAt < before.updatedAt) throw Error('goal_native_journal_revision');
        if (!edges[before.status].includes(next.status)) throw Error('goal_native_journal_transition');
        const immutable = (row: GoalNativeMutation) => { const { revision, status, updatedAt, ...fixed } = row; return json(fixed); };
        if (immutable(before) !== immutable(next)) throw Error('goal_native_journal_immutable');
        records[index] = next;
      }
      validateRecords(value.sessionId, records);
      const encoded = json({ version: 1, sessionId: value.sessionId, records });
      if (Buffer.byteLength(encoded) > LIMIT) throw Error('goal_native_journal_capacity');
      assertOrdinarySourceWriterRoute();
      this.atomicWrite(this.path(value.sessionId), encoded, { requireDirectorySync: true });
    } finally { release(); }
  }

  private path(sessionId: string): string {
    return join(this.rootDir, `${createHash('sha256').update(sessionId).digest('hex')}.native-goal.json`);
  }
}

/** Original document validation; does not read a journal or issue a receipt. */
export function parseGoalNativeJournalDocument(document:unknown,sessionId:string):GoalNativeMutation[]{
  id(sessionId);shape(document,['version','sessionId','records']);
  if(document.version!==1||document.sessionId!==sessionId)throw Error('goal_native_journal_session');
  return validateRecords(sessionId,document.records);
}
