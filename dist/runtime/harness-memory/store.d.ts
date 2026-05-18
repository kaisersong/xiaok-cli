import type { HarnessMemoryEvidence, HarnessMemoryRecord, HarnessMemoryScope } from './types.js';
export declare class JsonHarnessMemoryStore {
    private readonly filePath;
    private readonly now;
    constructor(filePath: string, now?: () => Date);
    createCandidate(input: {
        category: string;
        summary: string;
        scope: HarnessMemoryScope;
        evidence: HarnessMemoryEvidence[];
        expiresAt?: string;
    }): HarnessMemoryRecord;
    listActive(scope: HarnessMemoryScope): HarnessMemoryRecord[];
    promote(id: string, input: {
        promotedBy: 'human' | 'eval' | 'diagnoser';
        reason: string;
        evidence: HarnessMemoryEvidence[];
    }): HarnessMemoryRecord;
    expire(id: string, reason: string): HarnessMemoryRecord;
    private load;
    private persist;
}
