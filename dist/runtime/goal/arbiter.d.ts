export type ContinuationDecision = {
    kind: 'user';
    input: string;
} | {
    kind: 'broker';
    input: string;
} | {
    kind: 'goal';
    input: string;
};
export declare class ContinuationArbiter {
    select(input: {
        queuedUserInput?: string | null;
        brokerContinuation?: string | null;
        goalContinuation?: string | null;
    }): ContinuationDecision | null;
}
