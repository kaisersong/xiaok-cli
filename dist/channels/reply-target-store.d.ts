import type { ChannelReplyTarget } from './types.js';
export declare class FileReplyTargetStore {
    private readonly filePath;
    private readonly entries;
    constructor(filePath: string);
    set(sessionId: string, replyTarget: ChannelReplyTarget): void;
    get(sessionId: string): ChannelReplyTarget | undefined;
    delete(sessionId: string): void;
    private load;
    private persist;
}
