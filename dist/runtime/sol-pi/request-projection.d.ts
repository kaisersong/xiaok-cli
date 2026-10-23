/** Request-view planning only. Authorization, transport leases and counters remain owner-owned. */
export interface ProjectionBlock {
    type: string;
    [key: string]: unknown;
}
export interface ProjectionMessage {
    role: string;
    content: ProjectionBlock[];
    [key: string]: unknown;
}
export interface ProjectionRequest {
    modelId: string;
    protocolId: string;
    systemPrompt: string;
    tools: unknown[];
    messages: ProjectionMessage[];
    [key: string]: unknown;
}
export interface NativeObservationProjection {
    kind: 'native';
    /** Host-owned exact segmentation; no free-text parsing or policy-text replacement. */
    segments: {
        before: string;
        native: string;
        after: string;
    };
    observationId: string;
    toolUseId: string;
    authorizedText: string;
    mandatoryStatus: string;
    reference: string;
    fullLogicalSendCount: number | null;
}
export type AuthorizedObservationProjection = NativeObservationProjection | {
    kind: 'recall';
    observationId: string;
    toolUseId: string;
};
export interface ProjectionInput<R extends ProjectionRequest = ProjectionRequest> {
    request: R;
    observations: readonly AuthorizedObservationProjection[];
    windowTokens: number | null;
    outputReserveTokens: number;
    safetyMarginTokens: number;
    /** Exact top-level provider wire output-limit field. Unsupported shapes must skip. */
    outputLimitField: string | null;
    /** Host-derived provider default upper bound; pure planning does not authenticate it. */
    verifiedDefaultOutputReserveTokens?: number;
    previewBytes: number;
    tokenBound?: {
        modelId: string;
        protocolId: string;
        validationEvidenceId: string;
        countRequestTokens(request: Readonly<R>): number;
    };
}
export type ProjectionResult<R extends ProjectionRequest = ProjectionRequest> = {
    status: 'skipped';
    reason: string;
} | {
    status: 'context_budget_exceeded';
    reason: string;
} | {
    status: 'projected';
    request: R;
    inputTokenUpperBound: number;
    totalTokenUpperBound: number;
    fullObservationIds: string[];
    fullCountProposals: Array<{
        observationId: string;
        expectedCount: number;
    }>;
};
export declare function planObservationRequest<R extends ProjectionRequest>(input: ProjectionInput<R>): ProjectionResult<R>;
