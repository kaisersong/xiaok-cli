/** Host composition only. These calls do not expose the controller's authorization issuer. */
export declare const COMPLETION_METHODS: readonly ["completion.read-intent-registration", "completion.read-intent-contract", "completion.read-goal-fork-source", "completion.open-owner", "completion.prepare-owner", "completion.prepare-owner-request", "completion.lookup-owner-request", "completion.recover-owner-request", "completion.authorize-owner", "completion.inspect", "completion.settle", "completion.authorize", "completion.receiver-challenge", "completion.receiver-reply"];
export type CompletionMethod = typeof COMPLETION_METHODS[number];
export interface AuthenticatedCompletionTransport {
    call(method: CompletionMethod, payload: unknown, signal?: AbortSignal): Promise<unknown>;
    callSync(method: 'completion.inspect' | 'completion.open-owner', payload: unknown): unknown;
}
