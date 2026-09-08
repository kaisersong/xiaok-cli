import { createHash, randomUUID } from 'node:crypto';
import type { ToolPermissionGrant } from '../../src/types.js';
import type { DesktopAgentActor, DesktopMultiAgentUserAccess, DesktopAgentExecutionContext } from './desktop-multi-agent-service.js';
import type { DesktopApprovalInvocation } from './desktop-multi-agent-capabilities.js';
import { DesktopMultiAgentStore, captureApprovalOperationForWrite, encodeMultiAgentRow } from './desktop-multi-agent-store.js';
import type { ApprovalRequestOperation, MultiAgentApprovalDurable, MultiAgentApprovalReason, MultiAgentControlResult,
  MultiAgentApprovalView, MultiAgentPendingApproval } from '../shared/multi-agent-types.js';

type Source = 'user' | 'agent' | 'scheduler';
export interface DesktopApprovalOwner { readonly ownerId: string }
export type DesktopApprovalFailure = { groupId: string; bootId: string; code: 'multi_agent_approval_persistence_failed' };
export interface DesktopApprovalServicePort {
  readonly approvalCapacity: number;
  bindApprovalTransport(transport: DesktopMultiAgentApprovalTransport): DesktopApprovalOwner;
  runApprovalCommand<T>(owner: DesktopApprovalOwner, groupId: string, syncAction: () => T): Promise<T>;
  assertInvocation(actor: DesktopAgentActor, context?: DesktopAgentExecutionContext): void;
  getApprovalDeadline(actor: DesktopAgentActor): number;
  assertApprovalUserAccess(access: DesktopMultiAgentUserAccess, requestSource: Source, groupId: string): {
    actorId: string; threadId: string; profileId: string; workspaceId: string;
  };
  expireApprovalActor(owner: DesktopApprovalOwner, context: DesktopAgentExecutionContext): void;
  freezeApprovalPersistence(owner: DesktopApprovalOwner, groupId: string): void;
  getApprovalPersistenceFailure(owner: DesktopApprovalOwner, groupId: string): DesktopApprovalFailure | undefined;
  publishApprovalChange(owner: DesktopApprovalOwner, groupId: string): void;
}
interface UserScope { access: DesktopMultiAgentUserAccess; requestSource: Source; groupId: string; approvalId: string }
interface LiveApproval {
  dto: MultiAgentApprovalDurable; context: DesktopAgentExecutionContext; request: DesktopApprovalInvocation;
  phase: 'reserved' | 'pending' | 'finalizing' | 'approved' | 'terminal' | 'unknown';
  input?: Record<string, unknown>; bytes?: Buffer; actorDeadlineAt: number; consumed: boolean;
  invalidation?: MultiAgentApprovalReason; timer?: ReturnType<typeof setTimeout>; detach: Array<() => void>;
  resolve(value: false | ToolPermissionGrant): void; reject(reason: unknown): void;
}
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The only owner of live prompt waiters. Durable scalars never recreate one. */
export class DesktopMultiAgentApprovalTransport {
  private readonly owner: DesktopApprovalOwner;
  private readonly records = new Map<string, LiveApproval>();
  private readonly issued = new Set<LiveApproval>();
  private readonly actors = new WeakMap<DesktopAgentActor, LiveApproval>();
  private readonly invocations = new WeakMap<object, Promise<false | ToolPermissionGrant>>();
  private readonly commands = new Set<Promise<unknown>>();
  private disposed = false;
  private disposal?: Promise<void>;
  constructor(private readonly options: { store: DesktopMultiAgentStore; service: DesktopApprovalServicePort }) {
    if (!Number.isSafeInteger(options.service.approvalCapacity) || options.service.approvalCapacity < 1) throw new Error('invalid approval capacity');
    this.owner = options.service.bindApprovalTransport(this);
  }

