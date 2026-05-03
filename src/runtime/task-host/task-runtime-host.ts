import type { RuntimeEvent } from '../events.js';
import { projectRuntimeEventToDesktopEvent } from './event-projection.js';
import type { MaterialRegistry } from './material-registry.js';
import { NeedsUserQuestionCorrelator } from './question-correlator.js';
import type { FileTaskSnapshotStore } from './snapshot-store.js';
import { buildTaskUnderstanding } from './task-understanding.js';
import type {
  DesktopTaskEvent,
  MaterialRecord,
  MaterialRole,
  NeedsUserQuestion,
  SalvageSummary,
  TaskRuntimeHost,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
} from './types.js';

export interface TaskRunnerInput {
  taskId: string;
  sessionId: string;
  prompt: string;
  materials: MaterialRecord[];
  understanding: TaskUnderstanding;
  signal: AbortSignal;
  emitRuntimeEvent(event: RuntimeEvent): void;
}

export type TaskRunner = (input: TaskRunnerInput) => Promise<void>;

export interface InProcessTaskRuntimeHostOptions {
  materialRegistry: MaterialRegistry;
  snapshotStore: FileTaskSnapshotStore;
  runner: TaskRunner;
  now?: () => number;
  createTaskId?: () => string;
  createSessionId?: () => string;
}

interface LiveSubscription {
  push(event: DesktopTaskEvent): void;
  close(): void;
}

interface ActiveExecution {
  taskId: string;
  controller: AbortController;
}

const TERMINAL_STATUSES = new Set<TaskSnapshot['status']>(['completed', 'failed', 'cancelled']);

export class InProcessTaskRuntimeHost implements TaskRuntimeHost {
  private readonly questions = new NeedsUserQuestionCorrelator();
  private readonly subscribers = new Map<string, Set<LiveSubscription>>();
  private readonly mutationChains = new Map<string, Promise<void>>();
  private readonly cancellingTaskIds = new Set<string>();
  private activeExecution: ActiveExecution | null = null;
  private taskOrdinal = 0;
  private sessionOrdinal = 0;

  constructor(private readonly options: InProcessTaskRuntimeHostOptions) {}

  async createTask(input: {
    prompt: string;
    materials: Array<{ materialId: string; role?: MaterialRole }>;
  }): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    const activeTask = await this.options.snapshotStore.getActiveTask();
    if (activeTask) {
      throw new Error(`active task already exists: ${activeTask.taskId}`);
    }

    const taskId = this.createTaskId();
    const sessionId = this.createSessionId();
    const materials = input.materials.map((item) => {
      const record = this.options.materialRegistry.get(item.materialId);
      if (!record) {
        throw new Error(`unknown material: ${item.materialId}`);
      }
      return item.role ? { ...record, role: item.role } : record;
    });
    const understanding = buildTaskUnderstanding({ prompt: input.prompt, materials });
    const snapshot: TaskSnapshot = {
      taskId,
      sessionId,
      status: 'understanding',
      prompt: input.prompt,
      materials: materials.map((material) => this.options.materialRegistry.toView(material)),
      understanding,
      events: [],
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    await this.saveSnapshot(snapshot);
    await this.appendEvent(taskId, { type: 'task_started', taskId });
    await this.appendEvent(taskId, { type: 'understanding_updated', understanding });
    void this.executeTask(taskId).catch(() => undefined);

    return { taskId, understanding };
  }

  async *subscribeTask(taskId: string): AsyncIterable<DesktopTaskEvent> {
    const snapshot = await this.requireSnapshot(taskId);
    for (const event of snapshot.events) {
      yield event;
    }

    if (TERMINAL_STATUSES.has(snapshot.status)) {
      return;
    }

    const queue: DesktopTaskEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const subscription: LiveSubscription = {
      push(event) {
        queue.push(event);
        wake?.();
        wake = null;
      },
      close() {
        closed = true;
        wake?.();
        wake = null;
      },
    };
    this.addSubscriber(taskId, subscription);
    try {
      while (!closed || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield queue.shift()!;
      }
    } finally {
      this.removeSubscriber(taskId, subscription);
    }
  }

