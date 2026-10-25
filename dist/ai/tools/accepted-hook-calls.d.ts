export interface AcceptedHookCall {
    readonly receiver: object;
    readonly originalFunction: Function;
    readonly phase: 'generic' | 'pre' | 'post';
}
/** Only ToolRegistry's original hook continuations may call the bookkeeping methods.
 * No invoke(), raw.then, signal, observer, lifecycle hook or physical-release API. */
export declare class AcceptedHookCalls {
    #private;
    reserveOriginalCall(receiver: object, originalFunction: Function, phase: AcceptedHookCall['phase']): AcceptedHookCall;
    captureOriginalReturn(call: AcceptedHookCall, raw: unknown): void;
    recordOriginalResolution(call: AcceptedHookCall): void;
    recordOriginalRejection(call: AcceptedHookCall, error: unknown): void;
    recordUnconfirmedReturn(call: AcceptedHookCall, error: unknown): void;
    sealIngress(reason?: unknown): void;
    waitForAcceptedCalls(): Promise<void>;
}
