import type { RuntimeEvent } from '../events.js';
import { evaluateArtifactEvidenceGuard } from '../guards/artifact-evidence-guard.js';
import { runDeliverableGate, type DeliverableGateFunction } from './deliverable-gate.js';
import { projectRuntimeEventsToDesktopEvents } from './event-projection.js';
import type { MaterialRegistry } from './material-registry.js';
import { NeedsUserQuestionCorrelator } from './question-correlator.js';
import type { FileTaskSnapshotStore } from './snapshot-store.js';
import { buildTaskUnderstanding } from './task-understanding.js';
import type {
  ArtifactKind,
  ArtifactSummary,
  DesktopTaskEvent,
  MaterialRecord,
  MaterialRole,
  NeedsUserQuestion,
  SalvageSummary,
  TaskContextAudit,
  TaskContextSkip,
  TaskCreateContext,
  TaskCreateInput,
  TaskPermissionMode,
  TaskRuntimeHost,
  TaskSnapshot,
  TaskUnderstanding,
  UserAnswer,
} from './types.js';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TaskRunnerInput {
  taskId: string;
  sessionId: string;
  prompt: string;
  materials: MaterialRecord[];
  understanding: TaskUnderstanding;
  signal: AbortSignal;
  history: HistoryMessage[];
  permissionMode?: 'plan' | 'auto' | 'default';
  emitRuntimeEvent(event: RuntimeEvent): void;
}

export type TaskRunner = (input: TaskRunnerInput) => Promise<void>;

export interface InProcessTaskRuntimeHostOptions {
  materialRegistry: MaterialRegistry;
  snapshotStore: FileTaskSnapshotStore;
  runner: TaskRunner;
  completionGate?: DeliverableGateFunction;
  now?: () => number;
  createTaskId?: () => string;
  createSessionId?: () => string;
  taskWatchdogMs?: number;
  aheGuards?: {
    artifactEvidence?: boolean;
    recoveryContinuity?: boolean;
  };
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
const DEFAULT_CONTEXT_MAX_TASKS = 12;
const DEFAULT_CONTEXT_MAX_USER_CHARS = 4000;
const DEFAULT_CONTEXT_MAX_ASSISTANT_CHARS = 6000;
const DEFAULT_CONTEXT_MAX_TOTAL_CHARS = 30000;

export interface BuildHistoryFromTaskSnapshotsOptions {
  currentTaskId?: string;
  maxTasks?: number;
  maxUserChars?: number;
  maxAssistantChars?: number;
  maxTotalChars?: number;
}

export interface BuildHistoryFromTaskSnapshotsResult {
  history: HistoryMessage[];
  loadedTaskIds: string[];
  skipped: TaskContextSkip[];
}

interface TaskHistoryPair {
  taskId: string;
  user: HistoryMessage;
  assistant: HistoryMessage;
}

export function buildHistoryFromTaskSnapshots(
  snapshots: TaskSnapshot[],
  options: BuildHistoryFromTaskSnapshotsOptions = {},
): BuildHistoryFromTaskSnapshotsResult {
  const maxTasks = options.maxTasks ?? DEFAULT_CONTEXT_MAX_TASKS;
  const maxUserChars = options.maxUserChars ?? DEFAULT_CONTEXT_MAX_USER_CHARS;
  const maxAssistantChars = options.maxAssistantChars ?? DEFAULT_CONTEXT_MAX_ASSISTANT_CHARS;
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_CONTEXT_MAX_TOTAL_CHARS;
  const skipped: TaskContextSkip[] = [];
  const byTaskId = new Map<string, TaskSnapshot>();

  for (const snapshot of snapshots) {
    const taskId = typeof snapshot?.taskId === 'string' ? snapshot.taskId : '';
    if (!taskId) {
      skipped.push({ taskId: '', reason: 'invalid' });
      continue;
    }
    if (options.currentTaskId && taskId === options.currentTaskId) {
      skipped.push({ taskId, reason: 'self' });
      continue;
    }
    if (!isValidContextSnapshot(snapshot)) {
      skipped.push({ taskId, reason: 'invalid' });
      continue;
    }
    if (!TERMINAL_STATUSES.has(snapshot.status)) {
      skipped.push({ taskId, reason: 'non_terminal' });
      continue;
    }
    byTaskId.set(taskId, snapshot);
  }

  const sorted = [...byTaskId.values()].sort((left, right) => {
    const byCreatedAt = left.createdAt - right.createdAt;
    return byCreatedAt !== 0 ? byCreatedAt : left.taskId.localeCompare(right.taskId);
  });
  const overTaskBudget = Math.max(0, sorted.length - Math.max(0, maxTasks));
  for (const snapshot of sorted.slice(0, overTaskBudget)) {
    skipped.push({ taskId: snapshot.taskId, reason: 'too_old' });
  }

  const pairs: TaskHistoryPair[] = sorted.slice(overTaskBudget).map((snapshot) => ({
    taskId: snapshot.taskId,
    user: { role: 'user', content: truncateContextText(snapshot.prompt, maxUserChars) },
    assistant: { role: 'assistant', content: truncateContextText(formatAssistantContext(snapshot), maxAssistantChars) },
  }));

  let totalChars = countHistoryChars(pairs);
  while (pairs.length > 0 && totalChars > maxTotalChars) {
    const dropped = pairs.shift()!;
    skipped.push({ taskId: dropped.taskId, reason: 'too_old' });
    totalChars = countHistoryChars(pairs);
  }

  return {
    history: pairs.flatMap(pair => [pair.user, pair.assistant]),
    loadedTaskIds: pairs.map(pair => pair.taskId),
    skipped,
  };
}

export class InProcessTaskRuntimeHost implements TaskRuntimeHost {
  private readonly questions = new NeedsUserQuestionCorrelator();
  private readonly subscribers = new Map<string, Set<LiveSubscription>>();
  private readonly mutationChains = new Map<string, Promise<void>>();
  private readonly cancellingTaskIds = new Set<string>();
  private readonly taskHistories = new Map<string, HistoryMessage[]>();
  private readonly activeExecutions = new Map<string, ActiveExecution>();
  private readonly executionPromises = new Map<string, Promise<void>>();
  private taskOrdinal = 0;
  private sessionOrdinal = 0;
  private readonly permissionModes = new Map<string, TaskPermissionMode>();

