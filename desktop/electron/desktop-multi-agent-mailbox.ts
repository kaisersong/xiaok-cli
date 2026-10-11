import type { DesktopMailboxPort, MultiAgentDrainedBatch } from '../shared/multi-agent-types.js';
import type { DesktopMultiAgentStore, DesktopMultiAgentMutationPort } from './desktop-multi-agent-store.js';

/** One group, one short command queue. Execution and cleanup promises never own it. */
export class MultiAgentCommandSequencer {
  private readonly pending: Array<() => void> = [];
  private scheduled = false;
  constructor(private readonly capacity = 10_000) {}

  run<T>(action: () => T): Promise<T> {
    if (this.pending.length >= this.capacity) return Promise.reject(new Error('multi_agent_commands_overloaded'));
    return new Promise<T>((resolve, reject) => {
      this.pending.push(() => {
        try {
          const result = action();
          if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('multi-agent command must be synchronous');
          resolve(result);
        } catch (error) { reject(error); }
      });
      if (!this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => this.flush());
      }
    });
  }

  private flush(): void {
    // Bound each flush so later mailbox/runtime commands can join the same FIFO.
    for (let count = 0; count < 64 && this.pending.length; count++) this.pending.shift()!();
    if (this.pending.length) queueMicrotask(() => this.flush());
    else this.scheduled = false;
  }
}

type SealOutcome = 'completed' | 'failed' | 'interrupted';
type SealResult = Awaited<ReturnType<DesktopMailboxPort['trySealTurn']>>;
const semanticMailboxes = new WeakMap<object, () => Promise<(() => void) | undefined>>();
/** Private main composition: copying a port never copies the actual mailbox owner. */
export function bindDesktopMailboxSemanticAlias(alias: DesktopMailboxPort, original: DesktopMultiAgentTurnMailbox): void {
  const capture = semanticMailboxes.get(original);
  if (!capture || !(original instanceof DesktopMultiAgentTurnMailbox)) throw new Error('semantic_mailbox_untrusted');
  if (semanticMailboxes.has(alias)) throw new Error('semantic_mailbox_already_bound');
  semanticMailboxes.set(alias, capture);
}
export async function captureDesktopMailboxSemanticBoundary(mailbox: DesktopMailboxPort): Promise<(() => void) | undefined> {
  const capture = semanticMailboxes.get(mailbox);
  if (!capture) throw new Error('semantic_mailbox_untrusted');
  return capture();
}

/** Durable input owner shared by root and child Desktop loops. No second inbox. */
export class DesktopMultiAgentTurnMailbox implements DesktopMailboxPort {
  private sealed?: SealResult;
  constructor(private readonly options: {
    store: DesktopMultiAgentStore; groupId: string; agentId: string; turnId: string;
    commands: MultiAgentCommandSequencer;
    assertCurrent(): void;
    assertSemanticCurrent?(): void;
    beforeSeal?(): void;
    onSeal(outcome: SealOutcome, acceptedPort: DesktopMultiAgentMutationPort): void;
  }) {
    semanticMailboxes.set(this, () => this.options.commands.run(() => {
      this.assertActive();
      this.options.assertSemanticCurrent?.();
      const boundary = this.options.store.captureSemanticInputBoundary(this.options.groupId, this.options.agentId);
      return boundary && (() => { this.assertActive(); this.options.assertSemanticCurrent?.(); boundary(); });
    }));
  }

  drainInput(): Promise<MultiAgentDrainedBatch> {
    return this.options.commands.run(() => {
      this.assertActive();
      return this.options.store.drainInput(this.options.groupId, this.options.agentId, this.options.turnId);
    });
  }
  confirmApplied(claimId: string): Promise<void> {
    return this.options.commands.run(() => {
      this.assertActive();
      this.options.store.confirmApplied(this.options.groupId, claimId, this.options.turnId);
    });
  }
  returnClaim(claimId: string): Promise<void> {
    return this.options.commands.run(() => {
      // Returning an unconfirmed owned claim remains safe after cancellation/seal.
      this.options.store.returnClaim(this.options.groupId, claimId, this.options.turnId);
    });
  }
  trySealTurn(input: { limitReached?: boolean; outcome?: SealOutcome } = {}): Promise<SealResult> {
    return this.options.commands.run(() => {
      if (this.sealed) return this.sealed;
      this.options.assertCurrent();
      const outcome = input.outcome ?? 'completed';
      const unread = this.options.store.hasUnread(this.options.groupId, this.options.agentId);
      if (outcome === 'completed' && unread && !input.limitReached) return { kind: 'continue' };
      const limited = outcome === 'completed' && unread && Boolean(input.limitReached);
      this.options.beforeSeal?.();
      this.options.store.transaction((acceptedPort) => this.options.onSeal(limited ? 'failed' : outcome, acceptedPort));
      this.sealed = { kind: limited ? 'limit_reached' : 'sealed' };
      return this.sealed;
    });
  }

  private assertActive(): void {
    if (this.sealed) throw new Error('multi_agent_turn_sealed');
    this.options.assertCurrent();
  }
}

export class DesktopMultiAgentIterationLimitError extends Error {
  readonly code = 'tool_loop_iteration_limit';
  constructor(readonly partialReply: string, readonly limit: number, readonly used: number, readonly source: string) {
    super(`tool_loop_iteration_limit: used=${used}, limit=${limit}, source=${source}; configure XIAOK_AGENT_MAX_ITERATIONS or task maxToolLoopIterations`);
  }
}
