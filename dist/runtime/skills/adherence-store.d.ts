import type { SkillComplianceResult } from '../../ai/skills/compliance.js';
export interface SkillAdherenceRecord {
    skillName: string;
    passedCount: number;
    failedCount: number;
    failedByReason: Record<string, number>;
    updatedAt: number;
}
export declare class FileSkillAdherenceStore {
    private readonly filePath;
    constructor(filePath?: string);
    loadAll(): SkillAdherenceRecord[];
    record(skillName: string, compliance: SkillComplianceResult): void;
    private saveAll;
}
export declare function deriveFailureReasons(compliance: SkillComplianceResult): string[];