  constructor(private readonly options: InProcessTaskRuntimeHostOptions) {}

  async createTask(input: TaskCreateInput): Promise<{ taskId: string; understanding?: TaskUnderstanding }> {
    const taskId = this.createTaskId();
    if (input.permissionMode) {
      this.permissionModes.set(taskId, input.permissionMode);
    }
    const sessionId = this.createSessionId();
    const materials = input.materials.map((item) => {
      const record = this.options.materialRegistry.get(item.materialId);
      if (!record) {
        throw new Error(`unknown material: ${item.materialId}`);
      }
      return item.role ? { ...record, role: item.role } : record;
    });
    const understanding = buildTaskUnderstanding({ prompt: input.prompt, materials });
    const contextHistory = await this.resolveContextHistory(taskId, input.context);
    this.taskHistories.set(taskId, contextHistory.history);
    const snapshot: TaskSnapshot = {
      taskId,
      sessionId,
      status: 'understanding',
      prompt: input.prompt,
      materials: materials.map((material) => this.options.materialRegistry.toView(material)),
      understanding,
      events: [],
      context: contextHistory.audit,
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    await this.saveSnapshot(snapshot);
    await this.appendEvent(taskId, { type: 'task_started', taskId });
    await this.appendEvent(taskId, { type: 'understanding_updated', understanding });
    const execPromise = this.executeTask(taskId).catch(() => undefined);
    this.executionPromises.set(taskId, execPromise);

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
    const execution = this.activeExecutions.get(taskId);
    if (execution) {
      this.cancellingTaskIds.add(taskId);
      execution.controller.abort();
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

  async getActiveTasks(): Promise<{ taskId: string }[]> {
    return this.options.snapshotStore.getActiveTasks();
  }

  async getActiveTask(): Promise<{ taskId: string } | null> {
    const tasks = await this.getActiveTasks();
    return tasks[0] ?? null;
  }

  async recoverTask(taskId: string): Promise<{ snapshot: TaskSnapshot }> {
    const snapshot = await this.recoverStaleRunningTask(await this.requireSnapshot(taskId));
    this.rehydrateWaitingQuestion(snapshot);
    return { snapshot };
  }

  isExecutingForTest(taskId: string): boolean {
    return this.activeExecutions.has(taskId);
  }

  private async executeTask(taskId: string): Promise<void> {
    const snapshot = await this.requireSnapshot(taskId);
    if (!snapshot.understanding) {
      throw new Error(`task has no understanding: ${taskId}`);
    }

    const materials = snapshot.materials.map((material) => {
      const record = this.options.materialRegistry.get(material.materialId);
      if (!record) {
        throw new Error(`unknown material: ${material.materialId}`);
      }
      return record;
    });
    const controller = new AbortController();
    const taskHistory = this.taskHistories.get(taskId) ?? [];
    this.activeExecutions.set(taskId, { taskId, controller });
    await this.updateSnapshot(taskId, { status: 'running' });

    const watchdogMs = this.options.taskWatchdogMs ?? 30 * 60_000;
    const watchdogTimer = setTimeout(() => controller.abort(), watchdogMs);

    try {
      await this.options.runner({
        taskId,
        sessionId: snapshot.sessionId,
        prompt: snapshot.prompt,
        materials,
        understanding: snapshot.understanding,
        signal: controller.signal,
        history: [...taskHistory],
        permissionMode: this.permissionModes.get(taskId),
        emitRuntimeEvent: (event) => {
          void this.appendRuntimeEvent(taskId, event);
        },
      });
      await this.flushMutations(taskId);
      const latest = await this.requireSnapshot(taskId);
      if (latest.status !== 'cancelled' && !this.cancellingTaskIds.has(taskId)) {
        // Layer 3: Deliverable Gate — check if all requested deliverables were produced
        const gatePass = await runDeliverableGate(latest, this.options.completionGate, controller.signal);
        if (!gatePass && !this.cancellingTaskIds.has(taskId)) {
          // Retry once with a resume prompt
          await this.options.runner({
            taskId,
            sessionId: snapshot.sessionId,
            prompt: '你之前的执行遗漏了部分交付物。请回顾用户原始请求，继续完成所有尚未生成的产物。',
            materials: [],
            understanding: snapshot.understanding,
            signal: controller.signal,
            history: [...taskHistory],
            permissionMode: this.permissionModes.get(taskId),
            emitRuntimeEvent: (event) => {
              void this.appendRuntimeEvent(taskId, event);
            },
          });
          await this.flushMutations(taskId);
        }
        const guardedLatest = await this.requireSnapshot(taskId);
        if (!await this.applyArtifactEvidenceGuard(taskId, guardedLatest)) {
          await this.options.snapshotStore.clearActiveTask(taskId);
          this.closeSubscribers(taskId);
          return;
        }
        if (this.isEmptyDelivery(guardedLatest)) {
          await this.appendEvent(taskId, {
            type: 'progress',
            eventId: `${taskId}:degraded`,
            message: '任务完成但未产出实质内容，已标记为降级交付。',
            stage: 'warning',
          });
          const currentResult = guardedLatest.result ?? { summary: '', artifacts: [] };
          await this.updateSnapshot(taskId, { result: { ...currentResult, degraded: true } });
        }
        await this.updateSnapshot(taskId, { status: 'completed' });
        await this.options.snapshotStore.clearActiveTask(taskId);
        this.closeSubscribers(taskId);
      }
    } catch (error) {
      if (this.cancellingTaskIds.has(taskId)) {
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
      clearTimeout(watchdogTimer);
      this.taskHistories.delete(taskId);
      this.permissionModes.delete(taskId);
      this.activeExecutions.delete(taskId);
      this.executionPromises.delete(taskId);
      this.cancellingTaskIds.delete(taskId);
    }
  }

  private async resolveContextHistory(
    currentTaskId: string,
    context: TaskCreateContext | undefined,
  ): Promise<{ history: HistoryMessage[]; audit?: TaskContextAudit }> {
    if (!context) {
      return { history: [] };
    }

    const requestedTaskIds = dedupeTaskIds(context.taskIds ?? []);
    const skipped: TaskContextSkip[] = [];
    const snapshots: TaskSnapshot[] = [];
    for (const taskId of requestedTaskIds) {
      if (taskId === currentTaskId) {
        skipped.push({ taskId, reason: 'self' });
        continue;
      }
      try {
        const snapshot = await this.options.snapshotStore.recoverTask(taskId);
        if (!snapshot) {
          skipped.push({ taskId, reason: 'missing' });
          continue;
        }
        snapshots.push(snapshot);
      } catch {
        skipped.push({ taskId, reason: 'invalid' });
      }
    }

    const built = buildHistoryFromTaskSnapshots(snapshots, { currentTaskId });
    const threadId = normalizeContextId(context.threadId);
    return {
      history: built.history,
      audit: {
        ...(threadId ? { threadId } : {}),
        taskIds: requestedTaskIds,
        loadedTaskIds: built.loadedTaskIds,
        skipped: [...skipped, ...built.skipped],
      },
    };
  }

  private isEmptyDelivery(snapshot: TaskSnapshot): boolean {
    const summary = snapshot.result?.summary?.trim() ?? '';
    const isFallbackSummary = !summary || summary === '模型没有返回内容。';
    const hasArtifacts = (snapshot.result?.artifacts?.length ?? 0) > 0;
    const hasRecordedArtifacts = snapshot.events.some((e) => e.type === 'artifact_recorded');
    const hasAssistantOutput = snapshot.events.some((e) => e.type === 'assistant_delta');
    return isFallbackSummary && !hasArtifacts && !hasRecordedArtifacts && !hasAssistantOutput;
  }

  private async appendRuntimeEvent(taskId: string, event: RuntimeEvent): Promise<void> {
    const desktopEvents = projectRuntimeEventsToDesktopEvents({ taskId, events: [event] });
    for (const desktopEvent of desktopEvents) {
      await this.appendEvent(taskId, desktopEvent);
    }
  }

  private async applyArtifactEvidenceGuard(taskId: string, snapshot: TaskSnapshot): Promise<boolean> {
    if (!this.options.aheGuards?.artifactEvidence) {
      return true;
    }
    if (!shouldRequireArtifactEvidence(snapshot)) {
      return true;
    }
    if (hasProjectCreationEvidence(snapshot)) {
      return true;
    }
    const artifacts = collectArtifactEvidence(snapshot);
    const decision = evaluateArtifactEvidenceGuard({
      taskId,
      status: 'completed',
      artifacts,
    });
    if (decision.ok) {
      return true;
    }
    await this.appendEvent(taskId, {
      type: 'progress',
      eventId: `${taskId}:guard:artifact-evidence`,
      message: decision.reason,
      stage: 'blocked',
    });
    await this.appendEvent(taskId, { type: 'error', message: decision.reason });
    await this.updateSnapshot(taskId, {
      status: 'failed',
      salvage: {
        summary: ['AHE artifact evidence guard blocked task completion before an empty delivery could be marked complete.'],
        reason: decision.reason,
      },
    });
    return false;
  }

  private async recoverStaleRunningTask(snapshot: TaskSnapshot): Promise<TaskSnapshot> {
    if (snapshot.status !== 'running' || this.activeExecutions.has(snapshot.taskId)) {
      return snapshot;
    }
    const salvage: SalvageSummary = {
      summary: ['任务执行进程已中断，已保留当前快照，可重新发起或基于现有上下文继续。'],
      reason: 'stale_running_task_recovered',
    };
    await this.appendEvent(snapshot.taskId, { type: 'error', message: 'stale_running_task_recovered' });
    await this.updateSnapshot(snapshot.taskId, { status: 'failed', salvage });
    await this.options.snapshotStore.clearActiveTask(snapshot.taskId);
    this.closeSubscribers(snapshot.taskId);
    return this.requireSnapshot(snapshot.taskId);
  }

  private async appendEvent(taskId: string, event: DesktopTaskEvent): Promise<void> {
    await this.enqueueMutation(taskId, async () => {
      const snapshot = await this.requireSnapshot(taskId);
      // Merge artifacts when appending artifact_recorded events
      let nextResult = snapshot.result;
      if (event.type === 'result') {
        nextResult = event.result;
      } else if (event.type === 'artifact_recorded' && snapshot.result) {
        const artifact: ArtifactSummary = {
          artifactId: event.artifactId,
          kind: event.kind as ArtifactKind,
          title: event.label,
          createdAt: event.turnId,
          previewAvailable: event.previewAvailable,
          filePath: event.filePath,
          creator: event.creator ?? 'agent',
        };
        nextResult = {
          ...snapshot.result,
          artifacts: [...(snapshot.result.artifacts || []), artifact],
        };
      }
      const next: TaskSnapshot = {
        ...snapshot,
        events: [...snapshot.events, event],
        result: nextResult,
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
    while (true) {
      const chain = this.mutationChains.get(taskId);
      if (!chain) {
        return;
      }
      await chain;
      if (this.mutationChains.get(taskId) === chain) {
        return;
      }
    }
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

function isValidContextSnapshot(snapshot: TaskSnapshot): boolean {
  return typeof snapshot.taskId === 'string'
    && snapshot.taskId.trim().length > 0
    && typeof snapshot.prompt === 'string'
    && typeof snapshot.createdAt === 'number'
    && typeof snapshot.updatedAt === 'number'
    && typeof snapshot.status === 'string';
}

function formatAssistantContext(snapshot: TaskSnapshot): string {
  const explicitSummary = snapshot.result?.summary?.trim();
  if (explicitSummary) {
    return explicitSummary;
  }

  const resultEvent = [...snapshot.events]
    .reverse()
    .find((event): event is Extract<DesktopTaskEvent, { type: 'result' }> => event.type === 'result');
  const resultSummary = resultEvent?.result.summary?.trim();
  if (resultSummary) {
    return resultSummary;
  }

  const assistantText = snapshot.events
    .filter((event): event is Extract<DesktopTaskEvent, { type: 'assistant_delta' }> => event.type === 'assistant_delta')
    .map(event => event.delta)
    .join('')
    .trim();
  if (assistantText) {
    return assistantText;
  }

  const salvageText = snapshot.salvage?.summary.join('\n').trim();
  if (snapshot.status === 'cancelled') {
    return salvageText ? '上一轮已取消：\n' + salvageText : '上一轮已取消：任务已取消。';
  }
  if (snapshot.status === 'failed') {
    const errorEvent = [...snapshot.events]
      .reverse()
      .find((event): event is Extract<DesktopTaskEvent, { type: 'error' }> => event.type === 'error');
    const failureText = salvageText || errorEvent?.message || '模型没有返回可恢复摘要。';
    return '上一轮失败：\n' + failureText;
  }

  return '模型没有返回内容。';
}

function truncateContextText(text: string, maxChars: number): string {
  if (maxChars < 0 || text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + '[已截断，保留前 ' + maxChars + ' 字符]';
}

function countHistoryChars(pairs: TaskHistoryPair[]): number {
  return pairs.reduce((sum, pair) => sum + pair.user.content.length + pair.assistant.content.length, 0);
}

function dedupeTaskIds(taskIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const rawTaskId of taskIds) {
    const taskId = normalizeContextId(rawTaskId);
    if (!taskId || seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    deduped.push(taskId);
  }
  return deduped;
}

function normalizeContextId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function collectArtifactEvidence(snapshot: TaskSnapshot): unknown[] {
  const resultArtifacts = snapshot.result?.artifacts ?? [];
  const eventArtifacts = snapshot.events.filter((event) => event.type === 'artifact_recorded');
  return [...resultArtifacts, ...eventArtifacts];
}

function hasProjectCreationEvidence(snapshot: TaskSnapshot): boolean {
  return snapshot.events.some((event) => {
    if (event.type !== 'canvas_tool_result') {
      return false;
    }
    if (event.toolName !== 'create_project' || !event.ok) {
      return false;
    }
    return isProjectCardResponse(event.response);
  });
}

function isProjectCardResponse(response: string): boolean {
  try {
    const parsed = JSON.parse(response) as { type?: unknown; projectId?: unknown };
    return parsed.type === 'project_card'
      && typeof parsed.projectId === 'string'
      && parsed.projectId.trim().length > 0;
  } catch {
    return false;
  }
}

function shouldRequireArtifactEvidence(snapshot: TaskSnapshot): boolean {
  const prompt = snapshot.prompt.trim();
  if (!prompt) {
    return false;
  }

  // The current Desktop understanding builder is still sales-deck biased, so
  // the guard follows explicit user wording rather than inferred deliverable.
  if (OPERATIONAL_PROMPT_PATTERN.test(prompt)) {
    return false;
  }
  return ARTIFACT_PROMPT_PATTERN.test(prompt);
}

const OPERATIONAL_PROMPT_PATTERN = /(?:定时任务|提醒我|提醒|闹钟|reminder|schedule|scheduled|继续推进|推进项目|诊断.*项目|项目.*诊断|恢复项目|修复项目|KSwarm|continue_project|让小K帮忙|问小K|卡住|阻塞|stuck project|(?:验证|测试|诊断|检查).*(?:CUA|xiaok_computer_use|cua-driver|Computer Use|computer-use)|(?:CUA|xiaok_computer_use|cua-driver|Computer Use|computer-use).*(?:验证|测试|诊断|检查))/iu;

const ARTIFACT_PROMPT_PATTERN = /(?:ppt|pptx|幻灯片|演示文稿|slides?|deck|报告|文档|文章|故事|小故事|初稿|草稿|稿件|markdown|\.md\b|pdf|word|docx|excel|xlsx|表格|图表|图片|image|html|网页|文件|导出|保存为|生成.*(?:报告|文档|ppt|幻灯片|故事|文章|文件)|写.*(?:报告|文档|故事|文章|稿))/iu;