  requestApproval(input: { context: DesktopAgentExecutionContext; invocation: DesktopApprovalInvocation }): Promise<false | ToolPermissionGrant> {
    const { context, invocation: request } = input;
    const previous = this.invocations.get(request.invocation);
    if (previous) return previous;
    try {
      if (this.disposed) throw new Error('approval_transport_disposed');
      this.options.service.assertInvocation(context.actor, context);
      if (!request.toolContext) throw new Error('approval_context_unavailable');
      request.authority.signal.throwIfAborted(); request.toolContext.signal?.throwIfAborted();
      if (request.authority.groupId !== context.groupId || request.authority.agentId !== context.agentId
        || request.authority.turnId !== context.turnId || request.authority.cwd !== context.cwd
        || request.authority.permissionRevision !== context.permissionRevision) throw new Error('invalid approval invocation context');
      if (this.actors.has(context.actor) || this.records.size + this.issued.size >= this.options.service.approvalCapacity) throw new Error('approval_capacity_exceeded');
      const actorDeadlineAt = this.options.service.getApprovalDeadline(context.actor);
      if (Date.now() >= actorDeadlineAt) { this.options.service.expireApprovalActor(this.owner, context); context.signal.throwIfAborted(); this.options.service.assertInvocation(context.actor, context); throw new DOMException('actor deadline exceeded', 'AbortError'); }
      request.assertCurrent();
      const canonical = encodeMultiAgentRow(request.input), bytes = Buffer.from(canonical, 'utf8');
      if (bytes.length > MAX_INPUT_BYTES) throw new Error('approval_input_too_large');
      const privateInput = JSON.parse(canonical) as Record<string, unknown>;
      if (!privateInput || Array.isArray(privateInput) || typeof privateInput !== 'object') throw new Error('approval_input_invalid');
      const group = this.read(context.groupId, () => this.options.store.requireGroup(context.groupId));
      const thread = this.read(context.groupId, () => this.options.store.getThread(group.threadId));
      if (!thread) throw new Error('unknown approval thread');
      const descriptor = request.descriptor, approvalId = randomUUID();
      const dto: MultiAgentApprovalDurable = { approvalId, bootId: this.options.store.bootId,
        profileId: thread.profileId, workspaceId: thread.workspaceId, threadId: thread.threadId,
        groupId: context.groupId, agentId: context.agentId, turn: context.turn, turnId: context.turnId,
        ...(context.sourceTaskId === undefined ? {} : { sourceTaskId: context.sourceTaskId }),
        canonicalName: descriptor.canonicalName, toolName: request.toolName, cwd: context.cwd,
        ownerId: descriptor.ownerId, slotId: descriptor.slotId, capabilityId: descriptor.capabilityId, revision: descriptor.revision,
        permissionRevision: context.permissionRevision, invocationNonce: randomUUID(), inputSha256: digest(canonical), inputByteLength: bytes.length,
        issuedAt: request.issuedAt, minDeadlineAt: request.minDeadlineAt, status: 'pending', persistenceState: 'confirmed' };
      const operation = captureApprovalOperationForWrite(this.operation(dto));
      let resolve!: LiveApproval['resolve'], reject!: LiveApproval['reject'];
      const promise = new Promise<false | ToolPermissionGrant>((yes, no) => { resolve = yes; reject = no; });
      const record: LiveApproval = { dto, context, request, phase: 'reserved', input: privateInput, bytes, actorDeadlineAt, consumed: false, detach: [], resolve, reject };
      this.records.set(approvalId, record); this.actors.set(context.actor, record); this.invocations.set(request.invocation, promise);
      const abort = () => this.invalidate(record, 'actor_aborted');
      for (const signal of new Set([context.signal, request.authority.signal, request.toolContext.signal].filter((value): value is AbortSignal => Boolean(value)))) {
        signal.addEventListener('abort', abort, { once: true }); record.detach.push(() => signal.removeEventListener('abort', abort));
      }
      record.detach.push(request.subscribeInvalidated(reason => this.invalidate(record, reason)));
      record.timer = setTimeout(() => this.expire(record), Math.max(0, dto.minDeadlineAt - Date.now())); record.timer.unref?.();
      const command = this.options.service.runApprovalCommand(this.owner, context.groupId, () => {
        if (record.phase !== 'reserved') return;
        let admissionRejected = false;
        try {
          this.options.store.transaction(() => {
            try { this.assertCurrent(record); } catch (error) { admissionRejected = !this.failure(context.groupId); throw error; }
            this.options.store.commitApprovalRequest(operation);
            record.phase = 'pending';
          });
          this.options.service.publishApprovalChange(this.owner, context.groupId);
          if (Date.now() >= dto.minDeadlineAt) this.expire(record);
        } catch (error) {
          if (admissionRejected) { this.complete(record, false, this.abortReason(record)); }
          else this.failGroup(context.groupId);
        }
      });
      this.track(command).catch(error => {
        if (this.failure(context.groupId)) this.failGroup(context.groupId);
        else this.complete(record, false, this.abortReason(record) ?? error);
      });
      return promise;
    } catch (error) { return Promise.reject(error); }
  }

