import { ASSISTANT_SOURCE_IDS, type AssistantSourceCoverage } from '../shared/assistant-coverage-contract.js';
import type { AssistantSourceRead, AssistantSourceReceipt } from './assistant-source-ports.js';
import type { AssistantLoopProfile } from './assistant-loop-executor.js';
import {
  buildBoundedAssistantSnapshot,
  type AssistantActivityRecord,
  type AssistantActivityScope,
  type AssistantSnapshotLimits,
  type BoundedAssistantSnapshot,
} from './assistant-snapshot-collector.js';

export type AssistantDesktopSnapshotSource =
  | 'task_snapshots'
  | 'kswarm_projects'
  | 'timed_actions'
  | 'meeting_metadata'
  | 'knowledge_source_metadata';

const TASK_TITLE_MAX_CHARS = 160;
const TASK_RESULT_SUMMARY_MAX_CHARS = 800;

export interface AssistantSnapshotQuery {
  from: number;
  to: number;
}

export interface AssistantTaskArtifactMetadata {
  id: string;
  title?: string;
  summary?: string;
  updatedAt?: number;
  priority?: number;
}

export interface AssistantTaskSnapshotMetadata {
  id: string;
  threadId?: string;
  title?: string;
  status?: string;
  summary?: string;
  updatedAt: number;
  priority?: number;
  artifacts?: readonly AssistantTaskArtifactMetadata[];
}

export interface AssistantKSwarmProjectMetadata {
  id: string;
  name: string;
  status?: string;
  summary?: string;
  updatedAt: number;
  priority?: number;
}

export interface AssistantTimedActionMetadata {
  id: string;
  title: string;
  status?: string;
  triggerKind?: string;
  summary?: string;
  dueAt?: number;
  updatedAt: number;
  priority?: number;
}

export interface AssistantMeetingMetadata {
  id: string;
  title: string;
  status?: string;
  summary?: string;
  updatedAt: number;
  priority?: number;
}

export interface AssistantKnowledgeSourceMetadata {
  id: string;
  collectionId: string;
  title: string;
  status?: string;
  summary?: string;
  updatedAt: number;
  priority?: number;
}

export interface AssistantDesktopSnapshotPorts {
  listTaskSnapshots(query: AssistantSnapshotQuery): AssistantSourceRead<AssistantTaskSnapshotMetadata> | Promise<AssistantSourceRead<AssistantTaskSnapshotMetadata>>;
  listKSwarmProjects(query: AssistantSnapshotQuery): AssistantSourceRead<AssistantKSwarmProjectMetadata> | Promise<AssistantSourceRead<AssistantKSwarmProjectMetadata>>;
  listTimedActions(query: AssistantSnapshotQuery): AssistantSourceRead<AssistantTimedActionMetadata> | Promise<AssistantSourceRead<AssistantTimedActionMetadata>>;
  listMeetingMetadata(query: AssistantSnapshotQuery): AssistantSourceRead<AssistantMeetingMetadata> | Promise<AssistantSourceRead<AssistantMeetingMetadata>>;
  listKnowledgeSourceMetadata(query: AssistantSnapshotQuery): AssistantSourceRead<AssistantKnowledgeSourceMetadata> | Promise<AssistantSourceRead<AssistantKnowledgeSourceMetadata>>;
}

export interface AssistantDesktopSnapshot extends Omit<BoundedAssistantSnapshot, 'dropped'> {
  dropped: BoundedAssistantSnapshot['dropped'] & {
    disabledScope: number;
    sourceErrors: number;
  };
  coverage: AssistantSourceCoverage[];
  sourceErrors: Array<{
    source: AssistantDesktopSnapshotSource;
    message: string;
  }>;
}

export interface AssistantDesktopSnapshotReader {
  collect(input: {
    kind: 'evening' | 'morning';
    profile: AssistantLoopProfile;
    now: number;
    window?:{from:number;to:number};
  }): Promise<AssistantDesktopSnapshot>;
}

