import type { YZJIncomingMessage } from './yzj-types.js';
export declare const DEFAULT_WEBSOCKET_HEALTH: {
    readonly heartbeatMs: 15000;
    readonly staleMs: 45000;
};
export declare function getReconnectDelayMs(attempt: number): number;
export declare function shouldReconnectAfterInvalidFrames(consecutiveInvalidFrames: number): boolean;
type ControlResult = {
    kind: 'control';
    reason: string;
    ack?: string;
};
type DispatchResult = {
    kind: 'dispatch';
    message: YZJIncomingMessage;
};
type InvalidResult = {
    kind: 'invalid';
};
export declare function classifyWebSocketPayload(payload: unknown): ControlResult | DispatchResult | InvalidResult;
export {};
