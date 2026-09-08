import { AsyncLocalStorage } from 'node:async_hooks';

export type ExecutionLane = 'foreground' | 'background';
const admissionLane = new AsyncLocalStorage<ExecutionLane>();
/** Main-only provenance; never populated from renderer or model input. */
export function withExecutionLane<T>(lane: ExecutionLane, action: () => T): T {
  return admissionLane.run(lane, action);
}
export function currentExecutionLane(): ExecutionLane { return admissionLane.getStore() ?? 'foreground'; }
export type ExecutionLeasePolicy = 'ordinary' | 'multiAgent';
export type ExecutionMemberKind = 'root' | 'user_followup' | 'agent_work';

export interface ExecutionLease {
  readonly lane: ExecutionLane;
  readonly groupId?: string;
  readonly epoch: number;
  readonly policy: ExecutionLeasePolicy;
  readonly acquiredAt: number;
  readonly deadlineAt?: number;
  readonly refCount: number;
  readonly released: boolean;
  retain(): ExecutionLease;
  release(): void;
}

/** Main-only request handle. A grant is owned before its Promise continuation runs. */
export type ExecutionLeaseRequest = Promise<ExecutionLease> & { readonly ticket?: ExecutionLease };

interface LeaseState {
  lane: ExecutionLane;
  groupId?: string;
  epoch: number;
  policy: ExecutionLeasePolicy;
  acquiredAt: number;
  deadlineAt?: number;
  refCount: number;
  released: boolean;
}

interface Waiter {
  lane: ExecutionLane;
  signal?: AbortSignal;
  groupId?: string;
  policy: ExecutionLeasePolicy;
  resolve: (lease: ExecutionLease) => void;
  reject: (error: unknown) => void;
  onAbort?: () => void;
  ticket?: ExecutionLease;
}

export class DesktopExecutionCoordinator {
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private readonly groups = new Map<string, LeaseState>();
  private nextEpoch = 0;
  private ready = true;
  private blockedReason?: string;
  readonly capacity: number;
  private readonly laneCapacity: Record<ExecutionLane, number>;
  private readonly laneActive: Record<ExecutionLane, number> = { foreground: 0, background: 0 };

