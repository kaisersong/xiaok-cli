export type RegressionKind = 'test' | 'eval' | 'ux' | 'routing' | 'artifact' | 'reliability';
export type RegressionSource = 'manual' | 'runtime' | 'eval';
export type RegressionSuggestedLayer = 'unit' | 'integration' | 'structured-eval' | 'artifact-smoke' | 'manual' | 'slow-gate';
export type RegressionEvidenceKind = 'transcript' | 'artifact' | 'trace' | 'feedback' | 'note' | 'path';
export interface RegressionEvidence {
    kind: RegressionEvidenceKind;
    value: string;
}
export interface RegressionRecord {
    id: string;
    title: string;
    summary: string;
    kind: RegressionKind;
    source: RegressionSource;
    suggestedLayer: RegressionSuggestedLayer;
    createdAt: string;
    evidence: RegressionEvidence[];
}
export interface CreateRegressionRecordInput {
    id?: string;
    title: string;
    summary: string;
    kind: RegressionKind;
    source: RegressionSource;
    suggestedLayer: RegressionSuggestedLayer;
    evidence?: RegressionEvidence[];
    createdAt?: string;
}
export interface WriteRegressionRecordInput extends CreateRegressionRecordInput {
    outputDir?: string;
    overwrite?: boolean;
}
export interface WriteRegressionRecordResult {
    record: RegressionRecord;
    path: string;
}
export declare function createRegressionRecord(input: CreateRegressionRecordInput): RegressionRecord;
export declare function writeRegressionRecord(input: WriteRegressionRecordInput): WriteRegressionRecordResult;
export declare function slugifyRegressionId(value: string): string;
