import { randomUUID } from 'node:crypto';
import type { RuntimeActivity } from '../runtime/events.js';

export interface ManagedAgentRunContext {
  onActivity(activity: RuntimeActivity): void;
  takePendingInput(): string | undefined;
}

export type MultiAgentRequestSource = 'user' | 'agent' | 'scheduler';
export type MultiAgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'closed';

export interface ManagedAgentSession {
  run(message: string, signal?: AbortSignal, context?: ManagedAgentRunContext): Promise<string>;
  deactivate?(): Promise<void>;
  suspend?(): Promise<void>;
  dispose(): Promise<void>;
}

export class ManagedAgentSessionCreationError extends AggregateError {
  readonly cleanupError: string;

  constructor(error: unknown, cleanupError: unknown) {
    super([error, cleanupError], 'subagent session initialization cleanup failed');
    this.name = 'ManagedAgentSessionCreationError';
    this.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
}

export interface AgentIdentity {
  id: string;
  taskName: string;
  canonicalName: string;
  parentId: string;
  parentCanonicalName: string;
  depth: number;
}

export interface MultiAgentSnapshot {
  id: string;
  taskName: string;
  canonicalName: string;
  parentId: string | null;
  depth: number;
  status: MultiAgentStatus;
  unreadMessages: number;
  lastResult?: string;
  error?: string;
  turn: number;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  phase?: RuntimeActivity['phase'];
  currentTool?: string;
  executionActive: boolean;
  resourcesReleased: boolean;
  runtimeResident: boolean;
  cleanupError?: string;
  preparedReservation?: boolean;
}

export interface MultiAgentCloseResult {
  closed: true;
  resourcesReleased: boolean;
  cleanupPending: boolean;
  agents: MultiAgentSnapshot[];
}

export interface MultiAgentEvent {
  kind: 'status' | 'activity' | 'message_sent' | 'message_consumed';
  timestamp: number;
  agent: MultiAgentSnapshot;
  message?: InterAgentMessage;
}

export interface InterAgentMessage {
  messageId: string;
  senderId: string;
  receiverId: string;
  text: string;
  kind: 'message' | 'result' | 'error';
  createdAt: number;
}

export interface MultiAgentWaitResult {
  agents: MultiAgentSnapshot[];
  messages: InterAgentMessage[];
  timedOut: boolean;
}

export interface MultiAgentCoordinatorOptions {
  executionMode?: 'automatic' | 'externally_activated';
  externalMailbox?: {
    sendMessage(input: { requestSource: MultiAgentRequestSource; callerId: string; target: string; message: string }): { messageId: string };
    waitForUpdate(input: { requestSource: MultiAgentRequestSource; callerId: string; targets: string[]; timeoutMs: number; signal?: AbortSignal }): Promise<MultiAgentWaitResult>;
  };
  maxResidentAgents?: number;
  maxDepth?: number;
  maxMessageChars?: number;
  maxInboxMessages?: number;
  maxWaitMessages?: number;
  maxResultChars?: number;
  closeSettlementTimeoutMs?: number;
  idleTimeoutMs?: number;
  turnTimeoutMs?: number;
  onEvent?: (event: MultiAgentEvent) => void;
  idGenerator?: () => string;
}

export interface SpawnAgentInput {
  requestSource: MultiAgentRequestSource;
  callerId: string;
  taskName: string;
  message: string;
  createSession(identity: AgentIdentity, signal: AbortSignal): Promise<ManagedAgentSession>;
}

export interface PreparedAgentHandle {
  reservationId: string;
  agentId: string;
  expectedTurn: number;
  snapshot: MultiAgentSnapshot;
}

export interface AgentExecutionHandle {
  agentId: string;
  expectedTurn: number;
  settled: Promise<void>;
  abort(reason?: unknown): void;
}

interface PreparedTurn {
  handle: PreparedAgentHandle;
  record: AgentRecord;
  message: string;
  kind: 'spawn' | 'followup';
  state: 'prepared' | 'activated' | 'rolled_back';
  previous?: Pick<AgentRecord, 'status' | 'turn' | 'error' | 'runtimeResident' | 'lastResult'>;
}

interface AgentRecord {
  id: string;
  taskName: string;
  canonicalName: string;
  parentId: string | null;
  depth: number;
  status: MultiAgentStatus;
  session?: ManagedAgentSession;
  createSession?: (identity: AgentIdentity, signal: AbortSignal) => Promise<ManagedAgentSession>;
  queue: string[];
  inbox: InterAgentMessage[];
  controller?: AbortController;
  execution?: Promise<void>;
  lastResult?: string;
  error?: string;
  closing: boolean;
  resourcesReleased: boolean;
  runtimeResident: boolean;
  cleanup?: Promise<void>;
  cleanupError?: string;
  cleanupSettled?: boolean;
  turn: number;
  startedAt?: number;
  endedAt?: number;
  lastActivityAt?: number;
  phase?: RuntimeActivity['phase'];
  currentTool?: string;
  timedOut?: boolean;
  stopWatchdog?: () => void;
  preparedReservation?: boolean;
  preparedTurnId?: string;
}

const ROOT_AGENT_ID = 'main';
const ROOT_CANONICAL_NAME = '/root';
const DEFAULT_MAX_RESIDENT_AGENTS = 4;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_MESSAGE_CHARS = 8_000;
const DEFAULT_MAX_INBOX_MESSAGES = 100;
const DEFAULT_MAX_WAIT_MESSAGES = 20;
const DEFAULT_MAX_RESULT_CHARS = 20_000;
const DEFAULT_CLOSE_SETTLEMENT_TIMEOUT_MS = 500;
const RESULT_TRUNCATION_MARKER = '\n...[truncated by multi-agent coordinator]';
const TASK_NAME_PATTERN = /^[a-z0-9_]+$/;
const FINAL_STATUSES = new Set<MultiAgentStatus>(['completed', 'failed', 'interrupted', 'closed']);

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function abortError(): DOMException {
  return new DOMException('multi-agent wait aborted', 'AbortError');
}

export class MultiAgentCoordinator {
  private readonly records = new Map<string, AgentRecord>();
  private readonly canonicalIds = new Map<string, string>();
  private readonly waiters = new Set<() => void>();
  private readonly maxResidentAgents: number;
  private readonly maxDepth: number;
  private readonly maxMessageChars: number;
  private readonly maxInboxMessages: number;
  private readonly maxWaitMessages: number;
  private readonly maxResultChars: number;
  private readonly closeSettlementTimeoutMs: number;
  private readonly idGenerator: () => string;
  private readonly idleTimeoutMs: number;
  private readonly turnTimeoutMs: number | undefined;
  private readonly onEvent?: (event: MultiAgentEvent) => void;
  private nextMessageOrdinal = 0;
  private disposed = false;
  private readonly executionMode: 'automatic' | 'externally_activated';
  private readonly externalMailbox?: MultiAgentCoordinatorOptions['externalMailbox'];
  private readonly preparedTurns = new Map<string, PreparedTurn>();