  constructor(options: { capacity?: number; backgroundCapacity?: number } = {}) {
    const capacity = options.capacity ?? 1;
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Desktop execution capacity must be a positive integer');
    }
    const background = options.backgroundCapacity ?? 0;
    if (!Number.isSafeInteger(background) || background < 0) throw new Error('Invalid background capacity');
    this.laneCapacity = { foreground: capacity, background };
    this.capacity = capacity + background;
  }

  async run<T>(signal: AbortSignal | undefined, action: () => Promise<T>, lane?: ExecutionLane): Promise<T> {
    const member = await this.acquireLease({ policy: 'ordinary', signal, lane });
    try {
      if (signal?.aborted) throw abortReason(signal);
      return await action();
    } finally {
      member.release();
    }
  }

  snapshot(): { active: number; waiting: number; capacity: number } {
    return { active: this.active, waiting: this.waiters.length, capacity: this.capacity };
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    if (ready) this.dispatch();
  }

  /** Does not release live work: only its physical owner may release a member. */
  block(reason: string): void {
    this.blockedReason = reason;
    for (const waiter of this.waiters.splice(0)) {
      this.detachAbort(waiter);
      waiter.reject(new Error(reason));
    }
  }

  acquireLease(options: {
    lane?: ExecutionLane;
    groupId?: string;
    policy: ExecutionLeasePolicy;
    signal?: AbortSignal;
  }): ExecutionLeaseRequest {
    if (options.policy === 'multiAgent' && !options.groupId) {
      return this.rejected(new Error('multi-agent lease requires groupId'));
    }
    if (options.groupId && this.groups.has(options.groupId)) {
      return this.rejected(new Error('group already has a live lease; use joinOrEnqueue'));
    }
    return this.enqueue(options);
  }

  /** A future turn explicitly requires a new epoch, even if its group is live. */
  enqueueGroupTurn(groupId: string, signal?: AbortSignal, lane?: ExecutionLane): ExecutionLeaseRequest {
    if (!groupId) return this.rejected(new Error('multi-agent lease requires groupId'));
    return this.enqueue({ groupId, policy: 'multiAgent', signal, lane });
  }

  joinOrEnqueue(
    groupId: string,
    leaseEpoch: number,
    memberKind: ExecutionMemberKind,
    signal?: AbortSignal,
  ): ExecutionLeaseRequest {
    if (this.blockedReason) return this.rejected(new Error(this.blockedReason));
    if (signal?.aborted) return this.rejected(abortReason(signal));
    const lease = this.groups.get(groupId);
    const matching = lease && !lease.released && lease.epoch === leaseEpoch;
    if (matching && lease.deadlineAt !== undefined && Date.now() >= lease.deadlineAt) {
      return this.rejected(new Error('execution lease expired'));
    }
    if (memberKind === 'agent_work' && (!matching || !this.ready)) {
      return this.rejected(new Error('stale or unavailable execution lease'));
    }
    if (matching && this.ready && (memberKind === 'agent_work' || this.waiters.length === 0)) {
      const ticket = this.retain(lease);
      return Object.assign(Promise.resolve(ticket), { ticket });
    }
    return this.enqueue({ groupId, policy: 'multiAgent', signal, lane: matching ? lease.lane : undefined });
  }

  private rejected(error: unknown): ExecutionLeaseRequest {
    return Promise.reject(error) as ExecutionLeaseRequest;
  }

  private enqueue(options: { groupId?: string; policy: ExecutionLeasePolicy; signal?: AbortSignal; lane?: ExecutionLane }): ExecutionLeaseRequest {
    if (this.blockedReason) return this.rejected(new Error(this.blockedReason));
    const { signal } = options;
    if (signal?.aborted) return this.rejected(abortReason(signal));
    const lane = options.lane ?? currentExecutionLane();
    if (lane !== 'foreground' && lane !== 'background') return this.rejected(new Error('Invalid execution lane'));
    if (this.laneCapacity[lane] === 0) return this.rejected(new Error('Execution lane capacity is disabled'));
    let waiter!: Waiter;
    const promise = new Promise<ExecutionLease>((resolve, reject) => {
      waiter = { ...options, lane, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index < 0) return;
          this.waiters.splice(index, 1);
          reject(abortReason(signal));
          this.dispatch();
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.dispatch();
    });
    Object.defineProperty(promise, 'ticket', { get: () => waiter.ticket });
    return promise as ExecutionLeaseRequest;
  }

  private dispatch(): void {
    while (this.ready && !this.blockedReason && this.active < this.capacity && this.waiters.length > 0) {
      // A queued new epoch cannot overlap the still-live epoch of the same group.
      const seen = new Set<ExecutionLane>();
      const index = this.waiters.findIndex(candidate => {
        if (seen.has(candidate.lane)) return false;
        seen.add(candidate.lane);
        return this.laneActive[candidate.lane] < this.laneCapacity[candidate.lane]
          && !(candidate.groupId && this.groups.has(candidate.groupId));
      });
      if (index < 0) return;
      const waiter = this.waiters.splice(index, 1)[0]!;
      if (waiter.signal?.aborted) {
        this.detachAbort(waiter);
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      this.detachAbort(waiter);
      const acquiredAt = Date.now();
      const lease: LeaseState = {
        lane: waiter.lane,
        groupId: waiter.groupId,
        epoch: ++this.nextEpoch,
        policy: waiter.policy,
        acquiredAt,
        deadlineAt: waiter.policy === 'multiAgent' ? acquiredAt + 28 * 60_000 : undefined,
        refCount: 0,
        released: false,
      };
      if (lease.groupId) this.groups.set(lease.groupId, lease);
      this.active += 1;
      this.laneActive[lease.lane] += 1;
      waiter.ticket = this.retain(lease);
      waiter.resolve(waiter.ticket);
    }
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
  }

  private retain(lease: LeaseState): ExecutionLease {
    if (lease.released) throw new Error('execution lease already released');
    if (this.blockedReason) throw new Error(this.blockedReason);
    if (lease.deadlineAt !== undefined && Date.now() >= lease.deadlineAt) throw new Error('execution lease expired');
    lease.refCount += 1;
    let memberReleased = false;
    return {
      lane: lease.lane,
      groupId: lease.groupId,
      epoch: lease.epoch,
      policy: lease.policy,
      acquiredAt: lease.acquiredAt,
      deadlineAt: lease.deadlineAt,
      get refCount() { return lease.refCount; },
      get released() { return lease.released; },
      retain: () => this.retain(lease),
      release: () => {
        if (memberReleased) return;
        memberReleased = true;
        lease.refCount -= 1;
        if (lease.refCount !== 0) return;
        lease.released = true;
        if (lease.groupId && this.groups.get(lease.groupId) === lease) this.groups.delete(lease.groupId);
        this.active -= 1;
        this.laneActive[lease.lane] -= 1;
        this.dispatch();
      },
    };
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}
