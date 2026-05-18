export type DiagnosisHealth = 'healthy' | 'running' | 'waiting' | 'blocked' | 'failed' | 'unknown';
export type DiagnosisSeverity = 'critical' | 'high' | 'medium' | 'low';
export type DiagnosisCategory = 'blocked_task' | 'dispatch_stalled' | 'empty_artifact' | 'approval_wait' | 'quality_failure' | 'unknown';
export interface DiagnosisFinding {
    id: string;
    severity: DiagnosisSeverity;
    category: DiagnosisCategory;
    title: string;
    explanation: string;
    confidence: number;
    evidenceIds: string[];
}
export interface DiagnosisAction {
    id: string;
    label: string;
    recommended?: boolean;
}
export interface DiagnosisEvidence {
    id: string;
    label: string;
    data?: Record<string, unknown>;
}
export interface DiagnosisReport {
    schemaVersion: 1;
    target: {
        kind: 'session' | 'project' | 'task';
        id?: string;
    };
    generatedAt: string;
    health: DiagnosisHealth;
    primaryFinding: DiagnosisFinding | null;
    findings: DiagnosisFinding[];
    recommendedActions: DiagnosisAction[];
    evidence: DiagnosisEvidence[];
}