  constructor(options: MultiAgentCoordinatorOptions = {}) {
    this.executionMode = options.executionMode ?? 'automatic';
    this.externalMailbox = options.externalMailbox;
    this.maxResidentAgents = clampInteger(
      options.maxResidentAgents,
      DEFAULT_MAX_RESIDENT_AGENTS,
      2,
      16,
    );
    this.maxDepth = clampInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 16);
    this.maxMessageChars = clampInteger(
      options.maxMessageChars,
      DEFAULT_MAX_MESSAGE_CHARS,
      1,
      100_000,
    );
    this.maxInboxMessages = clampInteger(
      options.maxInboxMessages,
      DEFAULT_MAX_INBOX_MESSAGES,
      1,
      1_000,
    );
    this.maxWaitMessages = clampInteger(
      options.maxWaitMessages,
      DEFAULT_MAX_WAIT_MESSAGES,
      1,
      100,
    );
    this.maxResultChars = clampInteger(
      options.maxResultChars,
      DEFAULT_MAX_RESULT_CHARS,
      100,
      100_000,
    );
    this.closeSettlementTimeoutMs = clampInteger(
      options.closeSettlementTimeoutMs,
      DEFAULT_CLOSE_SETTLEMENT_TIMEOUT_MS,
      1,
      2_000,
    );
    this.idGenerator = options.idGenerator ?? (() => `agent_${randomUUID()}`);
    this.idleTimeoutMs = options.idleTimeoutMs === 0 ? 0 : clampInteger(options.idleTimeoutMs, 5 * 60_000, 10, 3_600_000);
    this.turnTimeoutMs = options.turnTimeoutMs !== undefined && Number.isFinite(options.turnTimeoutMs) && options.turnTimeoutMs > 0
      ? Math.min(2 ** 31 - 1, Math.max(10, Math.floor(options.turnTimeoutMs))) : undefined;
    this.onEvent = options.onEvent;

    const root: AgentRecord = {
      id: ROOT_AGENT_ID,
      taskName: 'root',
      canonicalName: ROOT_CANONICAL_NAME,
      parentId: null,
      depth: 0,
      status: 'running',
      queue: [],
      inbox: [],
      closing: false,
      resourcesReleased: false,
      runtimeResident: true,
      turn: 0,
    };
    this.records.set(root.id, root);
    this.canonicalIds.set(root.canonicalName, root.id);
  }

