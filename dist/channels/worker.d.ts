import type { ChannelSessionStore } from './session-store.js';
import type { ChannelRequest } from './webhook.js';
export interface ChannelWorkerResult {
    accepted: true;
    sessionId: string;
}
export interface ChannelRequestExecutor {
    execute(input: ChannelRequest, sessionId: string): Promise<void> | void;
}
export declare function handleChannelRequest(input: ChannelRequest, sessionStore: ChannelSessionStore, executor?: ChannelRequestExecutor): Promise<ChannelWorkerResult>;
