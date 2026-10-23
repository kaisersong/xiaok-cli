import { type ControllerGrant, type ControllerCaller, type ControllerRequestSource } from './controller-grants.js';
declare const methods: readonly ["controller.status", "execution.query", "execution.reserve", "execution.dispatch", "execution.cancel", "completion.query", "completion.propose"];
export type ControllerMethod = typeof methods[number];
export interface ControllerRequest {
    requestId: string;
    method: ControllerMethod;
    payload: unknown;
    grant: ControllerGrant;
}
export declare function encodeControllerRequest(request: ControllerRequest): Buffer;
export interface ControllerHandlers {
    invoke(method: Exclude<ControllerMethod, 'controller.status'>, payload: unknown, caller: ControllerCaller, signal: AbortSignal): Promise<unknown>;
}
/** Actual daemon lifecycle and private capability boundary; qualification comes from installed factories. */
export declare function createControllerDaemon(options: {
    root: string;
    handlers?: ControllerHandlers;
}): Promise<{
    readonly socketPath: string;
    issueGrant(input: {
        principalId: string;
        requestSource: ControllerRequestSource;
        method: ControllerMethod;
        payload: unknown;
        expiresAt: number;
    }): ControllerGrant;
    revokePrincipal(principalId: string): void;
    close(): Promise<void>;
}>;
export {};