  getApproval(input: UserScope & { inputOffset?: number }): MultiAgentApprovalView {
    this.options.service.assertApprovalUserAccess(input.access, input.requestSource, input.groupId);
    const operation = this.read(input.groupId, () => this.options.store.getOperation(input.groupId, `approval-request:${input.approvalId}`));
    if (!operation || operation.command !== 'approval_request') throw new Error('unknown approval');
    const dto = (operation as ApprovalRequestOperation).result.approval;
    const record = this.records.get(input.approvalId);
    const view = this.view(dto, record);
    if (input.inputOffset !== undefined) {
      if (!Number.isSafeInteger(input.inputOffset) || input.inputOffset < 0 || input.inputOffset > dto.inputByteLength) throw new Error('invalid approval input offset');
      if (view.canDecide && record?.bytes) {
        const page = record.bytes.subarray(input.inputOffset, input.inputOffset + 32 * 1024);
        view.inputPage = { offset: input.inputOffset, base64: page.toString('base64'), nextOffset: input.inputOffset + page.length,
          byteLength: dto.inputByteLength, sha256: dto.inputSha256 };
      }
    }
    return view;
  }

  getGroupProjection(groupId: string): { pendingApprovals: MultiAgentPendingApproval[]; pendingApprovalCount: number } {
    const pendingApprovals: MultiAgentPendingApproval[] = [];
    for (const record of this.records.values()) {
      if (record.dto.groupId !== groupId || record.phase === 'reserved') continue;
      const view = this.view(record.dto, record);
      pendingApprovals.push({ approvalId: view.approvalId, agentId: view.agentId, turn: view.turn, turnId: view.turnId,
        minDeadlineAt: view.minDeadlineAt, status: view.status, persistenceState: view.persistenceState, canDecide: view.canDecide,
        inputSha256: view.inputSha256, inputByteLength: view.inputByteLength, ...(view.reason === undefined ? {} : { reason: view.reason }) });
    }
    return { pendingApprovals, pendingApprovalCount: pendingApprovals.filter(item => item.canDecide).length };
  }

