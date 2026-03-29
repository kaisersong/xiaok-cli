import type { InMemoryChannelSessionStore } from './session-store.js';
import type { ChannelRequest } from './webhook.js';
export interface ChannelWorkerResult {
    accepted: true;
    sessionId: string;
}
export declare function handleChannelRequest(input: ChannelRequest, sessionStore: InMemoryChannelSessionStore): Promise<ChannelWorkerResult>;
