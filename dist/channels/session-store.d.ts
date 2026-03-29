import type { ChannelSession, ChannelSessionKey } from './types.js';
export declare class InMemoryChannelSessionStore {
    private readonly sessions;
    getOrCreate(key: ChannelSessionKey): ChannelSession;
    private buildStoreKey;
}
