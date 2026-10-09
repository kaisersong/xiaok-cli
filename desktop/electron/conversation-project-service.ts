import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KSwarmService } from './kswarm-service.js';

type Source = 'user' | 'agent' | 'scheduler';
type RecordValue = Record<string, unknown>;
interface UserRequest { prompt: string; permissionMode?: string; threadId?: string }
interface Operation {
  schemaVersion: 1 | 2;
  originThreadId?: string;
  activityOperationId?: string;
  taskId: string;
  prompt: string;
  startPolicy: 'plan_only' | 'activate_and_dispatch_after_plan';
  clientRequestKey: string;
  roomId?: string;
  sourceMessageId?: string;
  proposal?: RecordValue;
  result?: RecordValue;
}

export interface ConversationProjectRoomClient {
  createRoom(input: unknown, context: unknown): Promise<unknown>;
  sendRoomMessage(input: unknown, context: unknown): Promise<unknown>;
  getRoomSnapshot(roomId: string): Promise<unknown>;
}

function record(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

// Conservative admission of a top-level user command. Quoted material,
// questions, diagnosis, and negated requests do not create a durable project.
function requestsCreation(prompt: string): boolean {
  const clause = prompt.trim().split(/[，。；\n]/, 1)[0] ?? '';
  if (/(?:不要|别|不需要|不用|先不|暂不).{0,8}(?:创建|新建|建立|建项目)/.test(clause)) return false;
  if (/(?:项目(?:的)?(?:流程|方法|步骤)|项目.{0,8}(?:是什么|如何|怎么|了吗|是否))/u.test(clause)) return false;
  return /^(?:(?:请(?:你)?|帮我|麻烦(?:你)?|我要|我想(?:要)?|我希望|我要求|现在|直接|先|在xiaok里)\s*)*(?:创建|新建|建立|建).{0,40}项目/u.test(clause)
    || /^(?:please\s+)?(?:create|set up|make)\s+(?:a\s+|an\s+)?(?:xiaok\s+)?project\b/i.test(clause);
}

/** Main owns authorization and side-effect receipts; model input cannot grant access. */
export class ConversationProjectService {
  private readonly admission = new AsyncLocalStorage<UserRequest>();
  private readonly inflight = new Map<string, Promise<RecordValue>>();
  private readonly directory: string;
  private roomClient?: ConversationProjectRoomClient;

  constructor(private readonly options: {
    dataRoot: string;
    kswarmService: Pick<KSwarmService, 'request' | 'getDesktopMutationToken'>;
    activityHooks?: {
      prepare(input: { threadId: string; operationId: string; creationIdempotencyKey: string }): Promise<void>;
      created(input: { threadId: string; operationId: string; projectId: string; roomId?: string; project: RecordValue }): Promise<RecordValue>;
    };
  }) {
    this.directory = join(options.dataRoot, 'conversation-projects');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  bindRoomClient(client: ConversationProjectRoomClient): void { this.roomClient = client; }

  withUserRequest<T>(input: UserRequest, context: { requestSource: Source }, action: () => T): T {
    if (context.requestSource !== 'user') throw new Error('conversation_project_user_source_required');
    return this.admission.run({ ...input }, action);
  }

  bindPreparedTask(input: {
    taskId: string; prompt: string; permissionMode?: string;
    executionScope?: { kind: string; origin?: string };
  }, context: { requestSource: Source }): boolean | Promise<boolean> {
    const admitted = this.admission.getStore();
    if (context.requestSource !== 'user' || !admitted || admitted.prompt !== input.prompt
      || admitted.permissionMode === 'plan' || input.permissionMode === 'plan'
      || input.executionScope && (input.executionScope.kind !== 'goal_turn' || input.executionScope.origin !== 'user')
      || !requestsCreation(admitted.prompt)) return false;
    const prior = this.read(input.taskId);
    if (prior) {
      if (prior.originThreadId && admitted.threadId && prior.originThreadId !== admitted.threadId) throw new Error('conversation_project_origin_conflict');
      if (prior.prompt !== input.prompt) return false;
      return this.options.activityHooks && prior.originThreadId && prior.activityOperationId
        ? this.options.activityHooks.prepare({ threadId: prior.originThreadId, operationId: prior.activityOperationId, creationIdempotencyKey: prior.clientRequestKey }).then(() => true)
        : true;
    }
    const startPolicy = /只(?:要|出)?(?:计划|规划)|先只?规划|不要(?:开始)?执行|暂不执行|先不(?:执行|启动)|不要启动|等我确认|让我审批/.test(input.prompt)
      ? 'plan_only' : 'activate_and_dispatch_after_plan';
    const key = `conversation-project:${createHash('sha256').update(input.taskId).digest('hex')}`;
    const operation: Operation = { schemaVersion: 2, taskId: input.taskId, prompt: input.prompt, startPolicy,
      clientRequestKey: key, ...(admitted.threadId ? { originThreadId: admitted.threadId, activityOperationId: key } : {}) };
    // Journal the trusted creation intent first. If the independent activity
    // database commit is interrupted, startup can reconstruct that association
    // without inventing origin evidence or replaying source creation.
    this.save(operation);
    return this.options.activityHooks && admitted.threadId
      ? this.options.activityHooks.prepare({ threadId: admitted.threadId, operationId: key, creationIdempotencyKey: key }).then(() => true)
      : true;
  }

  isAuthorized(taskId: string): boolean { return Boolean(this.read(taskId)); }

  /** Recover observation receipts, never replay project creation or dispatch. */
  async recoverActivityBindings(): Promise<void> {
    if (!this.options.activityHooks) return;
    let projects: unknown[] | undefined;
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue;
      const operation = this.read(name.slice(0, -5));
      if (!operation?.originThreadId || !operation.activityOperationId) continue;
      await this.options.activityHooks.prepare({ threadId: operation.originThreadId, operationId: operation.activityOperationId, creationIdempotencyKey: operation.clientRequestKey });
      if (operation.result) {
        await this.observeReceipt(operation, operation.result);
      } else if (operation.proposal && operation.roomId && operation.sourceMessageId) {
        // The source may have committed before the process could persist its response.
        // A lookup is safe on restart; creation/dispatch is never replayed here.
        if (!projects) {
          const known = await this.request('/projects');
          projects = Array.isArray(known.projects) ? known.projects : [];
        }
        const project = projects.find(value => record(value) && value.clientRequestKey === operation.clientRequestKey);
        if (record(project) && project.primaryRoomId === operation.roomId) {
          await this.receipt(operation, { ok: true, project, reused: true });
        }
      }
    }
  }


  async create(proposal: RecordValue, context: { requestSource: Source; taskId: string; signal?: AbortSignal }): Promise<RecordValue> {
    context.signal?.throwIfAborted();
    const operation = this.read(context.taskId);
    if (!operation || !['user', 'agent'].includes(context.requestSource)) return { ok: false, error: 'conversation_project_user_authorization_required' };
    if (operation.result) return this.observeReceipt(operation, { ...operation.result, reused: true });
    const pending = this.inflight.get(context.taskId);
    if (pending) return pending;
    const run = this.execute(operation, proposal, context.signal).finally(() => this.inflight.delete(context.taskId));
    this.inflight.set(context.taskId, run);
    return run;
  }

  private filename(taskId: string): string | undefined {
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(taskId) ? join(this.directory, `${taskId}.json`) : undefined;
  }
  private read(taskId: string): Operation | undefined {
    const filename = this.filename(taskId);
    if (!filename || !existsSync(filename)) return undefined;
    try {
      const value = JSON.parse(readFileSync(filename, 'utf8')) as Operation;
      return [1, 2].includes(value.schemaVersion) && value.taskId === taskId && requestsCreation(value.prompt) ? value : undefined;
    } catch { return undefined; }
  }
  private save(operation: Operation): void {
    const filename = this.filename(operation.taskId);
    if (!filename) throw new Error('conversation_project_task_id_invalid');
    const temporary = `${filename}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(operation), { mode: 0o600 });
    renameSync(temporary, filename);
  }
  private async request(path: string, body?: RecordValue, signal?: AbortSignal): Promise<RecordValue> {
    signal?.throwIfAborted();
    const response = await this.options.kswarmService.request(path, body ? {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-kswarm-mutation-token': this.options.kswarmService.getDesktopMutationToken() },
      body: JSON.stringify(body),
    } : { signal });
    const result: unknown = await response.json();
    if (!response.ok || !record(result) || result.ok === false) {
      throw new Error(record(result) ? text(result.error) || text(result.code) || `http_${response.status}` : 'kswarm_response_invalid');
    }
    return result;
  }
  private actor() {
    return { sessionId: 'desktop-main-user', requestSource: 'user' as const,
      actor: { kind: 'user' as const, userId: 'user.local' }, allowedLogicalAgentIds: [], issuedAt: new Date().toISOString() };
  }
  private async receipt(operation: Operation, result: RecordValue): Promise<RecordValue> {
    const project = record(result.project) ? result.project : undefined;
    if (!text(project?.id)) throw new Error('conversation_project_creation_missing_id');
    const receipt = { ...result, ok: true, created: true, projectId: text(project?.id), roomId: operation.roomId };
    operation.result = receipt;
    this.save(operation);
    return this.observeReceipt(operation, receipt);
  }

  private async observeReceipt(operation: Operation, receipt: RecordValue): Promise<RecordValue> {
    if (!this.options.activityHooks || !operation.originThreadId || !operation.activityOperationId) return receipt;
    try {
      const project = record(receipt.project) ? receipt.project : {};
      const activity = await this.options.activityHooks.created({ threadId: operation.originThreadId,
        operationId: operation.activityOperationId, projectId: text(receipt.projectId) || text(project.id), roomId: operation.roomId, project });
      const result = { ...receipt, ...activity, activityStatus: 'active' };
      operation.result = result; this.save(operation); return result;
    } catch (error) {
      // The source commit is already real. Observation failure never reruns it.
      const result = { ...receipt, activityStatus: 'pending', activityError: error instanceof Error ? error.message : 'activity_binding_unavailable' };
      operation.result = result; this.save(operation); return result;
    }
  }

  private async execute(operation: Operation, input: RecordValue, signal?: AbortSignal): Promise<RecordValue> {
    if (!this.roomClient) return { ok: false, error: 'conversation_project_room_service_unavailable' };
    try {
      const proposal = operation.proposal ?? input;
      const name = text(proposal.name), goal = text(proposal.goal), poAgent = text(proposal.poAgent);
      if (!name || !goal || !poAgent) throw new Error('conversation_project_input_invalid');
      const workFolder = text(proposal.workFolder);
      if (workFolder && !operation.prompt.includes(workFolder)) throw new Error('conversation_project_workfolder_not_authorized');
      const count = Number(proposal.memberCount ?? 0);
      if (!Number.isSafeInteger(count) || count < 0 || count > 10) throw new Error('conversation_project_member_count_invalid');
      const agentResult = await this.request('/agents', undefined, signal);
      const agents = Array.isArray(agentResult.agents) ? agentResult.agents.filter(record) : [];
      if (!agents.some(agent => agent.id === poAgent && !agent.archivedAt)) throw new Error('conversation_project_po_unavailable');
      const named = Array.isArray(proposal.memberNames) ? proposal.memberNames.map(text).filter(Boolean) : [];
      const members = [...new Set((Array.isArray(proposal.members) ? proposal.members : []).map(text).filter(id => id && id !== poAgent))];
      for (const value of named) {
        const agent = agents.find(agent => !agent.archivedAt && (agent.id === value || agent.name === value));
        if (!agent) throw new Error('conversation_project_named_agent_unavailable');
        if (agent.id !== poAgent && !members.includes(String(agent.id))) members.push(String(agent.id));
      }
      for (const id of members) if (!agents.some(agent => agent.id === id && !agent.archivedAt)) throw new Error('conversation_project_member_unavailable');
      operation.proposal ??= { ...proposal };
      this.save(operation);

      const expectedWorkers = Math.max(count, members.length, 1);
      for (let slot = 0; members.length < expectedWorkers; slot++) {
        const suffix = createHash('sha256').update(`${operation.clientRequestKey}:worker:${slot}`).digest('hex').slice(0, 12);
        const id = `xiaok-worker-${suffix}`;
        if (members.includes(id)) continue;
        const existing = agents.find(agent => agent.id === id && !agent.archivedAt);
        if (existing) {
          const provenance = record(existing.provisioning) ? existing.provisioning : {};
          if (provenance.operationId !== operation.clientRequestKey || provenance.roleKey !== `worker:${slot}`) throw new Error('conversation_project_worker_identity_conflict');
        } else {
          const created = await this.request('/agents', { id, name: `${name} · worker ${slot + 1} (${suffix.slice(0, 6)})`,
            runtimeType: 'xiaok', runtimeSource: 'desktop-agent-runtime', roles: ['worker'],
            provisioning: { operationId: operation.clientRequestKey, roleKey: `worker:${slot}` } }, signal);
          if (!record(created.agent) || created.agent.id !== id) throw new Error('conversation_project_worker_creation_invalid');
          agents.push(created.agent);
        }
        members.push(id);
      }

      signal?.throwIfAborted();
      if (!operation.roomId) {
        const created = await this.roomClient.createRoom({ title: name, description: goal,
          memberAgentIds: [poAgent, ...members], clientRequestKey: `${operation.clientRequestKey}:room` }, this.actor());
        if (!record(created) || created.ok === false || !record(created.room) || !text(created.room.roomId)) throw new Error(record(created) ? text(created.code) || 'conversation_project_room_creation_failed' : 'conversation_project_room_creation_failed');
        operation.roomId = text(created.room.roomId); this.save(operation);
      }
      signal?.throwIfAborted();
      if (!operation.sourceMessageId) {
        // Recording provenance must not dispatch a second discussion worker.
        const sent = await this.roomClient.sendRoomMessage({ roomId: operation.roomId, text: operation.prompt,
          mentions: [], responsePolicy: 'mentioned', idempotencyKey: `${operation.clientRequestKey}:source` }, this.actor());
        if (!record(sent) || sent.ok === false || !record(sent.message) || !text(sent.message.messageId)) throw new Error(record(sent) ? text(sent.code) || 'conversation_project_source_record_failed' : 'conversation_project_source_record_failed');
        operation.sourceMessageId = text(sent.message.messageId); this.save(operation);
      }
      signal?.throwIfAborted();
      const snapshot = await this.roomClient.getRoomSnapshot(operation.roomId);
      if (!record(snapshot) || snapshot.ok === false) throw new Error('conversation_project_room_snapshot_unavailable');
      const room = record(snapshot.room) ? snapshot.room : {};
      const payload: RecordValue = { name, goal, requirements: text(proposal.requirements), planningGuidance: text(proposal.planningGuidance),
        poAgent, members, executionMode: proposal.executionMode, requestedStartPolicy: operation.startPolicy,
        agentSelection: { poAgent: { agentId: poAgent, source: 'room_selection' }, members: members.map(agentId => ({ agentId, source: 'room_selection' })) },
        primaryRoomId: operation.roomId, sourceMessageIds: [operation.sourceMessageId], clientRequestKey: operation.clientRequestKey,
        expectedRoomRevision: room.revision, requestSource: 'user', ...(workFolder ? { workFolder } : {}),
        ...((snapshot.requiredProtocol ?? room.requiredProtocol) === 'room_workspace_v1' ? { requiredProtocol: 'room_workspace_v1' } : {}) };
      try {
        return this.receipt(operation, await this.request('/projects/room-first', payload, signal));
      } catch (error) {
        // An unknown POST result can already have committed. Query first; never
        // blindly repeat project creation or its initial dispatch.
        const known = await this.request('/projects').catch(() => undefined);
        const project = known && Array.isArray(known.projects) ? known.projects.find(project => record(project) && project.clientRequestKey === operation.clientRequestKey) : undefined;
        if (record(project)) return this.receipt(operation, { ok: true, project, reused: true,
          planningStart: { sent: false, reason: 'creation_response_lost_start_unverified' } });
        throw error;
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return { ok: false, error: error instanceof Error ? error.message : 'conversation_project_creation_failed',
        ...(operation.roomId ? { roomId: operation.roomId } : {}) };
    }
  }
}