  async spawn(input: SpawnAgentInput): Promise<MultiAgentSnapshot> {
    if (this.executionMode === 'externally_activated') throw new Error('external mode requires prepareSpawn and applied activation');
    const record = this.createSpawnRecord(input);
    this.publish(record, 'status');
    this.schedule(record);
    this.notifyWaiters();
    return this.snapshot(record);
  }

  private createSpawnRecord(input: SpawnAgentInput): AgentRecord {
    this.assertMutationSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    this.assertMessage(input.message);
    if (typeof input.taskName !== 'string' || !TASK_NAME_PATTERN.test(input.taskName)) {
      throw new Error('task_name must contain only lowercase letters, digits, and underscores');
    }
    const depth = caller.depth + 1;
    if (depth > this.maxDepth) {
      throw new Error(`multi-agent depth exceeded (max=${this.maxDepth}, attempted=${depth})`);
    }
    this.assertRuntimeCapacity();
    const canonicalName = `${caller.canonicalName}/${input.taskName}`;
    if (this.canonicalIds.has(canonicalName)) {
      throw new Error(`agent task already exists: ${canonicalName}`);
    }

    let id = this.idGenerator();
    while (this.records.has(id)) id = this.idGenerator();
    const record: AgentRecord = {
      id,
      taskName: input.taskName,
      canonicalName,
      parentId: caller.id,
      depth,
      status: 'pending',
      createSession: input.createSession,
      queue: this.executionMode === 'automatic' ? [input.message.trim()] : [],
      inbox: [],
      closing: false,
      resourcesReleased: false,
      runtimeResident: this.executionMode === 'automatic',
      ...(this.executionMode === 'externally_activated' ? { preparedReservation: true } : {}),
      turn: 0,
    };
    this.records.set(id, record);
    this.canonicalIds.set(canonicalName, id);
    return record;
  }

  prepareSpawn(input: SpawnAgentInput): PreparedAgentHandle {
    this.assertExternalMode();
    const record = this.createSpawnRecord(input);
    record.turn = 1;
    return this.reservePreparedTurn(record, input.message.trim(), 'spawn');
  }

  prepareFollowup(input: { requestSource: MultiAgentRequestSource; callerId: string; target: string; message: string }): PreparedAgentHandle {
    this.assertExternalMode();
    this.assertMutationSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    const record = this.resolveTarget(input.target);
    this.assertDescendantMutationAllowed(input.requestSource, caller, record, 'followup_task');
    this.assertMessage(input.message);
    if (this.isInClosingSubtree(record) || record.status === 'closed' || record.resourcesReleased) throw new Error('agent is closed');
    if (record.execution || record.controller || record.preparedTurnId) throw new Error('agent is busy; followup requires later external admission');
    if (record.cleanupError) throw new Error(`agent cleanup failed: ${record.cleanupError}`);
    if (!record.runtimeResident) this.assertRuntimeCapacity();
    const previous = { status: record.status, turn: record.turn, error: record.error, runtimeResident: record.runtimeResident, lastResult: record.lastResult };
    record.turn++;
    record.status = 'pending';
    record.error = undefined;
    record.lastResult = undefined;
    record.preparedReservation = true;
    return this.reservePreparedTurn(record, input.message.trim(), 'followup', previous);
  }

  activatePreparedTurn(handle: PreparedAgentHandle, options: { signal?: AbortSignal } = {}): AgentExecutionHandle {
    this.assertExternalMode();
    const prepared = this.requirePreparedTurn(handle);
    const record = prepared.record;
    if (this.disposed || prepared.state !== 'prepared' || this.isInClosingSubtree(record) || record.status !== 'pending') throw new Error('prepared turn is not activatable');
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    prepared.state = 'activated';
    record.preparedTurnId = undefined;
    record.preparedReservation = false;
    record.runtimeResident = true;
    record.queue.push(prepared.message);
    record.controller = controller;
    this.schedule(record, controller);
    const settled = record.execution!.finally(() => options.signal?.removeEventListener('abort', onAbort));
    this.publish(record, 'status');
    this.notifyWaiters();
    return { agentId: record.id, expectedTurn: record.turn, settled, abort: reason => controller.abort(reason) };
  }

  rollbackPrepared(handle: PreparedAgentHandle): void {
    this.assertExternalMode();
    const prepared = this.requirePreparedTurn(handle);
    if (prepared.state === 'rolled_back') return;
    const record = prepared.record;
    if (prepared.state === 'activated' || record.execution || record.controller) throw new Error('activated/live turn cannot be rolled back');
    prepared.state = 'rolled_back';
    record.preparedTurnId = undefined;
    record.preparedReservation = false;
    if (prepared.kind === 'spawn') {
      record.status = 'closed';
      record.closing = true;
      record.createSession = undefined;
      record.resourcesReleased = true;
      record.runtimeResident = false;
      if (this.canonicalIds.get(record.canonicalName) === record.id) this.canonicalIds.delete(record.canonicalName);
    } else Object.assign(record, prepared.previous);
    this.notifyWaiters();
  }

