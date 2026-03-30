export declare class YZJInboundDedupeStore {
    private readonly ttlMs;
    private readonly seen;
    constructor(ttlMs?: number);
    markSeen(messageId: string): boolean;
    private sweep;
}