  async answerQuestion(input: { taskId: string; answer: UserAnswer }): Promise<void> {
    const result = this.questions.answer(input.taskId, input.answer);
    if (result.status === 'not_found') {
      throw new Error(`question not found: ${input.answer.questionId}`);
    }
    if (result.status === 'stale') {
      throw new Error(`stale question answer: ${input.answer.questionId}`);
    }
    if (
      result.question.kind === 'confirm_understanding'
      && input.answer.type === 'choice'
      && input.answer.choiceId === 'confirm'
    ) {
      await this.executeTask(input.taskId);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const snapshot = await this.requireSnapshot(taskId);
    if (TERMINAL_STATUSES.has(snapshot.status)) {
      return;
    }
    if (this.activeExecution?.taskId === taskId) {
      this.cancellingTaskIds.add(taskId);
      this.activeExecution.controller.abort();
    }

    const salvage: SalvageSummary = {
      summary: ['任务已取消，可基于已识别的任务理解继续。'],
      reason: 'cancelled',
    };
    await this.appendEvent(taskId, { type: 'salvage', salvage });
    await this.updateSnapshot(taskId, {
      status: 'cancelled',
      salvage,
    });
    await this.options.snapshotStore.clearActiveTask(taskId);
    this.closeSubscribers(taskId);
  }

  async getActiveTask(): Promise<{ taskId: string } | null> {
    return this.options.snapshotStore.getActiveTask();
  }

  async recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }> {
    const snapshot = await this.requireSnapshot(taskId);
    this.rehydrateWaitingQuestion(snapshot);
    return { snapshot };
  }

  isExecutingForTest(taskId: string): boolean {
    return this.activeExecution?.taskId === taskId;
  }

