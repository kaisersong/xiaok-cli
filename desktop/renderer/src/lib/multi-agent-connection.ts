import type { DesktopAgentSnapshot, MultiAgentApprovalView, MultiAgentDesktopAPI, MultiAgentPendingApproval } from '../../../shared/multi-agent-types';
import { approvalIdentityKey, approvalInvocationKey, assertApprovalMetadata, type ApprovalIdentity } from './multi-agent-approval-reader';
import { MultiAgentProjection, MultiAgentThreadFacts, type MultiAgentProjectionView, type MultiAgentAgentPageRequest } from './multi-agent-projection';

export interface MultiAgentConnectionState { phase: 'loading' | 'live' | 'error'; error: string | null; projection: MultiAgentProjectionView }
export interface MultiAgentConnectionSummary { total: number; running: number; failed: number; error: boolean; phase: MultiAgentConnectionState['phase'];
  hasAgentHistory: boolean; needsRecovery: boolean; historicalSelection: boolean; deleted: boolean; pendingApprovalCount: number }
interface Session { id: string; projection: MultiAgentProjection; ready: boolean; stopped: boolean; failed: boolean; pumping: boolean; dirty: boolean; timer?: ReturnType<typeof setTimeout> }

/** Push-only connection: no business polling. A single owner serializes backfill. */
export class MultiAgentConnection {
  private session?: Session;
  private ownerGeneration = 0;
  private approvalMetadata = new Map<string, Promise<MultiAgentApprovalView>>();
  // UI receipts survive reconnect, not API/thread/group/turn replacement. They
  // never authorize a tool; an unknown receipt only enables its read query.
  private approvalReceipts = new Map<string, { operationId: string; phase: 'unknown' | 'received' }>();
  private readonly listeners = new Set<() => void>();
  private state: MultiAgentConnectionState;
  private summary: MultiAgentConnectionSummary;
  constructor(private readonly api: MultiAgentDesktopAPI, readonly threadId: string, readonly groupId?: string,
    private readonly threadFacts = new MultiAgentThreadFacts(threadId)) {
    this.state = { phase: 'loading', error: null, projection: new MultiAgentProjection(threadId, '', groupId, undefined, threadFacts).view() };
    this.summary = this.summarize(this.state.projection, 'loading');
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): MultiAgentConnectionState => this.state;
  getSummary = (): MultiAgentConnectionSummary => this.summary;
  getApprovalReceipt(identity: ApprovalIdentity) { return this.approvalReceipts.get(approvalInvocationKey(identity)); }
  rememberApprovalReceipt(identity: ApprovalIdentity, receipt: { operationId: string; phase: 'unknown' | 'received' }): void {
    const key = approvalInvocationKey(identity), previous = this.approvalReceipts.get(key);
    if (previous && previous.operationId !== receipt.operationId || !previous && !this.isApprovalCurrent(identity)) return;
    if (!previous && this.approvalReceipts.size >= 9) return;
    this.approvalReceipts.set(key, receipt);
    if (this.session) this.publish(this.session);
  }
  isApprovalCurrent(identity: ApprovalIdentity): boolean {
    const view = this.session?.projection.view(), group = view?.snapshot?.group;
    if (!this.session?.ready || this.session.stopped || this.session.failed || this.state.phase !== 'live' || !group
      || view!.error || view!.threadDeleteState !== 'none' || group.historicalOnly || group.mutationBlockedReason
      || view!.approvalFailure?.groupId === group.groupId || group.groupId !== view!.activeGroupId
      || group.groupId !== identity.groupId || group.bootId !== identity.bootId || this.threadId !== identity.threadId) return false;
    const pending = view!.snapshot?.pendingApprovals?.find(row => row.approvalId === identity.pending.approvalId);
    const agent = identity.pending.agentId === view!.root?.id ? view!.root : view!.agents.find(row => row.id === identity.pending.agentId);
    return !!pending && !!agent && agent.turn === pending.turn && agent.turnId === pending.turnId
      && pending.status === 'pending' && pending.persistenceState === 'confirmed' && pending.canDecide
      && approvalIdentityKey({ ...identity, pending }) === approvalIdentityKey(identity);
  }
  getApprovalMetadata(pending: MultiAgentPendingApproval, retry = false): Promise<MultiAgentApprovalView> {
    const group = this.state.projection.snapshot?.group;
    if (!group) return Promise.reject(new Error('approval_group_unavailable'));
    const identity = { threadId: this.threadId, groupId: group.groupId, bootId: group.bootId, pending };
    const key = approvalIdentityKey(identity);
    if (retry) this.approvalMetadata.delete(key);
    let promise = this.approvalMetadata.get(key);
    if (!promise) {
      promise = this.api.getMultiAgentApproval({ threadId: this.threadId, groupId: group.groupId, approvalId: pending.approvalId })
        .then(value => { assertApprovalMetadata(value, identity); return value; });
      this.approvalMetadata.set(key, promise);
    }
    return promise;
  }
  details(agentId: string, beforeSeq?: number) { return this.session?.projection.details(agentId, beforeSeq) ?? []; }
  beginAgentPage(cursor: string): MultiAgentAgentPageRequest | undefined { return this.session?.projection.beginAgentPage(cursor); }
  installAgentPage(agents: DesktopAgentSnapshot[], request: MultiAgentAgentPageRequest): boolean {
    if (!this.session || !this.current(this.session)) return false;
    if (!this.session.projection.installAgentPage(agents, request)) return false;
    this.publish(this.session); return true;
  }
  start(): () => void {
    const generation = ++this.ownerGeneration;
    this.connect();
    return () => { if (generation === this.ownerGeneration && this.session) this.stop(this.session); };
  }
  private connect(): void {
    if (this.session) this.stop(this.session);
    this.approvalMetadata.clear();
    const id = crypto.randomUUID();
    const session: Session = { id, projection: new MultiAgentProjection(this.threadId, id, this.groupId, undefined, this.threadFacts), ready: false, stopped: false, failed: false, pumping: false, dirty: false };
    this.session = session; this.publish(session, 'loading');
    const requestedAt = session.projection.beginSnapshot();
    void this.api.subscribeMultiAgents({ threadId: this.threadId, groupId: this.groupId, subscriptionId: id, afterSeq: 0 }, transport => {
      if (!this.current(session)) return;
      session.projection.receive(transport); session.dirty = true;
      if (transport.envelope.channel === 'runtime_error' && transport.envelope.code === 'multi_agent_approval_persistence_failed') this.publish(session);
      this.schedule(session);
    }).then(async result => {
      if (!this.current(session)) { void this.api.unsubscribeMultiAgents({ subscriptionId: id }).catch(() => undefined); return; }
      if (result.subscriptionId !== id) throw new Error('multi_agent_subscription_mismatch');
      session.projection.install(result.snapshot, requestedAt);
      if (session.projection.view().error) throw new Error(session.projection.view().error!);
      session.ready = true;
      await this.pump(session); if (this.current(session) && this.state.phase !== 'error') this.publish(session, 'live');
    }).catch(error => this.fail(session, error));
  }
  refresh(): void {
    const session = this.session; if (!session || !this.current(session)) return;
    if (session.projection.view().threadDeleteState === 'deleted') return;
    if (!session.ready) { this.connect(); return; }
    session.failed = false;
    session.projection.requestSnapshot();
    session.dirty = true; this.schedule(session);
  }
  private current(session: Session): boolean { return this.session === session && !session.stopped; }
  private stop(session: Session): void {
    if (session.stopped) return;
    session.stopped = true; clearTimeout(session.timer);
    void this.api.unsubscribeMultiAgents({ subscriptionId: session.id }).catch(() => undefined);
  }
  private schedule(session: Session): void {
    if (session.timer || !this.current(session)) return;
    session.timer = setTimeout(() => {
      session.timer = undefined;
      if (!this.current(session)) return;
      this.publish(session);
      void this.pump(session);
    }, 80);
  }
  private async pump(session: Session): Promise<void> {
    if (!session.ready || session.failed || session.pumping || !this.current(session)) return;
    session.pumping = true; session.dirty = false;
    let succeeded = false;
    try {
      const projection = session.projection;
      if (projection.view().needsSnapshot || projection.view().resyncRequired) {
        const requestedAt = projection.beginSnapshot();
        const snapshot = await this.api.getMultiAgentSnapshot({ threadId: this.threadId, groupId: this.groupId });
        if (!this.current(session)) return;
        projection.install(snapshot, requestedAt);
      }
      if (projection.view().error) throw new Error(projection.view().error!);
      const groupId = projection.view().groupId;
      let head = projection.headSeq(); let pages = 0;
      while (groupId && projection.view().threadDeleteState !== 'deleted' && projection.view().detailSeq < head && this.current(session)) {
        const afterSeq = projection.view().detailSeq;
        const page = await this.api.getMultiAgentEvents({ threadId: this.threadId, groupId, afterSeq, limit: 100 });
        if (!this.current(session)) return;
        projection.replay(page.items); head = Math.max(head, page.headSeq, projection.headSeq());
        if (projection.view().error) throw new Error(projection.view().error!);
        if (projection.view().detailSeq <= afterSeq) throw new Error('multi_agent_replay_not_advancing');
        if (++pages % 10 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      this.publish(session, 'live');
      succeeded = true;
    } catch (error) { this.fail(session, error); }
    finally {
      session.pumping = false;
      if (succeeded && this.current(session) && (session.dirty || session.projection.view().needsSnapshot || session.projection.view().resyncRequired)) this.schedule(session);
    }
  }
  private fail(session: Session, error: unknown): void {
    if (!this.current(session)) return;
    if (session.projection.view().threadDeleteState === 'deleted') { this.publish(session, 'live'); return; }
    session.failed = true;
    clearTimeout(session.timer); session.timer = undefined;
    session.projection.fail(error instanceof Error ? error.message : String(error)); this.publish(session, 'error');
  }
  private publish(session: Session, phase = this.state.phase): void {
    if (!this.current(session)) return;
    const projection = session.projection.view();
    const group = projection.snapshot?.group;
    const keys = new Set(group ? (projection.snapshot?.pendingApprovals ?? []).slice(0, 9).map(pending => approvalIdentityKey({ threadId: this.threadId, groupId: group.groupId, bootId: group.bootId, pending })) : []);
    for (const key of this.approvalMetadata.keys()) if (!keys.has(key)) this.approvalMetadata.delete(key);
    if (session.ready && projection.snapshot) {
      const invocations = new Set(group ? (projection.snapshot.pendingApprovals ?? []).slice(0, 9).map(pending => approvalInvocationKey({ threadId: this.threadId, groupId: group.groupId, bootId: group.bootId, pending })) : []);
      for (const key of this.approvalReceipts.keys()) if (!invocations.has(key)) this.approvalReceipts.delete(key);
    }
    this.state = { phase, error: projection.error, projection };
    const summary = this.summarize(projection, phase);
    if (Object.keys(summary).some(key => summary[key as keyof typeof summary] !== this.summary[key as keyof typeof summary])) this.summary = summary;
    for (const listener of this.listeners) listener();
  }
  private summarize(projection: MultiAgentProjectionView, phase: MultiAgentConnectionState['phase']): MultiAgentConnectionSummary {
    const counts = projection.snapshot?.counts, deleted = projection.threadDeleteState === 'deleted';
    return { phase, total: Math.max((counts?.total ?? 0) - (projection.root ? 1 : 0), projection.agents.length),
      running: counts?.running ?? 0, failed: counts?.failed ?? 0, error: Boolean(projection.error), deleted,
      pendingApprovalCount: deleted ? 0 : projection.pendingApprovalCount,
      hasAgentHistory: projection.hasAgentHistory, historicalSelection: Boolean(this.groupId || projection.snapshot?.group?.historicalOnly),
      needsRecovery: !deleted && Boolean(phase === 'error' || projection.error || projection.snapshot?.runtimeError || projection.approvalFailure
        || projection.root?.hostDeliveryStatus === 'failed' || projection.root?.hostDeliveryStatus === 'unknown'
        || projection.snapshot?.group?.mutationBlockedReason || projection.threadDeleteState === 'delete_pending') };
  }
}
