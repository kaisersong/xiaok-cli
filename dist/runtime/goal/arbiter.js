export class ContinuationArbiter {
    select(input) {
        if (input.queuedUserInput)
            return { kind: 'user', input: input.queuedUserInput };
        if (input.brokerContinuation)
            return { kind: 'broker', input: input.brokerContinuation };
        if (input.goalContinuation)
            return { kind: 'goal', input: input.goalContinuation };
        return null;
    }
}
