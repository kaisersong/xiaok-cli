/** Desktop DSH settings DTOs. No credentials or source bodies appear in state. */
export type DshDesktopMode = 'off' | 'observe' | 'auto_draft';
export type DshDesktopSourceSelection =
  | Readonly<{ kind: 'issue_ids'; issueIds: readonly string[] }>
  | Readonly<{ kind: 'label_ids'; match: 'all'; labelIds: readonly string[] }>;
export type DshDesktopSetModeInput = Readonly<
  { schemaVersion: 1; mode: DshDesktopMode; expectedRevision: number } & (
    | {
        scopeKind: 'global' | 'tenant' | 'workspace' | 'source_binding';
        sourceBindingId: string | null;
        tenantId?: string;
      }
    | { scopeKind: 'mandate'; sourceBindingId: string; mandateId: string }
  )
>;
export interface DshDesktopConfigureSetupInput {
  schemaVersion: 1;
  setupId: string;
  tenantId?: string;
  candidateRepository: Readonly<{ owner: string; repo: string }>;
  selection: DshDesktopSourceSelection;
  issueRefs: readonly Readonly<{ issueId: string; issueNumber: number }>[];
  minimumIntervalMs: number;
  expectedRevision: number;
}
export type DshDesktopConnectInput =
  | Readonly<{
      schemaVersion: 1;
      kind: 'setup';
      setupId: string;
      configurationRevision: number;
      operationId: string;
      secret: string;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: 'source_binding';
      sourceBindingId: string;
      configurationRevision: number;
      operationId: string;
      secret: string;
    }>;
export interface DshDesktopDisconnectInput {
  schemaVersion: 1;
  sourceBindingId: string;
  configurationRevision: number;
}
export interface DshDesktopReconcileInput {
  schemaVersion: 1;
  sourceBindingId: string;
  configurationRevision: number;
}
export interface DshDesktopConfigureBudgetInput {
  schemaVersion: 1;
  tenantId?: string;
  mandateId: string;
  mandateRevision: number;
  tokenLimit: number;
  costLimitUsd: string;
  validUntil: string;
}
export interface DshDesktopPublishEgressPolicyInput {
  schemaVersion: 1;
  sourceBindingId: string;
  mandateId: string;
  policyRef: string;
  provider: string;
  modelIds: readonly string[];
  destinationRef: string;
  purposes: readonly ('admission' | 'preview' | 'draft')[];
  enabled: boolean;
  validUntil: string;
  expectedRevision: number;
}
export interface DshDesktopPublishMandateInput {
  schemaVersion: 1;
  mandateId: string;
  sourceBindingId: string;
  expectedHeadRevision: number;
  workProfile: 'model_text_only_v1';
  scopePolicyConsent: boolean;
  allowedActorProviderIds: readonly string[];
  allowedActions: readonly (
    | 'source.read'
    | 'model.process_source'
    | 'local.draft.create'
    | 'local.draft.revise'
  )[];
  validUntil: string;
  maxInputBytes: number;
  limits: Readonly<{
    maxActiveWorks: number;
    maxDraftRunsPerWork: number;
    maxTokens: number;
    maxCostUsd: string;
    executionDeadline: string;
  }>;
  dataEgressPolicyRef: string;
  followup: Readonly<{ enabled: boolean; observationEndsAt: string }>;
}
export interface DshDesktopState {
  readonly schemaVersion: 1;
  readonly executionQualified: boolean;
  readonly availability: 'unavailable' | 'ready' | 'closing' | 'unknown';
  readonly domain: Readonly<{
    revision: number;
    authorityEpoch: number;
    state: string;
  }> | null;
  readonly modes: readonly Readonly<{
    scopeKind: 'global' | 'tenant' | 'workspace' | 'source_binding' | 'mandate';
    tenantId?: string;
    sourceBindingId: string | null;
    mandateId?: string;
    mode: DshDesktopMode;
    epoch: number;
    revision: number;
    status: 'effective' | 'accepted_pending_owner_fence';
  }>[];
  readonly setups: readonly Readonly<{
    setupId: string;
    tenantId?: string;
    configurationRevision: number;
    candidateRepository: Readonly<{ owner: string; repo: string }>;
    selection: DshDesktopSourceSelection;
    minimumIntervalMs: number;
    mode: 'off' | 'observe';
  }>[];
  readonly sources: readonly Readonly<{
    sourceBindingId: string;
    tenantId?: string;
    configurationRevision: number;
    credentialEpoch: number;
    repository: Readonly<{ repositoryId: string; owner: string; repo: string }>;
    selection: DshDesktopSourceSelection;
    minimumIntervalMs: number;
    mode: DshDesktopMode;
    connection:
      | 'credential_required'
      | 'validating'
      | 'connected'
      | 'unknown'
      | 'closing'
      | 'closed';
    lastScan: Readonly<{
      scanId: string;
      sourceSnapshotAt: string;
      pagination: 'complete' | 'partial' | 'unknown';
      checkpointRevision: number | null;
    }> | null;
  }>[];
  readonly authorizations?: Readonly<{
    budgetAccountId: string | null;
    mandates: readonly Readonly<{
      mandateId: string;
      sourceBindingId: string;
      revision: number;
      headRevision: number;
      status: string;
      validUntil: string;
    }>[];
    egressPolicyState: 'unknown' | 'configured';
    egressPolicies?: readonly Readonly<{
      policyRef: string;
      sourceBindingId: string;
      mandateId: string;
      provider: string;
      modelIds: readonly string[];
      destinationRef: string;
      purposes: readonly ('admission' | 'preview' | 'draft')[];
      enabled: boolean;
      validUntil: string;
      epoch: number;
      revision: number;
    }>[];
  }>;
  readonly lastErrorCode: string | null;
}
export interface DshDesktopApi {
  getState(): Promise<DshDesktopState>;
  setMode(input: DshDesktopSetModeInput): Promise<DshDesktopState>;
  configureSetup(
    input: DshDesktopConfigureSetupInput,
  ): Promise<DshDesktopState>;
  connect(input: DshDesktopConnectInput): Promise<DshDesktopState>;
  disconnect(input: DshDesktopDisconnectInput): Promise<DshDesktopState>;
  reconcile(input: DshDesktopReconcileInput): Promise<DshDesktopState>;
  configureBudget(
    input: DshDesktopConfigureBudgetInput,
  ): Promise<DshDesktopState>;
  publishEgressPolicy(
    input: DshDesktopPublishEgressPolicyInput,
  ): Promise<DshDesktopState>;
  publishMandate(
    input: DshDesktopPublishMandateInput,
  ): Promise<DshDesktopState>;
}