  decideApproval(input: UserScope & { operationId: string; decision: 'approve' | 'deny' }): Promise<MultiAgentControlResult> {
    try {
      const user = this.options.service.assertApprovalUserAccess(input.access, input.requestSource, input.groupId);
      if (!input.operationId || input.operationId.length > 128 || !['approve', 'deny'].includes(input.decision)) throw new Error('invalid approval decision');
      if (this.failure(input.groupId)) throw new Error('approval_persistence_unknown');
      const requestHash = digest(encodeMultiAgentRow({ actorId: user.actorId, approvalId: input.approvalId, decision: input.decision }));
      const record = this.records.get(input.approvalId);
      if (record?.phase === 'pending') record.phase = 'finalizing';
      return this.track(this.options.service.runApprovalCommand(this.owner, input.groupId, (): MultiAgentControlResult => {
        this.options.service.assertApprovalUserAccess(input.access, input.requestSource, input.groupId);
        if (this.failure(input.groupId)) throw new Error('approval_persistence_unknown');
        const previous = this.read(input.groupId, () => this.options.store.getOperation(input.groupId, input.operationId));
        if (previous) { if (previous.requestHash !== requestHash) throw new Error('operation_id_conflict'); return previous.result as unknown as MultiAgentControlResult; }
        if (!record || record.dto.groupId !== input.groupId || record.dto.bootId !== this.options.store.bootId
          || record.phase !== 'finalizing' && record.phase !== 'pending') throw new Error('approval_already_decided_or_invalidated');
        let result!: MultiAgentControlResult;
        try {
          this.options.store.transaction(() => {
            this.options.service.assertApprovalUserAccess(input.access, input.requestSource, input.groupId);
            // BEGIN is synchronous IO, but wall time can cross the deadline
            // during it. Classify ordinary invalidation inside this same
            // transaction; only actual persistence failures freeze the group.
            let invalid = false;
            try { this.assertCurrent(record); } catch (error) { if (this.failure(input.groupId)) throw error; invalid = true; }
            const status = invalid ? Date.now() >= record.dto.minDeadlineAt ? 'expired' : 'invalidated' : input.decision === 'approve' ? 'approved' : 'denied';
            const reason = invalid ? record.invalidation ?? (status === 'expired' ? 'approval_deadline' : 'actor_aborted') : input.decision === 'deny' ? 'user_denied' : undefined;
            result = { operationId: input.operationId, state: 'applied', groupId: input.groupId,
              targetAgentId: record.dto.agentId, expectedTurn: record.dto.turn, ...(invalid ? { outcome: 'rejected' as const, error: 'approval_invalidated' } : {}) };
            const finalized = this.options.store.finalizeApproval({ groupId: input.groupId, approvalId: input.approvalId,
              bootId: record.dto.bootId, status, ...(reason === undefined ? {} : { reason }),
              decisionOperation: { groupId: input.groupId, operationId: input.operationId, command: 'approval_decision', requestHash, applyState: 'applied', result: { ...result } } });
            record.dto = finalized.operation.result.approval;
            record.phase = record.dto.status === 'approved' ? 'approved' : 'terminal';
          });
          this.options.service.publishApprovalChange(this.owner, input.groupId);
        } catch { this.failGroup(input.groupId); return { operationId: input.operationId, state: 'unknown', groupId: input.groupId }; }
        this.finishCommitted(record);
        return result;
      })).finally(() => {
        // Ordinary command refusals (including conflicting user IDs or queue
        // admission failure) do not consume an otherwise healthy pending row.
        // Never undo a durable terminal, cancellation or persistence fence.
        if (record?.phase === 'finalizing' && !record.invalidation && !record.context.signal.aborted
          && this.records.get(record.dto.approvalId) === record) record.phase = 'pending';
      });
    } catch (error) { return Promise.reject(error); }
  }

  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.disposed = true;
      for (const record of [...this.records.values(), ...this.issued]) this.invalidate(record, 'factory_disposed');
      while (this.commands.size) await Promise.allSettled([...this.commands]);
    })();
  }

  private operation(dto: MultiAgentApprovalDurable): ApprovalRequestOperation {
    return { groupId: dto.groupId, operationId: `approval-request:${dto.approvalId}`, command: 'approval_request',
      requestHash: digest(encodeMultiAgentRow(dto)), applyState: 'applied', result: { approval: dto } };
  }
  private assertCurrent(record: LiveApproval): void {
    const { context, request } = record;
    context.signal.throwIfAborted(); request.authority.signal.throwIfAborted(); request.toolContext.signal?.throwIfAborted();
    if (Date.now() >= record.actorDeadlineAt) {
      record.invalidation ??= 'actor_deadline'; this.options.service.expireApprovalActor(this.owner, context);
      context.signal.throwIfAborted(); this.options.service.assertInvocation(context.actor, context);
      throw new DOMException('actor deadline exceeded', 'AbortError');
    }
    this.assertReadableCurrent(record);
  }
  /** Querying metadata must not expire an actor or schedule a settlement. */
  private assertReadableCurrent(record: LiveApproval): void {
    const { context, request } = record;
    context.signal.throwIfAborted(); request.authority.signal.throwIfAborted(); request.toolContext.signal?.throwIfAborted();
    if (this.disposed || record.invalidation) throw new Error('approval_invalidated');
    if (Date.now() >= record.actorDeadlineAt || Date.now() >= record.dto.minDeadlineAt) throw new Error('approval_expired');
    this.options.service.assertInvocation(context.actor, context); request.assertCurrent();
  }
  private expire(record: LiveApproval): void {
    const actorExpired = Date.now() >= record.actorDeadlineAt;
    record.invalidation ??= actorExpired ? 'actor_deadline' : 'approval_deadline';
    if (actorExpired) this.options.service.expireApprovalActor(this.owner, record.context);
    this.invalidate(record, record.invalidation);
  }
  private invalidate(record: LiveApproval, reason: MultiAgentApprovalReason): void {
    if (record.phase === 'unknown' || record.phase === 'terminal') return;
    record.invalidation ??= reason;
    if (record.phase === 'reserved' || record.phase === 'approved') { this.complete(record, false, this.abortReason(record)); return; }
    record.phase = 'finalizing';
    this.track(this.options.service.runApprovalCommand(this.owner, record.dto.groupId, () => {
      if (!this.records.has(record.dto.approvalId)) return;
      try {
        this.options.store.transaction(() => {
          const finalized = this.options.store.finalizeApproval({ groupId: record.dto.groupId, approvalId: record.dto.approvalId,
            bootId: record.dto.bootId, status: record.invalidation === 'approval_deadline' || record.invalidation === 'actor_deadline' ? 'expired' : 'invalidated', reason: record.invalidation });
          record.dto = finalized.operation.result.approval; record.phase = 'terminal';
        });
        this.options.service.publishApprovalChange(this.owner, record.dto.groupId);
        this.complete(record, false, this.abortReason(record));
      } catch { this.failGroup(record.dto.groupId); }
    })).catch(() => this.failGroup(record.dto.groupId));
  }
  private finishCommitted(record: LiveApproval): void {
    if (record.dto.status !== 'approved') { this.complete(record, false, this.abortReason(record)); return; }
    try { this.assertCurrent(record); } catch { this.complete(record, false, this.abortReason(record)); return; }
    // A committed decision is not consumption. Until prepareInput runs, retain
    // the original expiry/descriptor/abort subscriptions to release private IO.
    this.records.delete(record.dto.approvalId); this.actors.delete(record.context.actor); this.issued.add(record);
    record.resolve({ approved: true,
      prepareInput: finalInput => {
        try {
          if (record.consumed) throw new Error('approval_grant_consumed'); record.consumed = true;
          this.assertCurrent(record);
          if (digest(encodeMultiAgentRow(finalInput)) !== record.dto.inputSha256) throw new Error('approval_input_changed');
          if (!record.input) throw new Error('approval_private_input_released');
          return structuredClone(record.input);
        } finally { this.detach(record); record.input = undefined; record.bytes = undefined; this.issued.delete(record); }
      },
      assertCurrent: () => { if (!record.consumed) throw new Error('approval_grant_not_consumed'); this.assertCurrent(record); },
    });
  }
  private complete(record: LiveApproval, value: false, error?: unknown): void {
    this.detach(record); this.records.delete(record.dto.approvalId); this.issued.delete(record);
    if (this.actors.get(record.context.actor) === record) this.actors.delete(record.context.actor);
    record.input = undefined; record.bytes = undefined;
    if (record.phase !== 'unknown') record.phase = 'terminal';
    if (error !== undefined) record.reject(error); else record.resolve(value);
  }
  private detach(record: LiveApproval): void { clearTimeout(record.timer); record.timer = undefined; for (const detach of record.detach.splice(0)) detach(); }
  private abortReason(record: LiveApproval): unknown {
    for (const signal of [record.context.signal, record.request.authority.signal, record.request.toolContext.signal]) if (signal?.aborted) return signal.reason;
    return undefined;
  }
  private failure(groupId: string): DesktopApprovalFailure | undefined { return this.options.service.getApprovalPersistenceFailure(this.owner, groupId); }
  private failGroup(groupId: string): void {
    for (const record of [...this.records.values(), ...this.issued]) if (record.dto.groupId === groupId) {
      record.phase = 'unknown'; record.invalidation = 'approval_persistence_failed'; this.complete(record, false, this.abortReason(record));
    }
    this.options.service.freezeApprovalPersistence(this.owner, groupId);
  }
  private read<T>(groupId: string, action: () => T): T { try { return action(); } catch (error) { this.failGroup(groupId); throw error; } }
  private view(dto: MultiAgentApprovalDurable, record?: LiveApproval): MultiAgentApprovalView {
    let failed = Boolean(this.failure(dto.groupId)); let canDecide = !failed && record?.phase === 'pending' && dto.bootId === this.options.store.bootId;
    if (canDecide) { try { this.assertReadableCurrent(record!); } catch { canDecide = false; } }
    failed = Boolean(this.failure(dto.groupId));
    return { approvalId: dto.approvalId, threadId: dto.threadId, groupId: dto.groupId, bootId: dto.bootId,
      agentId: dto.agentId, turn: dto.turn, turnId: dto.turnId, ...(dto.sourceTaskId === undefined ? {} : { sourceTaskId: dto.sourceTaskId }),
      toolName: dto.toolName, cwd: dto.cwd, issuedAt: dto.issuedAt, minDeadlineAt: dto.minDeadlineAt, inputSha256: dto.inputSha256,
      inputByteLength: dto.inputByteLength, status: dto.status, persistenceState: failed ? 'unknown' : dto.persistenceState, canDecide: Boolean(canDecide),
      ...(failed ? { reason: 'approval_persistence_failed' as const } : dto.reason === undefined ? {} : { reason: dto.reason }) };
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.commands.add(promise); void promise.finally(() => this.commands.delete(promise)).catch(() => {}); return promise;
  }
}