  private reservePreparedTurn(record: AgentRecord, message: string, kind: PreparedTurn['kind'], previous?: PreparedTurn['previous']): PreparedAgentHandle {
    const handle: PreparedAgentHandle = { reservationId: randomUUID(), agentId: record.id, expectedTurn: record.turn, snapshot: this.snapshot(record) };
    record.preparedTurnId = handle.reservationId;
    this.preparedTurns.set(handle.reservationId, { handle, record, message, kind, previous, state: 'prepared' });
    return handle;
  }
  private requirePreparedTurn(handle: PreparedAgentHandle): PreparedTurn {
    const prepared = this.preparedTurns.get(handle.reservationId);
    if (!prepared || prepared.handle.agentId !== handle.agentId || prepared.handle.expectedTurn !== handle.expectedTurn) throw new Error('unknown or stale prepared turn');
    return prepared;
  }
  private assertExternalMode(): void {
    if (this.executionMode !== 'externally_activated') throw new Error('prepare API requires externally_activated mode');
  }

  sendMessage(input: {
    requestSource: MultiAgentRequestSource;
    callerId: string;
    target: string;
    message: string;
  }): { messageId: string } {
    if (this.executionMode === 'externally_activated') {
      if (!this.externalMailbox) throw new Error('external mailbox is service-owned');
      return this.externalMailbox.sendMessage(input);
    }
    this.assertMutationSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    const target = this.resolveTarget(input.target);
    this.assertMessage(input.message);
    if (target.status === 'closed') {
      throw new Error(`target agent is closed: ${target.canonicalName}`);
    }
    if (this.isInClosingSubtree(target)) {
      throw new Error(`target agent is closing: ${target.canonicalName}`);
    }
    if (target.inbox.length >= this.maxInboxMessages) {
      throw new Error(`target inbox is full (max=${this.maxInboxMessages})`);
    }
    const message = this.createMessage(caller.id, target.id, input.message.trim(), 'message');
    target.inbox.push(message);
    this.publish(target, 'message_sent', message);
    this.notifyWaiters();
    return { messageId: message.messageId };
  }

  followupTask(input: {
    requestSource: MultiAgentRequestSource;
    callerId: string;
    target: string;
    message: string;
  }): { queued: true } {
    if (this.executionMode === 'externally_activated') throw new Error('external mode requires prepareFollowup and applied activation');
    this.assertMutationSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    const target = this.resolveTarget(input.target);
    this.assertMessage(input.message);
    if (target.id === ROOT_AGENT_ID) {
      throw new Error('followup_task cannot start a turn on the root agent');
    }
    this.assertDescendantMutationAllowed(input.requestSource, caller, target, 'followup_task');
    if (target.status === 'closed') {
      throw new Error(`target agent is closed: ${target.canonicalName}`);
    }
    if (target.timedOut && target.execution) {
      throw new Error('agent execution is still settling after timeout; cleanup is automatic, do not queue a retry');
    }
    if (this.isInClosingSubtree(target)) {
      throw new Error(`target agent is closing: ${target.canonicalName}`);
    }
    if (target.cleanupError) {
      throw new Error(`agent cleanup failed: ${target.cleanupError}; inspect unreleased resources before creating more work`);
    }
    if (target.controller?.signal.aborted && target.execution) {
      throw new Error('agent execution is still settling after interrupt; wait for executionActive=false before followup');
    }
    if (!target.runtimeResident) {
      this.assertRuntimeCapacity();
      target.runtimeResident = true;
    }
    target.queue.push(input.message.trim());
    if (target.status !== 'running') {
      target.status = 'pending';
      target.error = undefined;
    }
    if (!target.execution) {
      this.schedule(target);
    }
    this.notifyWaiters();
    this.publish(target, 'status');
    return { queued: true };
  }

  listAgents(input: {
    requestSource: MultiAgentRequestSource;
    callerId: string;
  }): MultiAgentSnapshot[] {
    this.assertReadSource(input.requestSource);
    this.requireCaller(input.callerId);
    return [...this.records.values()]
      .sort((left, right) => left.canonicalName.localeCompare(right.canonicalName))
      .map((record) => this.snapshot(record));
  }

