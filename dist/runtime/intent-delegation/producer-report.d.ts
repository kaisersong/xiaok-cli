export interface IntentProducerOrigin {
    kind: 'model-report';
    providerInvocationId: string;
    toolInvocationId: string;
}
export type IntentProducerAction = {
    kind: 'step-report';
    stepId: string;
    status: 'running' | 'blocked' | 'completed' | 'failed';
    breadcrumb: string;
    receiptNote: string | null;
    blockedReason: string | null;
    origin: IntentProducerOrigin;
} | {
    kind: 'artifact-report';
    stageId: string;
    kindOfArtifact: 'markdown' | 'report' | 'slides' | 'summary' | 'analysis' | 'document' | 'unknown';
    storage: 'inline' | 'file_ref';
    label: string;
    path: string | null;
    inlineValue: string | null;
    summary: string | null;
    reportedStructuralValidation: 'pending' | 'passed' | 'failed';
    reportedSemanticValidation: 'pending' | 'passed' | 'failed';
    origin: IntentProducerOrigin;
};
export interface IntentProducerReport {
    protectionMode: 'ordinary' | 'protected';
    action: IntentProducerAction;
    requestSource: 'user' | 'agent' | 'scheduler';
    now: number;
    artifactId: string | null;
}
export declare function parseIntentProducerAction(raw: unknown): Readonly<IntentProducerAction>;
export declare function parseIntentProducerReport(raw: unknown): Readonly<IntentProducerReport>;
