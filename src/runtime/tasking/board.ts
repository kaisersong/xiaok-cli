import { InMemoryTaskStore } from './store.js';
import type { BaseTaskRecord, TaskStatus } from './types.js';

export interface WorkflowTaskRecord extends BaseTaskRecord {
  title: string;
  details?: string;
  owner?: string;
  source: string;
  notes: string[];
}

export interface CreateWorkflowTaskInput {
  sessionId: string;
  title: string;
  details?: string;
  owner?: string;
  source: string;
}

export interface UpdateWorkflowTaskInput {
  title?: string;
  details?: string;
  owner?: string;
  status?: TaskStatus;
  note?: string;
  latestEvent?: string;
}

export interface ListWorkflowTasksInput {
  status?: TaskStatus;
  limit?: number;
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
    }));
  }

  create(sessionId: string, input: Omit<CreateWorkflowTaskInput, 'sessionId' | 'source'> & { source?: string }): WorkflowTaskRecord {
    return this.store.create({
      sessionId,
      title: input.title,
      details: input.details,
      owner: input.owner,
      source: input.source ?? this.defaultSource,
    });
  }

  get(sessionId: string, taskId: string): WorkflowTaskRecord | undefined {
    const task = this.store.get(taskId);
    if (!task || task.sessionId !== sessionId) {
      return undefined;
    }
    return task;
  }

  list(sessionId: string, options: ListWorkflowTasksInput = {}): WorkflowTaskRecord[] {
    const tasks = this.store.listBySession(sessionId)
      .filter((task) => !options.status || task.status === options.status);
    if (typeof options.limit === 'number' && options.limit >= 0) {
      return tasks.slice(0, options.limit);
    }
    return tasks;
  }

  update(sessionId: string, taskId: string, patch: UpdateWorkflowTaskInput): WorkflowTaskRecord | undefined {
    const current = this.get(sessionId, taskId);
    if (!current) {
      return undefined;
    }

    const notes = patch.note ? [...current.notes, patch.note] : current.notes;
    const latestEvent = patch.latestEvent ?? patch.note ?? current.latestEvent;
    return this.store.update(taskId, {
      title: patch.title ?? current.title,
      details: patch.details ?? current.details,
      owner: patch.owner ?? current.owner,
      status: patch.status ?? current.status,
      notes,
      latestEvent,
      startedAt: patch.status === 'running' && !current.startedAt ? Date.now() : current.startedAt,
      finishedAt: patch.status && ['completed', 'failed', 'cancelled'].includes(patch.status)
        ? Date.now()
        : current.finishedAt,
    });
  }
}
