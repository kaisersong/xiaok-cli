// Pure data contracts only; no fixture, parser or suggestion grants authority.
export type Id = string; // 1..2048 UTF16 units，无C0/DEL/不良surrogate
export type Hash = string; // exact lower-case hex64
export type Revision = number; // safe integer >=1
export type Count = number; // safe integer >=0
export type EpochMs = number; // safe integer，0..253402300799999，拒-0
export type Instant = string; // strict UTC ISO: seconds或3-digit-ms，末尾Z
export type UnknownReason = 'producer_unavailable' | 'missing' | 'pending' | 'inconsistent';
export type Fact<T> = Readonly<{
    state: 'known';
    value: T;
} | {
    state: 'unknown';
    reason: UnknownReason;
}>;
export type Mode = 'off' | 'observe' | 'auto_draft';
export type Action = 'source.read' | 'model.process_source' | 'local.draft.create' | 'local.draft.revise';
export type RuleVersion = 'github_issue_draft_v1';
export type PolicyVersion = 'github_issue_draft_v1/a2-evaluator-v1';
export type Use = 'admission' | 'shadow';
// 这些Frozen*是冻结原类型的完整别名，不是结构unknown或另一套writer DTO。
export type FrozenAuthScope = Readonly<{
    tenantId: Id;
    workspaceId: Id;
    connectionId: Id;
    providerAccountId: Id;
    repositoryId: Id;
    credentialEpoch: Revision;
}>;
export type FrozenThreadKey = Readonly<{
    sourceBindingId: Id;
    tenantId: Id;
    workspaceId: Id;
    provider: 'github';
    repositoryId: Id;
    kind: 'issue';
    threadId: Id;
}>;
export type FrozenActorEvidence = Readonly<{
    kind: 'verified_event';
    eventRef: Id;
    triggerActorId: Id;
} | {
    kind: 'verified_audit';
    auditRef: Id;
    triggerActorId: Id;
} | {
    kind: 'unknown';
    reason: string;
}>;
export type FrozenSourceBinding = Readonly<{
    sourceBindingId: Id;
    tenantId: Id;
    workspaceId: Id;
    provider: 'github';
    repositoryId: Id;
    activeAuthScope: FrozenAuthScope;
    version: Revision;
}>;
export type FrozenInputEnvelopeV1 = Readonly<{
    schemaVersion: 1;
    inputId: Id;
    thread: FrozenThreadKey;
    authScope: FrozenAuthScope;
    providerEventId: Id | null;
    objectKind: 'issue' | 'comment';
    objectId: Id;
    providerRevision: string;
    contentHash: Hash;
    receivedAt: Instant;
    objectAuthorId: Id | null;
    actorEvidence: FrozenActorEvidence;
    actorMappingVersion: Revision;
    provenanceVersion: Revision;
    actorEvidenceHash: Hash;
    kind: 'created' | 'edited' | 'deleted' | 'snapshot';
    trust: 'external_untrusted';
    snapshotRef: Id;
    completeness: 'complete' | 'partial' | 'unknown';
    paginationComplete: boolean;
    authorizationCheckedAt: Instant;
    providerOccurredAt?: Instant;
    providerTimeEvidenceRef?: Id;
}>;
export type FrozenMandateV1 = Readonly<{
    schemaVersion: 1;
    mandateId: Id;
    sourceBindingId: Id;
    revision: Revision;
    authorizationEpoch: Revision;
    status: 'active' | 'revoked' | 'expired';
    issuedByUserId: Id;
    allowedActorProviderIds: readonly Id[];
    allowedActions: readonly Action[];
    ruleVersion: RuleVersion;
    selection: Readonly<{
        issueIds: readonly Id[];
    } | {
        labelIds: readonly Id[];
    }>;
    validUntil: Instant;
    maxInputBytes: Count;
    budgetRef: Id;
    limits: Readonly<{
        maxActiveWorks: Count;
        maxDraftRunsPerWork: Count;
        maxTokens: Count;
        maxCostMinor: Count;
        currency: string;
        executionDeadline: Instant;
    }>;
    dataEgressPolicyRef: Id;
    ownerDomains: readonly Readonly<{
        domainId: Id;
        kind: 'work' | 'egress_gate' | 'active_pointer';
    }>[];
    ownerDomainsHash: Hash;
    followup: Readonly<{
        enabled: boolean;
        observationEndsAt: Instant;
        completionPredicate: 'draft_ready';
        resumeAfterCompletion: false;
    }>;
}>;
export type FrozenSemanticAssessment = Readonly<{
    assessmentId: Id;
    evidenceManifestHash: Hash;
    ruleVersion: string;
    modelId: string;
    promptVersion: string;
    dataEgressPolicyRef: Id;
    validUntil: Instant;
    assessmentHash: Hash;
    assessmentVersion: 1 | 2;
    purpose: 'admission' | 'preview';
    decisive: boolean;
    suggestedIntent: 'draft_request' | 'followup' | 'chat' | 'ambiguous';
    evidenceRefs: readonly Id[];
    uncertainty: string | null;
}>;
export type EvidenceEntry = Readonly<{
    inputId: Id;
    objectKind: 'issue' | 'comment';
    objectId: Id;
    revision: string;
    contentHash: Hash;
    provenanceVersion: Revision;
    actorEvidenceHash: Hash;
    actorMappingVersion: Revision;
}>;
export type FrozenEvidenceManifest = Readonly<{
    schemaVersion: 1;
    thread: FrozenThreadKey;
    entries: readonly EvidenceEntry[];
    sourceSnapshotAt: Instant;
    manifestHash: Hash;
}>;
export type FrozenWorkBinding = Readonly<{
    bindingId: Id;
    mandateId: Id;
    thread: FrozenThreadKey;
    generation: 1;
    ownerKind: string;
    version: Revision;
    transport: Readonly<{
        kind: 'reserved';
        createOperationKey: Id;
        createCommandId: Id;
        canonicalInitialInputId: Id;
        canonicalCreateManifestHash: Hash;
    } | {
        kind: 'bound';
        ownerWorkId: Id;
        ownerVersion: Revision;
        workCreatedAt: Instant;
        workExecutionDeadline: Instant;
    }>;
}>;
export type FrozenAutoAdmissionWindow = Readonly<{
    windowId: Id;
    sourceBindingId: Id;
    prefixModeGuardsHash: Hash;
    admissionGrantHash: Hash;
    effectiveAt: Instant;
    baselineCheckpointRef: Id;
    providerTimeBasisProofRef: Id;
    freshnessPolicyVersion: 1;
}>;
export type A2InputProjectionV1 = Readonly<{
    envelope: FrozenInputEnvelopeV1;
    inputUtf8Bytes: Count;
    evidence: Fact<FrozenEvidenceManifest>;
}>;
export type EvidenceHead = EvidenceEntry & Readonly<{
    headHash: Hash;
    proofHash: Hash;
    state: 'current' | 'superseded' | 'deleted' | 'conflict' | 'unconfirmed';
}>;
export type A2SourceProjectionV1 = Readonly<{
    binding: FrozenSourceBinding;
    credential: 'active' | 'revoked';
    credentialRevision: Revision;
    authAttestationRef: Id;
    provenance: 'verified' | 'unproven' | 'revoked';
    provenanceVersion: Revision;
    actorMapping: 'verified' | 'unproven';
    actorMappingVersion: Revision;
    evidenceHeads: readonly EvidenceHead[];
}>;
export type A2RuleLabelsV1 = Readonly<{
    repositoryId: Id;
    threadId: Id;
    revision: Revision;
    labelIds: readonly Id[];
}>;
// rule的issue选择由mandate.selection+threadId计算；label选择才读labels。
// actor由原envelope.triggerActorId与mandate白名单计算，不接actorAllowed=true。
export type WorkProfileProjection = Readonly<{
    executionProfile: 'model_text_only_v1';
    schemaVersion: 1;
    snapshotHash: null;
    snapshotPolicyDigest: null;
    approvalRef: null;
} | {
    executionProfile: 'dsh_readonly_v1';
    schemaVersion: 2;
    snapshotHash: Hash;
    snapshotPolicyDigest: Hash;
    approvalRef: Id;
}>;
export type A2MandateProjectionV1 = Readonly<{
    document: FrozenMandateV1;
    assessmentProfile: 'model_text_only_v1';
    workProfile: Fact<WorkProfileProjection>;
    contentHash: Hash | null;
}>;
export type StorageScope = Readonly<{
    profileId: Hash;
    workspaceId: Hash;
}>;
export type PrefixIdentity = Readonly<{
    kind: 'global';
} | {
    kind: 'tenant';
    tenantId: Id;
} | {
    kind: 'workspace';
    tenantId: Id;
    workspaceId: Id;
} | {
    kind: 'sourceBinding';
    tenantId: Id;
    workspaceId: Id;
    provider: 'github';
    repositoryId: Id;
    sourceBindingId: Id;
} | {
    kind: 'mandate';
    tenantId: Id;
    workspaceId: Id;
    provider: 'github';
    repositoryId: Id;
    sourceBindingId: Id;
    mandateId: Id;
}>;
export type ModeCell = Readonly<{
    identity: PrefixIdentity;
    scopeKey: Id;
    epoch: Revision;
    revision: Revision;
    mode: Mode;
}>;
export type PrefixModes = readonly [
    ModeCell,
    ModeCell,
    ModeCell,
    ModeCell,
    ModeCell
];
export type PolicyAxis = 'mandate' | 'egress' | 'privacy' | 'readonly';
export type PolicyCell = Readonly<{
    identity: PrefixIdentity;
    scopeKey: Id;
    axis: PolicyAxis;
    epoch: Revision;
    revision: Revision;
    allowed: boolean;
}>;
export type LeafRef = Readonly<{
    kind: 'source_auth' | 'mandate' | 'egress' | 'readonly';
    scopeKey: Id;
    epoch: Revision;
    revision: Revision;
    contentHash: Hash;
}>;
export type A2ControlProjectionV1 = Readonly<{
    prefixModes: PrefixModes;
    prefixPolicies: readonly PolicyCell[];
    leaves: readonly LeafRef[];
    confirmedOwnerDomains: readonly Id[];
    ownerDomainsHash: Hash;
    baseline: 'confirmed' | 'pending' | 'missing';
}>;
export type Headroom = Readonly<{
    budgetRef: Id;
    inputId: Id;
    mandateId: Id;
    purpose: 'admission' | 'preview' | 'draft';
    scopeRevision: Revision;
    budgetPolicyVersion: Id;
    requirementHash: Hash;
    remainingTokens: Count;
    remainingCostMinor: Count;
    requiredMaxTokens: Count;
    requiredMaxCostMinor: Count;
    currency: string;
    remainingActiveWorks: Count;
}>;
export type A2BudgetProjectionV1 = Readonly<{
    assessment: Fact<Headroom>;
    draft: Fact<Headroom>;
}>;
export type A2EgressProjectionV1 = Readonly<{
    policyRef: Id;
    revision: Revision;
    epoch: Revision;
    policyHash: Hash;
    provider: Id;
    destinationRef: Id;
    purposes: readonly ('admission' | 'preview' | 'draft')[];
    executionProfile: 'model_text_only_v1';
    decision: 'allow' | 'deny';
    baseline: 'confirmed' | 'pending' | 'missing';
}>;
export type WorkGuard = Readonly<{
    scopeKey: Id;
    epoch: Revision;
    revision: Revision;
    mode: Mode;
}>;
export type A2BindingProjectionV1 = Readonly<{
    kind: 'none';
} | {
    kind: 'reserved';
    binding: FrozenWorkBinding & {
        transport: Extract<FrozenWorkBinding['transport'], {
            kind: 'reserved';
        }>;
    };
} | {
    kind: 'bound';
    binding: FrozenWorkBinding & {
        transport: Extract<FrozenWorkBinding['transport'], {
            kind: 'bound';
        }>;
    };
    ownerVersion: Revision;
    inputSetRevision: Revision;
    stopped: boolean;
    terminal: boolean;
    completionReached: boolean;
    generationClosed: boolean;
    workGuard: WorkGuard;
}>;
export type A2ConsumptionProjectionV1 = Readonly<{
    kind: 'none';
} | {
    kind: 'pending';
} | {
    kind: 'unknown';
} | {
    kind: 'consumed';
    thread: FrozenThreadKey;
    inputId: Id;
    evidenceManifestHash: Hash;
    mandateId: Id;
    bindingId: Id;
    ownerWorkId: Id;
    ownerVersion: Revision;
    inputSetRevision: Revision;
    operationKey: Id;
    semanticPayloadHash: Hash;
    receiptRef: Id;
}>;
export type SelectedAssessment = Readonly<{
    inputId: Id;
    mandateId: Id;
    mandateRevision: Revision;
    assessmentVersion: 1 | 2;
    assessmentId: Id;
    assessmentHash: Hash;
}>;
export type A2SelectionProjectionV1 = Readonly<{
    kind: 'none';
} | {
    kind: 'selected';
    value: SelectedAssessment;
}>;
export type A2FreshnessProjectionV1 = Readonly<{
    window: FrozenAutoAdmissionWindow;
    inputId: Id;
    evidenceManifestHash: Hash;
    eventTimeEvidenceRef: Id;
    eventOccurredAt: Instant;
    attestationRef: Id;
    state: 'fresh' | 'backlog' | 'unproven';
}>;
export type A2ModelPolicyV1 = Readonly<{
    modelId: Id;
    promptVersion: Id;
    ruleVersion: RuleVersion;
    assessmentProfile: 'model_text_only_v1';
    negativeHintPolicy: 'uncertainty-negative-v1';
}>;
export type ClockProjection = Readonly<{
    state: 'verified';
    domainId: Id;
    qualificationEpoch: Revision;
    nowMs: EpochMs;
} | {
    state: 'unverified' | 'rollback_detected';
}>;
export type A2SnapshotV1 = Readonly<{
    schemaVersion: 1;
    policyVersion: PolicyVersion;
    use: Use;
    purpose: 'admission' | 'preview';
    storageScope: StorageScope;
    principalId: Id;
    input: A2InputProjectionV1;
    source: Fact<A2SourceProjectionV1>;
    labels: Fact<A2RuleLabelsV1>;
    mandate: Fact<A2MandateProjectionV1>;
    controls: Fact<A2ControlProjectionV1>;
    budget: A2BudgetProjectionV1;
    egress: Fact<A2EgressProjectionV1>;
    binding: Fact<A2BindingProjectionV1>;
    consumption: Fact<A2ConsumptionProjectionV1>;
    selection: Fact<A2SelectionProjectionV1>;
    assessment: FrozenSemanticAssessment | null;
    freshness: Fact<A2FreshnessProjectionV1>;
    modelPolicy: A2ModelPolicyV1;
    clock: ClockProjection;
}>;
export type Reason = 'IDENTITY_OR_SCOPE_MISMATCH'
  | 'MANDATE_BINDING_MISMATCH'
  | 'SNAPSHOT_INCOMPLETE'
  | 'SOURCE_PROOF_UNCONFIRMED'
  | 'SNAPSHOT_NOT_ACTIONABLE'
  | 'CONTROL_ONLY_INPUT'
  | 'OUT_OF_RULE_SCOPE'
  | 'ACTOR_NOT_WHITELISTED'
  | 'TRIGGER_ACTOR_UNPROVEN'
  | 'DUPLICATE_INPUT'
  | 'INPUT_CONFLICT'
  | 'BASELINE_UNCONFIRMED'
  | 'MODE_OFF'
  | 'MANDATE_UNAVAILABLE'
  | 'MANDATE_REVOKED'
  | 'MANDATE_EXPIRED'
  | 'MANDATE_ACTION_UNAVAILABLE'
  | 'TIME_BASIS_UNCONFIRMED'
  | 'OBSERVATION_WINDOW_CLOSED'
  | 'WORK_DEADLINE_EXCEEDED'
  | 'AUTHORITY_EXPIRED'
  | 'BUDGET_UNCONFIRMED'
  | 'BUDGET_EXHAUSTED'
  | 'EGRESS_UNCONFIRMED'
  | 'EGRESS_DENIED'
  | 'BACKLOG_REQUIRES_REVIEW'
  | 'OWNER_NOT_RESUMABLE'
  | 'OWNER_BINDING_UNCONFIRMED'
  | 'ASSESSMENT_REQUIRED'
  | 'ASSESSMENT_SELECTION_UNCONFIRMED'
  | 'ASSESSMENT_INVALID'
  | 'ASSESSMENT_BINDING_MISMATCH'
  | 'ASSESSMENT_EXPIRED_REVIEW_REQUIRED'
  | 'ASSESSMENT_PREVIEW_ONLY'
  | 'ASSESSMENT_UNCERTAIN'
  | 'NO_ACTIONABLE_REQUEST'
  | 'QUOTED_REQUEST_ONLY'
  | 'AMBIGUOUS_GOAL'
  | 'OUT_OF_MANDATE_ACTION'
  | 'EXPLICIT_DRAFT_REQUEST'
  | 'ACTIVE_OWNER_INPUT'
  | 'SHADOW_ONLY';
