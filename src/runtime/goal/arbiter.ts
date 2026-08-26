export type ContinuationDecision =
  | { kind: 'user'; input: string }
  | { kind: 'broker'; input: string }
  | { kind: 'goal'; input: string };

export class ContinuationArbiter {
  select(input: {
    queuedUserInput?: string | null;
    brokerContinuation?: string | null;
    goalContinuation?: string | null;
  }): ContinuationDecision | null {
    if (input.queuedUserInput) return { kind: 'user', input: input.queuedUserInput };
    if (input.brokerContinuation) return { kind: 'broker', input: input.brokerContinuation };
    if (input.goalContinuation) return { kind: 'goal', input: input.goalContinuation };
    return null;
  }
}