export function createAssistantDesktopSnapshotReader(
  ports: AssistantDesktopSnapshotPorts,
  options: { limits?: Partial<AssistantSnapshotLimits> } = {},
): AssistantDesktopSnapshotReader {
  return {
    async collect(input) {
      const window = input.window??resolveAssistantSnapshotWindow(input);
      if(!Number.isSafeInteger(window.from)||!Number.isSafeInteger(window.to)||window.from<0||window.to<window.from||window.to>input.now||window.to-window.from>31*86400000)throw Error('assistant_snapshot_window');
      const enabledScopes = new Set<AssistantActivityScope>(input.profile.dataScopes);
      const query = { from: window.from, to: window.to };
      const records: AssistantActivityRecord[] = [];
      const sourceErrors: AssistantDesktopSnapshot['sourceErrors'] = [];
      let disabledScope = 0;
      const emittedBySource = new Map<AssistantSourceCoverage, Set<string>>();
      const coverage: AssistantSourceCoverage[] = ASSISTANT_SOURCE_IDS.map(sourceId => ({
        sourceId, status: 'disabled', requestedWindow: {...query}, recordCount: 0, includedCount: 0,
        checkedAt: input.now, freshUntil: input.now + 30 * 60_000,
      }));
      const read = <T>(source: AssistantDesktopSnapshotSource, load: () => AssistantSourceRead<T> | Promise<AssistantSourceRead<T>>,
        errors: AssistantDesktopSnapshot['sourceErrors'], append: (items: readonly T[]) => void) =>
        readSource(source, load, errors, append, coverage.find(row => row.sourceId === source)!, records, emittedBySource);


      const sources: Array<Promise<void>> = [];
      if (hasAnyScope(enabledScopes, ['threads', 'tasks', 'artifacts'])) {
        sources.push(read('task_snapshots', () => ports.listTaskSnapshots(query), sourceErrors, snapshots => {
          for (const snapshot of snapshots) {
            if (enabledScopes.has('tasks')) {
              records.push(activity({
                id: snapshot.id,
                scope: 'tasks',
                updatedAt: snapshot.updatedAt,
                summary: summarizeTaskSnapshot(snapshot),
                referenceKind: 'task_snapshot',
                referenceId: snapshot.id,
                priority: snapshot.priority ?? 70,
              }));
            } else {
              disabledScope += 1;
            }

            if (snapshot.threadId) {
              if (enabledScopes.has('threads')) {
                records.push(activity({
                  id: snapshot.threadId,
                  scope: 'threads',
                  updatedAt: snapshot.updatedAt,
                  summary: summarizeTaskSnapshot(snapshot),
                  referenceKind: 'thread',
                  referenceId: snapshot.threadId,
                  priority: snapshot.priority ?? 50,
                }));
              } else {
                disabledScope += 1;
              }
            }

            for (const artifact of snapshot.artifacts ?? []) {
              if (enabledScopes.has('artifacts')) {
                records.push(activity({
                  id: `task-artifact:${artifact.id}`,
                  scope: 'artifacts',
                  updatedAt: artifact.updatedAt ?? snapshot.updatedAt,
                  summary: summarize(artifact.title, artifact.summary),
                  referenceKind: 'artifact',
                  referenceId: artifact.id,
                  priority: artifact.priority ?? 40,
                }));
              } else {
                disabledScope += 1;
              }
            }
          }
        }));
      }
      if (enabledScopes.has('projects')) {
        sources.push(read('kswarm_projects', () => ports.listKSwarmProjects(query), sourceErrors, projects => {
          for (const project of projects) {
            records.push(activity({
              id: project.id,
              scope: 'projects',
              updatedAt: project.updatedAt,
              summary: summarize(project.name, project.status, project.summary),
              referenceKind: 'kswarm_project',
              referenceId: project.id,
              priority: project.priority ?? 60,
            }));
          }
        }));
      }
      if (enabledScopes.has('automations')) {
        sources.push(read('timed_actions', () => ports.listTimedActions(query), sourceErrors, actions => {
          for (const action of actions) {
            const updatedAt = isInsideWindow(action.dueAt, window) ? action.dueAt! : action.updatedAt;
            records.push(activity({
              id: action.id,
              scope: 'automations',
              updatedAt,
              summary: summarize(action.title, action.status, action.triggerKind, action.summary),
              referenceKind: 'timed_action',
              referenceId: action.id,
              priority: action.priority ?? 80,
            }));
          }
        }));
      }
      if (enabledScopes.has('meetings')) {
        sources.push(read('meeting_metadata', () => ports.listMeetingMetadata(query), sourceErrors, meetings => {
          for (const meeting of meetings) {
            records.push(activity({
              id: meeting.id,
              scope: 'meetings',
              updatedAt: meeting.updatedAt,
              summary: summarize(meeting.title, meeting.status, meeting.summary),
              referenceKind: 'meeting',
              referenceId: meeting.id,
              priority: meeting.priority ?? 30,
            }));
          }
        }));
      }
      if (enabledScopes.has('artifacts')) {
        sources.push(read('knowledge_source_metadata', () => ports.listKnowledgeSourceMetadata(query), sourceErrors, sources => {
          for (const source of sources) {
            records.push(activity({
              id: `knowledge-source:${source.id}`,
              scope: 'artifacts',
              updatedAt: source.updatedAt,
              summary: summarize(source.title, source.status, source.summary),
              referenceKind: 'knowledge_source',
              referenceId: source.id,
              priority: source.priority ?? 40,
            }));
          }
        }));
      }

      await Promise.all(sources);
      sourceErrors.sort((left, right) => sourceOrder(left.source) - sourceOrder(right.source));
      const bounded = buildBoundedAssistantSnapshot({
        ...window,
        timeZone: input.profile.timeZone,
        records,
        limits: options.limits,
      });
      const result = enforceFinalByteLimit({
        ...bounded,
        dropped: {
          ...bounded.dropped,
          disabledScope,
          sourceErrors: sourceErrors.length,
        },
        sourceErrors,
      } as AssistantDesktopSnapshot, options.limits?.maxSerializedBytes ?? 256 * 1024);
      // Compare by stable scope/reference identity after *all* bounding, including
      // the existing source error envelope. Counts are facts, never LLM output.
      for (const row of coverage) {
        const expected = emittedBySource.get(row);
        if (!expected) continue;
        row.includedCount = result.items.filter(item => expected.has(activityIdentity(item))).length;
        if (row.includedCount < expected.size && row.status === 'checked') {
          row.status = 'partial'; row.errorCode = 'snapshot_bounded';
        }
      }
      // Owner metadata is deliberately outside the bounded LLM payload. Persist
      // explicitly before analysis; never let JSON serialization erase coverage.
      Object.defineProperty(result, 'coverage', {value: coverage, enumerable: false});
      return result;
    },
  };
}