  private async executeTask(taskId: string): Promise<void> {
    const snapshot = await this.requireSnapshot(taskId);
    if (!snapshot.understanding) {
      throw new Error(`task has no understanding: ${taskId}`);
    }
    if (this.activeExecution) {
      throw new Error(`active execution already exists: ${this.activeExecution.taskId}`);
    }

    const materials = snapshot.materials.map((material) => {
      const record = this.options.materialRegistry.get(material.materialId);
      if (!record) {
        throw new Error(`unknown material: ${material.materialId}`);
      }
      return record;
    });
    const controller = new AbortController();
    this.activeExecution = { taskId, controller };
    await this.updateSnapshot(taskId, { status: 'running' });

    try {
      await this.options.runner({
        taskId,
        sessionId: snapshot.sessionId,
        prompt: snapshot.prompt,
        materials,
        understanding: snapshot.understanding,
        signal: controller.signal,
        emitRuntimeEvent: (event) => {
          void this.appendRuntimeEvent(taskId, event);
        },
      });
      await this.flushMutations(taskId);
      const latest = await this.requireSnapshot(taskId);
      if (latest.status !== 'cancelled' && !this.cancellingTaskIds.has(taskId)) {
        await this.updateSnapshot(taskId, { status: 'completed' });
        await this.options.snapshotStore.clearActiveTask(taskId);
        this.closeSubscribers(taskId);
      }
    } catch (error) {
      if ((await this.requireSnapshot(taskId)).status === 'cancelled') {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const salvage: SalvageSummary = {
        summary: [
          snapshot.understanding ? '已保留任务理解' : '已保留任务输入',
          `已保留 ${snapshot.materials.length} 个材料引用`,
        ],
        reason: message,
      };
      await this.appendEvent(taskId, { type: 'error', message });
      await this.updateSnapshot(taskId, { status: 'failed', salvage });
      await this.options.snapshotStore.clearActiveTask(taskId);
      this.closeSubscribers(taskId);
      throw error;
    } finally {
      if (this.activeExecution?.taskId === taskId) {
        this.activeExecution = null;
      }
      this.cancellingTaskIds.delete(taskId);
    }
  }

  private async appendRuntimeEvent(taskId: string, event: RuntimeEvent): Promise<void> {
    const desktopEvent = projectRuntimeEventToDesktopEvent({ taskId, event });
    if (desktopEvent) {
      await this.appendEvent(taskId, desktopEvent);
    }
  }

  private async appendEvent(taskId: string, event: DesktopTaskEvent): Promise<void> {
    await this.enqueueMutation(taskId, async () => {
      const snapshot = await this.requireSnapshot(taskId);
      const next: TaskSnapshot = {
        ...snapshot,
        events: [...snapshot.events, event],
        result: event.type === 'result' ? event.result : snapshot.result,
        salvage: event.type === 'salvage' ? event.salvage : snapshot.salvage,
        updatedAt: this.now(),
      };
      await this.saveSnapshot(next);
      this.pushLiveEvent(taskId, event);
    });
  }

  private async updateSnapshot(
    taskId: string,
    patch: Partial<Pick<TaskSnapshot, 'status' | 'result' | 'salvage'>>,
  ): Promise<void> {
    await this.enqueueMutation(taskId, async () => {
      const snapshot = await this.requireSnapshot(taskId);
      await this.saveSnapshot({
        ...snapshot,
        ...patch,
        updatedAt: this.now(),
      });
    });
  }

  private async enqueueMutation(taskId: string, action: () => Promise<void>): Promise<void> {
    const previous = this.mutationChains.get(taskId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.mutationChains.set(taskId, next.catch(() => undefined));
    await next;
  }

  private async flushMutations(taskId: string): Promise<void> {
    await (this.mutationChains.get(taskId) ?? Promise.resolve());
  }

  private async saveSnapshot(snapshot: TaskSnapshot): Promise<void> {
    await this.options.snapshotStore.save(snapshot);
  }

  private async requireSnapshot(taskId: string): Promise<TaskSnapshot> {
    const snapshot = await this.options.snapshotStore.recoverTask(taskId);
    if (!snapshot) {
      throw new Error(`task not found: ${taskId}`);
    }
    return snapshot;
  }

  private rehydrateWaitingQuestion(snapshot: TaskSnapshot): void {
    if (TERMINAL_STATUSES.has(snapshot.status)) {
      return;
    }
    const questionEvent = [...snapshot.events]
      .reverse()
      .find((event): event is Extract<DesktopTaskEvent, { type: 'needs_user' }> => event.type === 'needs_user');
    if (questionEvent) {
      this.questions.publish(questionEvent.question);
    }
  }

  private addSubscriber(taskId: string, subscription: LiveSubscription): void {
    const existing = this.subscribers.get(taskId) ?? new Set<LiveSubscription>();
    existing.add(subscription);
    this.subscribers.set(taskId, existing);
  }

  private removeSubscriber(taskId: string, subscription: LiveSubscription): void {
    const existing = this.subscribers.get(taskId);
    if (!existing) {
      return;
    }
    existing.delete(subscription);
    if (existing.size === 0) {
      this.subscribers.delete(taskId);
    }
  }

  private pushLiveEvent(taskId: string, event: DesktopTaskEvent): void {
    for (const subscriber of this.subscribers.get(taskId) ?? []) {
      subscriber.push(event);
    }
  }

  private closeSubscribers(taskId: string): void {
    for (const subscriber of this.subscribers.get(taskId) ?? []) {
      subscriber.close();
    }
    this.subscribers.delete(taskId);
  }

  private createTaskId(): string {
    if (this.options.createTaskId) {
      return this.options.createTaskId();
    }
    this.taskOrdinal += 1;
    return `task_${this.taskOrdinal}`;
  }

  private createSessionId(): string {
    if (this.options.createSessionId) {
      return this.options.createSessionId();
    }
    this.sessionOrdinal += 1;
    return `sess_${this.sessionOrdinal}`;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
