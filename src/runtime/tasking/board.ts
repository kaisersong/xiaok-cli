import { InMemoryTaskStore } from './store.js';
import type { BaseTaskRecord, TaskStatus } from './types.js';

export interface WorkflowTaskRecord extends BaseTaskRecord {
  title: string;
  details?: string;
  owner?: string;
  source: string;
  notes: string[];
  objective: string;
  deliverable?: string;
  selectedSkills: string[];
  acceptanceCriteria: string[];
  blockedReason?: string;
  attemptCount: number;
  lastToolName?: string;
}

export interface CreateWorkflowTaskInput {
  sessionId: string;
  title: string;
  details?: string;
  owner?: string;
  source: string;
  objective?: string;
  deliverable?: string;
  selectedSkills?: string[];
  acceptanceCriteria?: string[];
}

export interface UpdateWorkflowTaskInput {
  title?: string;
  details?: string;
  owner?: string;
  status?: TaskStatus;
  note?: string;
  latestEvent?: string;
  objective?: string;
  deliverable?: string;
  selectedSkills?: string[];
  acceptanceCriteria?: string[];
  blockedReason?: string;
  lastToolName?: string;
  incrementAttempt?: boolean;
}

export interface ListWorkflowTasksInput {
  status?: TaskStatus;
  limit?: number;
}

const UNBLOCKED_STATUSES = new Set<TaskStatus>([
  'queued',
  'running',
  'waiting_approval',
  'completed',
]);

const TERMINAL_STATUSES = new Set<TaskStatus>([
  'completed',
  'failed',
  'cancelled',
]);

const ACTIVE_ATTEMPT_STATUSES = new Set<TaskStatus>([
  'running',
  'waiting_approval',
]);

function cloneTaskRecord(task: WorkflowTaskRecord): WorkflowTaskRecord {
  return {
    ...task,
    notes: [...task.notes],
    selectedSkills: [...task.selectedSkills],
    acceptanceCriteria: [...task.acceptanceCriteria],
  };
}

function normalizeObjective(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function resolveFinishedAt(
  current: WorkflowTaskRecord,
  patchStatus: TaskStatus | undefined,
  nextStatus: TaskStatus,
  startingNewAttempt: boolean,
): number | undefined {
  if (startingNewAttempt) {
    return undefined;
  }

  if (!patchStatus || !TERMINAL_STATUSES.has(nextStatus)) {
    return current.finishedAt;
  }

  if (TERMINAL_STATUSES.has(current.status) && typeof current.finishedAt === 'number') {
    return current.finishedAt;
  }

  return Date.now();
}

export class SessionTaskBoard {
  private readonly store: InMemoryTaskStore<WorkflowTaskRecord, CreateWorkflowTaskInput>;

  constructor(private readonly defaultSource = 'cli') {
    this.store = new InMemoryTaskStore<WorkflowTaskRecord, CreateWorkflowTaskInput>((taskId, now, input) => ({
      taskId,
      sessionId: input.sessionId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      title: input.title,
      details: input.details,
      owner: input.owner,
      source: input.source,
      notes: [],
      objective: normalizeObjective(input.objective, input.title),
      deliverable: input.deliverable,
      selectedSkills: [...(input.selectedSkills ?? [])],
      acceptanceCriteria: [...(input.acceptanceCriteria ?? [])],
      blockedReason: undefined,
      attemptCount: 1,
      lastToolName: undefined,
    }));
  }

  create(sessionId: string, input: Omit<CreateWorkflowTaskInput, 'sessionId' | 'source'> & { source?: string }): WorkflowTaskRecord {
    const task = this.store.create({
      sessionId,
      title: input.title,
      details: input.details,
      owner: input.owner,
      source: input.source ?? this.defaultSource,
      objective: input.objective,
      deliverable: input.deliverable,
      selectedSkills: input.selectedSkills,
      acceptanceCriteria: input.acceptanceCriteria,
    });
    return cloneTaskRecord(task);
  }

  get(sessionId: string, taskId: string): WorkflowTaskRecord | undefined {
    const task = this.store.get(taskId);
    if (!task || task.sessionId !== sessionId) {
      return undefined;
    }
    return cloneTaskRecord(task);
  }

  list(sessionId: string, options: ListWorkflowTasksInput = {}): WorkflowTaskRecord[] {
    const tasks = this.store.listBySession(sessionId)
      .filter((task) => !options.status || task.status === options.status);
    if (typeof options.limit === 'number' && options.limit >= 0) {
      return tasks.slice(0, options.limit).map(cloneTaskRecord);
    }
    return tasks.map(cloneTaskRecord);
  }

  update(sessionId: string, taskId: string, patch: UpdateWorkflowTaskInput): WorkflowTaskRecord | undefined {
    const current = this.get(sessionId, taskId);
    if (!current) {
      return undefined;
    }

    const nextStatus = patch.status ?? current.status;
    const notes = patch.note ? [...current.notes, patch.note] : current.notes;
    const latestEvent = patch.latestEvent ?? patch.note ?? current.latestEvent;
    const activeNextStatus = ACTIVE_ATTEMPT_STATUSES.has(nextStatus);
    const startingNewAttempt = activeNextStatus && (
      TERMINAL_STATUSES.has(current.status)
      || (patch.incrementAttempt === true && ACTIVE_ATTEMPT_STATUSES.has(current.status))
    );
    const blockedReason = nextStatus === 'completed'
      ? undefined
      : typeof patch.blockedReason === 'string'
      ? (patch.blockedReason.trim() ? patch.blockedReason : undefined)
      : (patch.status && UNBLOCKED_STATUSES.has(nextStatus) ? undefined : current.blockedReason);
    const startedAt = startingNewAttempt
      ? Date.now()
      : (patch.status && activeNextStatus && !current.startedAt ? Date.now() : current.startedAt);
    const finishedAt = resolveFinishedAt(current, patch.status, nextStatus, startingNewAttempt);

    const task = this.store.update(taskId, {
      title: patch.title ?? current.title,
      details: patch.details ?? current.details,
      owner: patch.owner ?? current.owner,
      status: nextStatus,
      notes,
      latestEvent,
      objective: normalizeObjective(patch.objective, current.objective),
      deliverable: patch.deliverable ?? current.deliverable,
      selectedSkills: patch.selectedSkills ? [...patch.selectedSkills] : current.selectedSkills,
      acceptanceCriteria: patch.acceptanceCriteria ? [...patch.acceptanceCriteria] : current.acceptanceCriteria,
      blockedReason,
      lastToolName: patch.lastToolName ?? current.lastToolName,
      attemptCount: startingNewAttempt ? current.attemptCount + 1 : current.attemptCount,
      startedAt,
      finishedAt,
    });
    return task ? cloneTaskRecord(task) : undefined;
  }
}
