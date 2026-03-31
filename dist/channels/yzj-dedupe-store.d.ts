export declare class YZJInboundDedupeStore {
    private readonly ttlMs;
    protected readonly seen: Map<string, number>;
    constructor(ttlMs?: number);
    markSeen(messageId: string): boolean;
    private sweep;
}
export declare class FileYZJInboundDedupeStore extends YZJInboundDedupeStore {
    private readonly filePath;
    constructor(filePath: string, ttlMs?: number);
    markSeen(messageId: string): boolean;
    private load;
    private persist;
}