  async waitForUpdate(input: {
    requestSource: MultiAgentRequestSource;
    callerId: string;
    targets: string[];
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<MultiAgentWaitResult> {
    if (this.executionMode === 'externally_activated') {
      if (!this.externalMailbox) throw new Error('external mailbox is service-owned');
      return this.externalMailbox.waitForUpdate(input);
    }
    this.assertReadSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    if (input.targets.length === 0) {
      throw new Error('wait_agent targets must be non-empty');
    }
    const targets = input.targets.map((target) => this.resolveTarget(target));
    const targetIds = new Set(targets.map((target) => target.id));
    const buildResult = (): MultiAgentWaitResult | null => {
      const messages = this.drainMessages(caller, targetIds);
      const agents = targets.map((target) => this.snapshot(target));
      if (messages.length > 0 || agents.some((agent) => FINAL_STATUSES.has(agent.status))) {
        return { agents, messages, timedOut: false };
      }
      return null;
    };

    const immediate = buildResult();
    if (immediate) return immediate;
    if (input.signal?.aborted) throw abortError();

    const deadline = Date.now() + Math.max(1, input.timeoutMs);
    while (Date.now() < deadline) {
      await this.waitForSignal(deadline - Date.now(), input.signal);
      const result = buildResult();
      if (result) return result;
    }
    return {
      agents: targets.map((target) => this.snapshot(target)),
      messages: this.drainMessages(caller, targetIds),
      timedOut: true,
    };
  }

  interruptAgent(input: {
    requestSource: MultiAgentRequestSource;
    callerId: string;
    target: string;
  }): { interrupted: boolean } {
    this.assertMutationSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    const target = this.resolveTarget(input.target);
    this.assertDescendantMutationAllowed(input.requestSource, caller, target, 'interrupt');
    if (this.isInClosingSubtree(target)) {
      throw new Error(`target agent is closing: ${target.canonicalName}`);
    }
    const interrupted = Boolean(target.controller && !target.controller.signal.aborted) || target.queue.length > 0;
    if (!interrupted) return { interrupted: false };
    target.queue.length = 0;
    target.stopWatchdog?.();
    target.controller?.abort();
    target.status = 'interrupted';
    target.endedAt = Date.now();
    this.publish(target, 'status');
    this.notifyWaiters();
    return { interrupted };
  }

  async closeAgent(input: {
    requestSource: MultiAgentRequestSource;
    callerId: string;
    target: string;
  }): Promise<MultiAgentCloseResult> {
    this.assertMutationSource(input.requestSource);
    const caller = this.requireCaller(input.callerId);
    const target = this.resolveTarget(input.target);
    this.assertDescendantMutationAllowed(input.requestSource, caller, target, 'close');
    const subtree = [...this.records.values()]
      .filter((record) => record.id === target.id || this.isDescendantOf(record, target.id))
      .sort((left, right) => right.depth - left.depth);
    this.freezeRecords(subtree);
    for (const record of subtree) await this.closeRecord(record);
    return {
      closed: true,
      resourcesReleased: subtree.every((record) => record.resourcesReleased),
      cleanupPending: subtree.some((record) => !record.cleanupSettled),
      agents: subtree.map((record) => this.snapshot(record)),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const descendants = [...this.records.values()]
      .filter((record) => record.id !== ROOT_AGENT_ID && !record.resourcesReleased)
      .sort((left, right) => right.depth - left.depth);
    this.freezeRecords(descendants);
    await Promise.all(descendants.map((record) => this.closeRecord(record)));
    const root = this.records.get(ROOT_AGENT_ID);
    if (root) root.status = 'closed';
    this.notifyWaiters();
  }

  private schedule(record: AgentRecord, externalController?: AbortController): void {
    if (record.execution || this.isClosed(record) || record.cleanupError) return;
    const execution = externalController
      ? Promise.resolve().then(() => this.processQueue(record, externalController))
      : this.processQueue(record);
    record.execution = execution.finally(async () => {
      if (!record.closing && record.queue.length === 0 && !record.cleanupError) {
        try {
          if (record.session?.suspend) {
            await record.session.suspend();
            if (!record.closing && record.queue.length === 0) record.runtimeResident = false;
          } else if (!record.session) {
            record.runtimeResident = false;
          }
        } catch (error) {
          record.cleanupError = error instanceof Error ? error.message : String(error);
          const queuedCount = record.queue.length;
          record.queue.length = 0;
          const failure = `MULTI_AGENT_SUSPEND_FAILED: ${record.cleanupError}; cancelled queued followups=${queuedCount}`;
          if (queuedCount > 0 && !this.isClosed(record)) {
            record.status = 'failed';
            record.error = failure;
          }
          this.notifyParent(record, failure, 'error');
        }
      }
      if (externalController && record.controller === externalController) record.controller = undefined;
      record.execution = undefined;
      if (record.queue.length > 0 && !this.isClosed(record) && !record.cleanupError) {
        record.status = 'pending';
        this.schedule(record);
      }
      this.notifyWaiters();
      this.publish(record, 'status');
    });
  }

  private async processQueue(record: AgentRecord, externalController?: AbortController): Promise<void> {
    while (record.queue.length > 0 && !this.isClosed(record) && !record.cleanupError) {
      const message = record.queue.shift()!;
      const controller = externalController ?? new AbortController();
      record.controller = controller;
      if (!externalController) record.turn += 1;
      record.startedAt = Date.now();
      record.lastActivityAt = record.startedAt;
      record.endedAt = undefined;
      record.phase = 'starting';
      record.currentTool = undefined;
      record.lastResult = undefined;
      record.error = undefined;
      record.timedOut = false;
      const context = this.startWatchdog(record, controller);
      this.publish(record, 'status');
      try {
        if (controller.signal.aborted) throw abortError();
        if (!record.session) {
          const createSession = record.createSession;
          if (!createSession || record.parentId === null) throw new Error('agent session factory is unavailable');
          const parent = this.records.get(record.parentId);
          if (!parent) throw new Error(`parent agent not found: ${record.parentId}`);
          record.session = await createSession({
            id: record.id,
            taskName: record.taskName,
            canonicalName: record.canonicalName,
            parentId: parent.id,
            parentCanonicalName: parent.canonicalName,
            depth: record.depth,
          }, controller.signal);
          record.createSession = undefined;
        }
        if (this.isClosed(record)) return;
        if (controller.signal.aborted) throw abortError();
        record.status = 'running';
        record.error = undefined;
        this.notifyWaiters();
        this.publish(record, 'status');
        const runMessage = this.executionMode === 'automatic' ? this.withInboxContext(record, message) : message;
        const result = await record.session.run(runMessage, controller.signal, context);
        if (this.isClosed(record) || record.timedOut) return;
        if (controller.signal.aborted) throw abortError();
        record.lastResult = this.truncateResult(result);
        record.status = 'completed';
        this.notifyParent(record, record.lastResult, 'result');
      } catch (error) {
        if (error instanceof ManagedAgentSessionCreationError) {
          record.cleanupError = error.cleanupError;
          record.createSession = undefined;
        }
        if (this.isClosed(record) || record.timedOut) return;
        if (controller.signal.aborted || isAbortError(error)) {
          record.status = 'interrupted';
          record.error = undefined;
        } else {
          record.status = 'failed';
          record.error = error instanceof Error ? error.message : String(error);
          this.notifyParent(record, record.error, 'error');
        }
      } finally {
        record.stopWatchdog?.();
        record.endedAt ??= Date.now();
        if (record.controller === controller) record.controller = undefined;
        this.publish(record, 'status');
        this.notifyWaiters();
      }
    }
  }

  private withInboxContext(record: AgentRecord, message: string): string {
    const pending = this.takeInboxInput(record);
    return pending ? `${pending}\n\n${message}` : message;
  }

  private takeInboxInput(record: AgentRecord): string | undefined {
    if (record.inbox.length === 0) return undefined;
    const pending = record.inbox.splice(0, this.maxWaitMessages);
    for (const item of pending) this.publish(record, 'message_consumed', item);
    const lines = pending.map((item) => `[${this.displayName(item.senderId)}] ${item.text}`);
    return `<inter_agent_messages>\n${lines.join('\n')}\n</inter_agent_messages>`;
  }

  private notifyParent(record: AgentRecord, text: string, kind: 'result' | 'error'): void {
    if (this.executionMode === 'externally_activated') return;
    if (!record.parentId) return;
    const parent = this.records.get(record.parentId);
    if (!parent || parent.status === 'closed' || parent.closing || parent.inbox.length >= this.maxInboxMessages) return;
    const message = this.createMessage(record.id, parent.id, text, kind);
    parent.inbox.push(message);
    this.publish(parent, 'message_sent', message);
    this.notifyWaiters();
  }

  private async closeRecord(record: AgentRecord, preserveFailure = false): Promise<void> {
    if (!preserveFailure && record.status !== 'closed') {
      record.status = 'closed';
      this.publish(record, 'status');
      this.notifyWaiters();
    }
    if (!record.cleanup) {
      record.closing = true;
      record.queue.length = 0;
      record.inbox.length = 0;
      record.stopWatchdog?.();
      record.endedAt ??= Date.now();
      record.controller?.abort();
      const execution = record.execution;
      const cleanupStep = async (operation: () => void | Promise<void>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          record.cleanupError = record.cleanupError ? `${record.cleanupError}; ${detail}` : detail;
          this.publish(record, 'status');
          this.notifyParent(record, `MULTI_AGENT_CLEANUP_FAILED: ${record.canonicalName}: ${detail}`, 'error');
          this.notifyWaiters();
        }
      };
      const existingSession = record.session;
      const deactivateExisting = cleanupStep(() => existingSession?.deactivate?.());
      const cleanup = (async () => {
        await deactivateExisting;
        await cleanupStep(() => execution);
        // A child may be using its parent's worktree. Grace-period expiry is
        // not physical settlement; wait for the child cleanup itself.
        await Promise.all([...this.records.values()]
          .filter((child) => child.parentId === record.id)
          .map((child) => child.cleanup));
        const session = record.session;
        if (session) {
          if (session !== existingSession) await cleanupStep(() => session.deactivate?.());
          await cleanupStep(() => session.dispose());
        }
      record.createSession = undefined;
        record.resourcesReleased = !record.cleanupError;
        if (record.resourcesReleased) {
          record.session = undefined;
          record.runtimeResident = false;
          record.preparedReservation = false;
        }
        record.cleanupSettled = true;
        this.publish(record, 'status');
        this.notifyWaiters();
      })();
      record.cleanup = cleanup;
      this.notifyWaiters();
      this.publish(record, 'status');
    }
    await this.waitForCleanup(record.cleanup);
  }

  private assertMutationSource(source: MultiAgentRequestSource): void {
    if (source !== 'agent' && source !== 'user') {
      throw new Error(`request source is not permitted for multi-agent mutation: ${source}`);
    }
    if (this.disposed) throw new Error('multi-agent coordinator is disposed');
  }

  private assertRuntimeCapacity(): void {
    const residents = [...this.records.values()].filter((record) => (record.runtimeResident || record.preparedReservation) && !record.resourcesReleased);
    if (residents.length < this.maxResidentAgents) return;
    const occupied = residents.map((record) => `${record.canonicalName}:${record.status}${record.execution ? ':execution_active' : ''}`).join(', ');
    throw new Error(`multi-agent capacity exceeded (max=${this.maxResidentAgents}, including main). Residents: ${occupied}. Wait for runtimeResident=false or explicitly close_agent unneeded descendants; active or unconfirmed executions keep their slots.`);
  }

  private assertReadSource(source: MultiAgentRequestSource): void {
    if (source !== 'agent' && source !== 'user') {
      throw new Error(`request source is not permitted for multi-agent read: ${source}`);
    }
  }

  private assertMessage(message: string): void {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) throw new Error('message must be non-empty');
    if (trimmed.length > this.maxMessageChars) {
      throw new Error(`message is too long (max=${this.maxMessageChars})`);
    }
  }

  private requireCaller(callerId: string): AgentRecord {
    const caller = this.resolveTarget(callerId);
    if (caller.status === 'closed') throw new Error(`caller agent is closed: ${caller.canonicalName}`);
    if (this.isInClosingSubtree(caller)) {
      throw new Error(`caller agent is closing: ${caller.canonicalName}`);
    }
    return caller;
  }

  private resolveTarget(target: string): AgentRecord {
    const normalized = target === 'main' ? ROOT_AGENT_ID : target;
    const id = this.records.has(normalized) ? normalized : this.canonicalIds.get(normalized);
    const record = id ? this.records.get(id) : undefined;
    if (!record) throw new Error(`unknown agent target: ${target}`);
    return record;
  }

  private assertDescendantMutationAllowed(
    source: MultiAgentRequestSource,
    caller: AgentRecord,
    target: AgentRecord,
    operation: string,
  ): void {
    if (target.id === ROOT_AGENT_ID || target.id === caller.id) {
      throw new Error(`${operation} is not permitted for target ${target.canonicalName}`);
    }
    if (source === 'agent' && !this.isDescendantOf(target, caller.id)) {
      throw new Error(`${operation} is not permitted for non-descendant ${target.canonicalName}`);
    }
  }

  private isDescendantOf(target: AgentRecord, ancestorId: string): boolean {
    let parentId = target.parentId;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId = this.records.get(parentId)?.parentId ?? null;
    }
    return false;
  }

