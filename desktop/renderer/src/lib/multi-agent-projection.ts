import type { DesktopAgentSnapshot, MultiAgentApprovalFailure, MultiAgentDurableEvent, MultiAgentGroupSnapshot, MultiAgentTransport } from '../../../shared/multi-agent-types';
import type { HostDeliveryReport } from '../../../../src/runtime/task-host/delivery-types';

export interface MultiAgentProjectionView {
  threadId: string; groupId: string | null; activeGroupId: string | null; threadRevision: number;
  hasAgentHistory: boolean; threadDeleteState: 'none' | 'delete_pending' | 'deleted';
  pendingApprovalCount: number; approvalFailure?: MultiAgentApprovalFailure;
  snapshot: MultiAgentGroupSnapshot | null; agents: DesktopAgentSnapshot[]; root: DesktopAgentSnapshot | null;
  statusSeq: number; detailSeq: number; resyncRequired: boolean; needsSnapshot: boolean; error: string | null;
}
type ThreadFacts = Pick<MultiAgentProjectionView, 'threadId' | 'activeGroupId' | 'threadRevision' | 'hasAgentHistory' | 'threadDeleteState' | 'pendingApprovalCount' | 'approvalFailure'>;
/** Hook-local, bounded read facts only; never execution authority or group rows. */
export class MultiAgentThreadFacts {
  private state: ThreadFacts;
  private approvalFailureRevision = 0;
  constructor(threadId: string) { this.state = { threadId, activeGroupId: null, threadRevision: 0, hasAgentHistory: false, threadDeleteState: 'none', pendingApprovalCount: 0 }; }
  view(): Readonly<ThreadFacts> { return this.state; }
  merge(input: Pick<MultiAgentGroupSnapshot, 'threadId' | 'threadRevision' | 'activeGroupId' | 'hasAgentHistory' | 'threadDeleteState' | 'pendingApprovalCount' | 'approvalFailure'>, snapshot = false): void {
    if (input.threadId !== this.state.threadId || this.state.threadDeleteState === 'deleted' || input.threadRevision < this.state.threadRevision) return;
    const ranks = { none: 0, delete_pending: 1, deleted: 2 };
    const deletion = input.threadDeleteState && ranks[input.threadDeleteState] >= ranks[this.state.threadDeleteState] ? input.threadDeleteState : this.state.threadDeleteState;
    const failure = deletion === 'deleted' ? undefined : input.approvalFailure ?? (
      snapshot && this.state.approvalFailure && input.activeGroupId && input.activeGroupId !== this.state.approvalFailure.groupId
        && input.threadRevision > this.approvalFailureRevision
        ? undefined : this.state.approvalFailure);
    this.state = { threadId: input.threadId, threadRevision: input.threadRevision,
      activeGroupId: deletion === 'deleted' ? null : input.activeGroupId, threadDeleteState: deletion,
      approvalFailure: failure,
      pendingApprovalCount: deletion !== 'none' || failure?.groupId === input.activeGroupId ? 0 : input.pendingApprovalCount ?? this.state.pendingApprovalCount,
      hasAgentHistory: deletion !== 'deleted' && (this.state.hasAgentHistory || input.hasAgentHistory === true) };
  }
  failApproval(failure: MultiAgentApprovalFailure): void {
    if (this.state.threadDeleteState === 'deleted' || this.state.activeGroupId && this.state.activeGroupId !== failure.groupId) return;
    if (!this.state.approvalFailure) this.approvalFailureRevision = this.state.threadRevision;
    this.state = { ...this.state, approvalFailure: failure, pendingApprovalCount: 0 };
  }
}
const utf8 = new TextEncoder();
type PendingActivity = Extract<MultiAgentTransport['envelope'], { channel: 'activity' }>;
export interface MultiAgentAgentPageRequest {
  readonly subscriptionId: string; readonly groupId: string | null; readonly bootId: string | undefined;
  readonly threadRevision: number; readonly statusSeq: number; readonly cursor: string;
}
// Activity is a separate stream from durable status S. Only these public
// fields may survive a stale checkpoint, and never across a turn/terminal.
function withCurrentActivity(agent: DesktopAgentSnapshot, previous?: DesktopAgentSnapshot | null): DesktopAgentSnapshot {
  if (!previous || agent.id !== previous.id || agent.status !== 'running' || previous.status !== 'running'
    || agent.turn !== previous.turn || !agent.turnId || agent.turnId !== previous.turnId
    || (previous.activityRevision ?? 0) <= (agent.activityRevision ?? 0)) return agent;
  return { ...agent, phase: previous.phase, currentTool: previous.currentTool,
    activityRevision: previous.activityRevision, lastActivityAt: previous.lastActivityAt };
}