export type PreflightResult = Readonly<{
    kind: 'preflight';
    state: 'assessment_required';
    preflightSnapshotHash: Hash;
    reasonCodes: readonly Reason[];
} | {
    kind: 'preflight';
    state: 'assessment_available';
    preflightSnapshotHash: Hash;
    assessmentRef: Id;
} | {
    kind: 'preflight';
    state: 'blocked';
    recommendation: 'reject' | 'needs_review';
    preflightSnapshotHash: Hash;
    reasonCodes: readonly Reason[];
}>;
export type AdmissionSuggestion = Readonly<{
    kind: 'admission_suggestion';
    verdict: 'reject' | 'needs_review' | 'accept' | 'followup';
    reasonCodes: readonly Reason[];
    evaluatedSnapshotHash: Hash;
    assessmentRef: Id | null;
    previousReceiptRef: Id | null;
}>;
export type ShadowSuggestion = Readonly<{
    kind: 'shadow_suggestion';
    semanticClassification: 'draft_request' | 'followup' | 'chat' | 'ambiguous' | 'unavailable';
    reasonCodes: readonly Reason[];
    evaluatedSnapshotHash: Hash;
    assessmentRef: Id | null;
}>;
export type SourceControlInputV1 = Readonly<{
    envelope: FrozenInputEnvelopeV1;
    controlEvidence: Fact<Readonly<{
        thread: FrozenThreadKey;
        objectKind: 'issue' | 'comment';
        objectId: Id;
        providerRevision: string;
        contentHash: Hash;
        proofRef: Id;
        sourceBindingVersion: Revision;
        kind: 'verified_snapshot' | 'verified_deletion';
    }>>;
}>;
export type SourceControlResult = Readonly<{
    kind: 'source_control';
    inputId: Id;
    disposition: 'observed_only' | 'invalidation_only' | 'needs_review';
    reasonCodes: readonly Reason[];
}>;
// 所有parse错误为固定A2_CONTRACT_INVALID；纯函数不创建假decisionId或空身份行。
export type DeadlineState = 'open' | 'closed' | 'not_applicable' | 'unconfirmed';
export type A2TimeStateV1 = Readonly<{
    clock: 'verified' | 'unverified' | 'rollback_detected';
    mandate: DeadlineState;
    assessment: DeadlineState;
    authority: DeadlineState;
    work: DeadlineState;
    observation: DeadlineState;
    window: 'fresh' | 'backlog' | 'unproven';
}>;
