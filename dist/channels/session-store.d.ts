import type { ChannelSession, ChannelSessionKey } from './types.js';
export interface ChannelSessionStore {
    getOrCreate(key: ChannelSessionKey): ChannelSession;
}
export declare class InMemoryChannelSessionStore implements ChannelSessionStore {
    protected readonly sessions: Map<string, ChannelSession>;
    protected nextId: number;
    getOrCreate(key: ChannelSessionKey): ChannelSession;
    protected buildStoreKey(key: ChannelSessionKey): string;
}
export declare class FileChannelSessionStore extends InMemoryChannelSessionStore {
    private readonly filePath;
    constructor(filePath: string);
    getOrCreate(key: ChannelSessionKey): ChannelSession;
    private load;
    private persist;
}