export function resolveAssistantSnapshotWindow(input: {
  kind: 'evening' | 'morning';
  profile: Pick<AssistantLoopProfile, 'timeZone'>;
  now: number;
}): { from: number; to: number } {
  const localNow = localDateTimeParts(input.now, input.profile.timeZone);
  const currentDate = { year: localNow.year, month: localNow.month, day: localNow.day };
  const overdueEvening = input.kind === 'evening' && localNow.hour * 60 + localNow.minute < 4 * 60;
  const activityDate = overdueEvening ? addLocalDays(currentDate, -1) : currentDate;
  const from = localDateStart(activityDate, input.profile.timeZone);
  const nextStart = localDateStart(addLocalDays(activityDate, 1), input.profile.timeZone);
  return {
    from,
    to: overdueEvening ? nextStart - 1 : input.now,
  };
}

function activityIdentity(item: AssistantActivityRecord): string {
  return JSON.stringify([item.scope, item.reference.kind, item.reference.id]);
}
async function readSource<T>(
  source: AssistantDesktopSnapshotSource,
  load: () => AssistantSourceRead<T> | Promise<AssistantSourceRead<T>>,
  errors: AssistantDesktopSnapshot['sourceErrors'],
  append: (items: readonly T[]) => void,
  coverage: AssistantSourceCoverage,
  records: AssistantActivityRecord[],
  emitted: Map<AssistantSourceCoverage, Set<string>>,
): Promise<void> {
  try {
    const value = await load();
    const receipt = Array.isArray(value) ? undefined : value as AssistantSourceReceipt<T>;
    const items = receipt ? receipt.items : value as readonly T[];
    if (!Array.isArray(items) || receipt && (!['available','unavailable'].includes(receipt.availability) || !['complete','partial','unknown'].includes(receipt.completeness))) throw Error('assistant_source_receipt_invalid');
    if (receipt?.availability === 'unavailable') {
      coverage.status = 'unavailable'; coverage.errorCode = 'source_unavailable'; return;
    }
    coverage.recordCount = items.length;
    coverage.status = !receipt || receipt.completeness === 'unknown' ? 'not_checked'
      : receipt.completeness === 'complete' ? 'checked' : 'partial';
    if (coverage.status === 'not_checked') coverage.errorCode = 'completeness_unknown';
    if (coverage.status === 'partial') coverage.errorCode = 'source_incomplete';
    const start = records.length;
    append(items);
    emitted.set(coverage, new Set(records.slice(start).map(activityIdentity)));
  } catch (error) {
    coverage.status = 'unavailable'; coverage.errorCode = 'source_unavailable';
    errors.push({source, message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)});
  }
}