/** One bounded event buffer, independent status-S and detail-C watermarks. */
export class MultiAgentProjection {
  private state: MultiAgentProjectionView;
  private readonly events = new Map<number, { event: MultiAgentDurableEvent; bytes: number }>();
  private bytes = 0;
  private agentPageRequest?: MultiAgentAgentPageRequest;
  private readonly pendingActivity = new Map<string, { event: PendingActivity; bytes: number }>();
  private pendingActivityBytes = 0;
  private refreshEpoch = 0;
  private errorEpoch = 0;
  constructor(readonly threadId: string, readonly subscriptionId: string, readonly selectedGroupId?: string,
    private readonly limits = { maxEvents: 10_000, maxBytes: 20 * 1024 * 1024 },
    private readonly threadFacts = new MultiAgentThreadFacts(threadId)) {
    if (threadFacts.view().threadId !== threadId) throw new Error('multi_agent_thread_facts_mismatch');
    this.state = { threadId, groupId: selectedGroupId ?? null, activeGroupId: null, threadRevision: 0,
      hasAgentHistory: false, threadDeleteState: 'none', pendingApprovalCount: 0,
      snapshot: null, agents: [], root: null, statusSeq: 0, detailSeq: 0, resyncRequired: false, needsSnapshot: false, error: null };
    this.syncThreadFacts();
  }
  private syncThreadFacts(): void {
    const facts = this.threadFacts.view();
    this.state = { ...this.state, ...facts, snapshot: this.state.snapshot ? { ...this.state.snapshot, ...facts } : null };
    if (facts.threadDeleteState !== 'deleted') return;
    this.events.clear(); this.bytes = 0; this.pendingActivity.clear(); this.pendingActivityBytes = 0; this.agentPageRequest = undefined;
    this.state = { ...this.state, groupId: null, agents: [], root: null, statusSeq: 0, detailSeq: 0, needsSnapshot: false, resyncRequired: false, error: null,
      snapshot: { ...facts, group: null, root: null, agents: [], residentAgents: [], nextAgentCursor: null, lastSeq: 0,
        counts: { total: 0, running: 0, completed: 0, failed: 0, unread: 0 } } };
  }
  view(): MultiAgentProjectionView { return this.state; }
  bufferSize(): number { return this.events.size; }
  headSeq(): number { return Math.max(this.state.statusSeq, ...this.events.keys()); }
  details(agentId: string, beforeSeq = Infinity): MultiAgentDurableEvent[] {
    return [...this.events.values()].map(item => item.event)
      .filter(event => event.agentId === agentId && event.seq <= this.state.detailSeq && event.seq < beforeSeq)
      .sort((a, b) => a.seq - b.seq).slice(-50);
  }
  fail(code: string): void { if (this.state.threadDeleteState === 'deleted') return; this.errorEpoch = ++this.refreshEpoch; this.state = { ...this.state, error: code }; }
  beginSnapshot(): number { return this.refreshEpoch; }
  requestSnapshot(): void { this.requireSnapshot(true); }
  private requireSnapshot(resync = false): void {
    if (this.state.threadDeleteState === 'deleted') return;
    this.refreshEpoch++;
    this.state = { ...this.state, needsSnapshot: true, resyncRequired: this.state.resyncRequired || resync };
  }
  install(snapshot: MultiAgentGroupSnapshot, requestedAt = this.refreshEpoch): void {
    if (snapshot.threadId !== this.threadId || this.state.threadDeleteState === 'deleted') return;
    if (this.selectedGroupId && snapshot.group?.groupId !== this.selectedGroupId && snapshot.threadDeleteState !== 'deleted') return;
    this.threadFacts.merge(snapshot, true); this.syncThreadFacts();
    if (this.threadFacts.view().threadDeleteState === 'deleted') return;
    const groupId = snapshot.group?.groupId ?? null;
    if (!this.selectedGroupId && snapshot.threadRevision < this.state.threadRevision && groupId !== this.state.activeGroupId) return;
    if (this.state.snapshot?.group && groupId === this.state.groupId && snapshot.group?.bootId !== this.state.snapshot.group.bootId) {
      this.fail('multi_agent_group_boot_mismatch'); return;
    }
    const { threadDeleteState, hasAgentHistory } = this.state;
    snapshot = { ...snapshot, ...this.threadFacts.view() };
    if (this.state.snapshot && this.state.groupId !== groupId) {
      this.events.clear(); this.bytes = 0;
      this.state = { ...this.state, statusSeq: 0, detailSeq: 0, snapshot: null, agents: [], root: null };
    }
    if (this.state.snapshot && snapshot.lastSeq < this.state.statusSeq) {
      const incoming = new Map([...snapshot.agents, ...snapshot.residentAgents].map(agent => [agent.id, agent]));
      this.state = { ...this.state,
        agents: this.state.agents.map(agent => withCurrentActivity(agent, incoming.get(agent.id))),
        root: this.state.root ? withCurrentActivity(this.state.root, snapshot.root) : null,
        snapshot: { ...this.state.snapshot, threadRevision: this.state.threadRevision, activeGroupId: this.state.activeGroupId, threadDeleteState, hasAgentHistory } };
      return;
    }
    const oldAgents = new Map(this.state.agents.map(agent => [agent.id, agent]));
    const agents = new Map([...snapshot.agents, ...snapshot.residentAgents].filter(agent => agent.parentId !== null).map(agent => [agent.id, withCurrentActivity(agent, oldAgents.get(agent.id))]));
    snapshot = { ...snapshot, root: snapshot.root ? withCurrentActivity(snapshot.root, this.state.root) : null };
    const newerRefreshPending = requestedAt < this.refreshEpoch;
    this.state = { ...this.state, groupId, snapshot, agents: [...agents.values()], root: snapshot.root,
      statusSeq: snapshot.lastSeq, resyncRequired: newerRefreshPending && this.state.resyncRequired, needsSnapshot: newerRefreshPending,
      error: requestedAt < this.errorEpoch ? this.state.error : snapshot.runtimeError ?? null,
      ...(snapshot.threadRevision >= this.state.threadRevision ? { threadRevision: snapshot.threadRevision, activeGroupId: snapshot.activeGroupId } : {}) };
    for (const [key, item] of this.pendingActivity) if (item.event.groupId !== groupId) this.removePendingActivity(key);
    for (const [seq, item] of this.events) if (item.event.groupId !== groupId) this.remove(seq);
    this.drain();
  }
  receive(transport: MultiAgentTransport): void {
    if (transport.subscriptionId !== this.subscriptionId || this.state.threadDeleteState === 'deleted') return;
    const event = transport.envelope;
    if (event.channel === 'runtime_error' && event.code === 'multi_agent_approval_persistence_failed' && 'threadId' in event
      && event.threadId === this.threadId && event.approvalPersistenceState === 'unknown') {
      this.threadFacts.failApproval({ groupId: event.groupId, bootId: event.bootId, code: event.code });
      this.syncThreadFacts(); this.requireSnapshot(); return;
    }
    if (event.channel === 'group_changed') {
      if (event.threadId !== this.threadId || event.threadRevision <= this.state.threadRevision) return;
      this.threadFacts.merge({ ...event, activeGroupId: event.newGroupId }); this.syncThreadFacts();
      if (this.threadFacts.view().threadDeleteState === 'deleted') return;
      if (!this.selectedGroupId) this.requireSnapshot();
      return;
    }
    if ((this.state.snapshot || this.state.groupId) && event.groupId !== this.state.groupId) {
      // The new active group can publish after its snapshot was captured but
      // before that response arrives. Preserve a fresh read obligation.
      if (!this.selectedGroupId && event.groupId === this.state.activeGroupId) this.requireSnapshot(true);
      return;
    }
    if (event.channel === 'durable') { this.add(event); this.drain(); }
    else if (event.channel === 'runtime_error') this.fail(event.code);
    else if (event.channel === 'resync_required') this.requireSnapshot(true);
    else if (event.channel === 'activity') {
      if (!this.applyActivity(event)) {
        const key = JSON.stringify([event.groupId, event.agentId, event.turnId]), previous = this.pendingActivity.get(key);
        if (previous && previous.event.activityRevision >= event.activityRevision) return;
        this.removePendingActivity(key);
        const bytes = utf8.encode(JSON.stringify(event)).byteLength;
        this.pendingActivity.set(key, { event, bytes }); this.pendingActivityBytes += bytes;
        while (this.pendingActivity.size > 16 || this.pendingActivityBytes > 16 * 1024) {
          this.removePendingActivity(this.pendingActivity.keys().next().value!);
          this.requireSnapshot(true);
        }
      }
    }
  }
  private applyActivity(event: PendingActivity): boolean {
    let matched = false;
    const update = (agent: DesktopAgentSnapshot) => {
      if (agent.id !== event.agentId || agent.turnId !== event.turnId) return agent;
      matched = true;
      return agent.status === 'running' && event.activityRevision > (agent.activityRevision ?? 0)
        ? { ...agent, activityRevision: event.activityRevision, phase: event.phase, currentTool: event.currentTool, lastActivityAt: event.timestamp } : agent;
    };
    this.state = { ...this.state, agents: this.state.agents.map(update), root: this.state.root ? update(this.state.root) : null };
    return matched;
  }
  private removePendingActivity(key: string): void {
    this.pendingActivityBytes -= this.pendingActivity.get(key)?.bytes ?? 0; this.pendingActivity.delete(key);
  }
  private drainPendingActivity(): void {
    for (const [key, item] of this.pendingActivity) if (item.event.groupId === this.state.groupId && this.applyActivity(item.event)) this.removePendingActivity(key);
  }
  replay(events: MultiAgentDurableEvent[]): void {
    if (this.state.threadDeleteState === 'deleted') return;
    for (const event of events) {
      if (event.groupId !== this.state.groupId || !Number.isSafeInteger(event.seq) || event.seq <= 0) continue;
      this.add(event); this.drain();
    }
  }
  beginAgentPage(cursor: string): MultiAgentAgentPageRequest {
    return this.agentPageRequest = { subscriptionId: this.subscriptionId, groupId: this.state.groupId, bootId: this.state.snapshot?.group?.bootId,
      threadRevision: this.state.threadRevision, statusSeq: this.state.statusSeq, cursor };
  }
  installAgentPage(agents: DesktopAgentSnapshot[], request: MultiAgentAgentPageRequest): boolean {
    if (this.state.threadDeleteState === 'deleted' || request !== this.agentPageRequest || request.subscriptionId !== this.subscriptionId || request.groupId !== this.state.groupId
      || request.bootId !== this.state.snapshot?.group?.bootId || request.threadRevision !== this.state.threadRevision || request.statusSeq !== this.state.statusSeq) return false;
    this.agentPageRequest = undefined;
    // Keep only the requested history page and resident rows; do not accumulate
    // every page visited in renderer memory.
    const previous = new Map(this.state.agents.map(agent => [agent.id, agent]));
    const merged = new Map(agents.slice(0, 50).map(agent => [agent.id, withCurrentActivity(agent, previous.get(agent.id))]));
    for (const agent of this.state.agents) if (!agent.resourcesReleased && !merged.has(agent.id)) merged.set(agent.id, agent);
    this.state = { ...this.state, agents: [...merged.values()] };
    this.drainPendingActivity();
    return true;
  }
  private add(event: MultiAgentDurableEvent): void {
    if (!Number.isSafeInteger(event.seq) || event.seq <= 0 || this.events.has(event.seq)) return;
    const bytes = utf8.encode(JSON.stringify(event)).byteLength;
    this.events.set(event.seq, { event, bytes }); this.bytes += bytes;
    while (this.events.size > this.limits.maxEvents || this.bytes > this.limits.maxBytes) {
      let oldest = Infinity;
      for (const seq of this.events.keys()) if (seq <= this.state.detailSeq && seq <= this.state.statusSeq && seq < oldest) oldest = seq;
      if (oldest !== Infinity) { this.remove(oldest); continue; }
      // Lost unapplied data requires explicit backfill. Never mark it applied.
      this.events.clear(); this.bytes = 0;
      this.requireSnapshot(true); break;
    }
  }
  private remove(seq: number): void { this.bytes -= this.events.get(seq)?.bytes ?? 0; this.events.delete(seq); }
  private drain(): void {
    if (!this.state.snapshot) return;
    let detailSeq = this.state.detailSeq;
    while (this.events.has(detailSeq + 1)) detailSeq++;
    let statusSeq = this.state.statusSeq;
    while (this.events.has(statusSeq + 1)) {
      const event = this.events.get(++statusSeq)!.event;
      if ((event.kind === 'status' || event.kind === 'cleanup' || event.kind === 'tool_finished') && event.payload.agent) {
        let agent = event.payload.agent as DesktopAgentSnapshot;
        if (agent.id !== event.agentId) { this.fail('invalid_agent_event'); continue; }
        const previous = agent.parentId === null ? this.state.root : this.state.agents.find(item => item.id === agent.id);
        if (previous && (agent.turn < previous.turn || agent.turn === previous.turn && agent.turnId && previous.turnId && agent.turnId !== previous.turnId)) continue;
        agent = withCurrentActivity(agent, previous);
        if (agent.parentId === null) { this.state = { ...this.state, root: agent }; this.requireSnapshot(); }
        else {
          const agents = this.state.agents.filter(previous => previous.id !== agent.id); agents.push(agent);
          const resident = agents.filter(item => !item.resourcesReleased);
          const history = agents.filter(item => item.resourcesReleased).slice(-50);
          this.state = { ...this.state, agents: [...resident, ...history] };
          if (event.kind !== 'tool_finished') this.requireSnapshot();
        }
      } else if (event.kind === 'delivery') {
        const { source, delivery } = event.payload as unknown as HostDeliveryReport;
        const root = this.state.root;
        // Main validates the complete report. Renderer projects only its three
        // presentation fields onto the exact current source, never execution.
        if (source && delivery && root && event.agentId === root.id && source.groupId === this.state.groupId
          && source.bootId === this.state.snapshot?.group?.bootId && source.sourceTaskId === root.sourceTaskId
          && source.rootTurnId === root.turnId && source.rootEpoch === root.turn) {
          this.state = { ...this.state, root: { ...root, hostDeliveryStatus: delivery.status,
            guardFailure: delivery.guardFailure, hostDeliveryCleanupPending: delivery.readerCleanup === 'pending' || delivery.storeCleanup === 'pending' } };
          this.requireSnapshot();
        }
      } else if (event.kind === 'message_sent' || event.kind === 'message_consumed' || event.kind === 'approval') {
        this.requireSnapshot();
      } else if (event.kind === 'usage' && event.payload.total) {
        const update = (agent: DesktopAgentSnapshot) => agent.id === event.agentId ? { ...agent, usage: event.payload.total as DesktopAgentSnapshot['usage'] } : agent;
        this.state = { ...this.state, agents: this.state.agents.map(update), root: this.state.root ? update(this.state.root) : null };
      }
    }
    this.state = { ...this.state, detailSeq, statusSeq };
    this.drainPendingActivity();
  }
}