  private isClosed(record: AgentRecord): boolean {
    return record.status === 'closed' || record.closing;
  }

  private isInClosingSubtree(record: AgentRecord): boolean {
    let current: AgentRecord | undefined = record;
    while (current) {
      if (current.closing) return true;
      current = current.parentId ? this.records.get(current.parentId) : undefined;
    }
    return false;
  }

  private freezeRecords(records: AgentRecord[]): void {
    for (const record of records) {
      record.closing = true;
      record.queue.length = 0;
      record.stopWatchdog?.();
      record.controller?.abort();
    }
    this.notifyWaiters();
  }

  private async waitForCleanup(cleanup: Promise<void> | undefined): Promise<void> {
    if (!cleanup) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        cleanup,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.closeSettlementTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private drainMessages(caller: AgentRecord, targetIds: Set<string>): InterAgentMessage[] {
    const matched: InterAgentMessage[] = [];
    const remaining: InterAgentMessage[] = [];
    for (const message of caller.inbox) {
      if (targetIds.has(message.senderId) && matched.length < this.maxWaitMessages) matched.push(message);
      else remaining.push(message);
    }
    caller.inbox = remaining;
    for (const message of matched) this.publish(caller, 'message_consumed', message);
    return matched;
  }

  private createMessage(
    senderId: string,
    receiverId: string,
    text: string,
    kind: InterAgentMessage['kind'],
  ): InterAgentMessage {
    return {
      messageId: `msg_${++this.nextMessageOrdinal}`,
      senderId,
      receiverId,
      text: this.truncateResult(text),
      kind,
      createdAt: Date.now(),
    };
  }

  private truncateResult(result: string): string {
    if (result.length <= this.maxResultChars) return result;
    return `${result.slice(0, this.maxResultChars - RESULT_TRUNCATION_MARKER.length)}${RESULT_TRUNCATION_MARKER}`;
  }

  private displayName(id: string): string {
    return this.records.get(id)?.canonicalName ?? id;
  }

  private snapshot(record: AgentRecord): MultiAgentSnapshot {
    return {
      id: record.id,
      taskName: record.taskName,
      canonicalName: record.canonicalName,
      parentId: record.parentId,
      depth: record.depth,
      status: record.status,
      unreadMessages: record.inbox.length,
      turn: record.turn,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      lastActivityAt: record.lastActivityAt,
      phase: record.phase,
      currentTool: record.currentTool,
      executionActive: Boolean(record.execution || record.controller),
      resourcesReleased: record.resourcesReleased,
      runtimeResident: record.runtimeResident,
      ...(this.executionMode === 'externally_activated' ? { preparedReservation: Boolean(record.preparedReservation) } : {}),
      ...(record.cleanupError ? { cleanupError: record.cleanupError } : {}),
      ...(record.lastResult ? { lastResult: record.lastResult } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }

  private publish(record: AgentRecord, kind: MultiAgentEvent['kind'], message?: InterAgentMessage): void {
    try {
      this.onEvent?.({ kind, timestamp: Date.now(), agent: this.snapshot(record), ...(message ? { message } : {}) });
    } catch { /* Observers cannot own or break execution. */ }
  }

  private startWatchdog(record: AgentRecord, controller: AbortController): ManagedAgentRunContext {
    let idleTimer: ReturnType<typeof setTimeout>;
    let totalTimer: ReturnType<typeof setTimeout>;
    let lastPublishedAt = 0;
    const active = () => record.controller === controller && !controller.signal.aborted && !this.isClosed(record) && !record.timedOut;
    const stop = () => { clearTimeout(idleTimer); clearTimeout(totalTimer); };
    record.stopWatchdog = stop;
    const timeout = (code: string) => {
      if (!active()) return;
      stop();
      record.timedOut = true;
      record.status = 'failed';
      record.endedAt = Date.now();
      record.error = `${code}: ${record.canonicalName} (${record.phase}${record.currentTool ? `:${record.currentTool}` : ''}); stop waiting. Execution may still be settling; do not automatically retry.`;
      record.queue.length = 0;
      this.publish(record, 'status');
      this.notifyParent(record, record.error, 'error');
      controller.abort();
      const subtree = [...this.records.values()]
        .filter((candidate) => candidate.id === record.id || this.isDescendantOf(candidate, record.id))
        .sort((left, right) => right.depth - left.depth);
      this.freezeRecords(subtree);
      for (const child of subtree) void this.closeRecord(child, child.id === record.id);
      this.notifyWaiters();
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      if (!this.idleTimeoutMs) return;
      idleTimer = setTimeout(() => timeout('MULTI_AGENT_IDLE_TIMEOUT'), this.idleTimeoutMs);
      idleTimer.unref?.();
    };
    armIdle();
    if (this.turnTimeoutMs !== undefined) {
      totalTimer = setTimeout(() => timeout('MULTI_AGENT_TURN_TIMEOUT'), this.turnTimeoutMs);
      totalTimer.unref?.();
    }
    return {
      onActivity: (activity) => {
        if (!active()) return;
        const changed = record.phase !== activity.phase || record.currentTool !== activity.toolName;
        record.phase = activity.phase;
        record.currentTool = activity.toolName;
        record.lastActivityAt = Date.now();
        if (activity.phase === 'tool') clearTimeout(idleTimer);
        else armIdle();
        if (changed || Date.now() - lastPublishedAt >= 1_000) {
          lastPublishedAt = Date.now();
          this.publish(record, 'activity');
        }
      },
      takePendingInput: () => this.executionMode === 'automatic' && active() ? this.takeInboxInput(record) : undefined,
    };
  }

  private notifyWaiters(): void {
    for (const waiter of [...this.waiters]) waiter();
  }

  private waitForSignal(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(onUpdate);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onUpdate = () => finish();
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(onUpdate);
        signal?.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      const timer = setTimeout(finish, Math.max(1, timeoutMs));
      this.waiters.add(onUpdate);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export function createMultiAgentCoordinator(
  options: MultiAgentCoordinatorOptions = {},
): MultiAgentCoordinator {
  return new MultiAgentCoordinator(options);
}
