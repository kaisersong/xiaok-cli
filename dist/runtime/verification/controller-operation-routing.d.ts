import { type CompletionMethod } from './completion-transport.js';
import type { ControllerPeer, PublicControllerMethod } from './controller-public-daemon.js';
/** Private installed routing. Renewing eligibility is not renewing native scope,
 * proof expiry or a material handle; actual handlers still validate all of them. */
export declare function createControllerOperationRouting(input: {
    assertCurrent(): void;
    renew(signal: AbortSignal): Promise<void>;
    publication: {
        observeIntentCompletion?(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        observeIntentDependencies?(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        observeLoopSet?(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        recoverRequest?(payload: unknown, peer: ControllerPeer): unknown;
        prepareRequest?(payload: unknown, peer: ControllerPeer): unknown;
        lookupRequest?(payload: unknown, peer: ControllerPeer): unknown;
        recoverUnapproved?(payload: unknown, peer: ControllerPeer): unknown;
        readOwnerPayload(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        observeOwner(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        recoverExpired(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        prepare(payload: unknown, peer: ControllerPeer): unknown;
        approve(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        reconcile(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
    };
    verification: {
        recoverRequest?(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        prepareRequest?(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        lookupRequest?(payload: unknown, peer: ControllerPeer): unknown;
        retireRequest?(payload: unknown, peer: ControllerPeer): unknown;
        inspectObligation?(payload: unknown, peer: ControllerPeer): unknown;
        prepare(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
        dispatch(payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
    };
    completion: {
        invoke(method: CompletionMethod, payload: unknown, peer: ControllerPeer, signal: AbortSignal): unknown;
    };
    execution: {
        invoke(method: string, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
    };
}): Readonly<{
    invoke(method: PublicControllerMethod, payload: unknown, peer: ControllerPeer, signal: AbortSignal): Promise<unknown>;
}>;