function activity(input: {
  id: string;
  scope: AssistantActivityScope;
  updatedAt: number;
  summary: string;
  referenceKind: string;
  referenceId: string;
  priority: number;
}): AssistantActivityRecord {
  return {
    id: input.id,
    scope: input.scope,
    updatedAt: input.updatedAt,
    summary: input.summary,
    reference: { kind: input.referenceKind, id: input.referenceId },
    priority: input.priority,
  };
}

function summarize(...parts: Array<string | undefined>): string {
  return parts.map(part => part?.trim()).filter(Boolean).join(' · ');
}

function summarizeTaskSnapshot(snapshot: AssistantTaskSnapshotMetadata): string {
  return summarize(
    truncateField(snapshot.title, TASK_TITLE_MAX_CHARS),
    snapshot.status,
    truncateField(snapshot.summary, TASK_RESULT_SUMMARY_MAX_CHARS),
  );
}

function truncateField(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars);
}

function hasAnyScope(scopes: Set<AssistantActivityScope>, candidates: AssistantActivityScope[]): boolean {
  return candidates.some(scope => scopes.has(scope));
}

function isInsideWindow(value: number | undefined, window: { from: number; to: number }): value is number {
  return typeof value === 'number' && value >= window.from && value <= window.to;
}

function enforceFinalByteLimit(snapshot: AssistantDesktopSnapshot, maxBytes: number | undefined): AssistantDesktopSnapshot {
  if (!maxBytes) return snapshot;
  while (snapshot.items.length > 0 && Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > maxBytes) {
    snapshot.items.pop();
    snapshot.dropped.totalBytes += 1;
  }
  return snapshot;
}

function sourceOrder(source: AssistantDesktopSnapshotSource): number {
  return ['task_snapshots', 'kswarm_projects', 'timed_actions', 'meeting_metadata', 'knowledge_source_metadata'].indexOf(source);
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function localDateTimeParts(instant: number, timeZone: string): LocalDate & { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const value = (kind: string) => Number(parts.find(part => part.type === kind)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function addLocalDays(date: LocalDate, amount: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localDateStart(date: LocalDate, timeZone: string): number {
  const targetAsUtc = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localDateTimeParts(candidate, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    candidate += targetAsUtc - actualAsUtc;
  }
  return candidate;
}
