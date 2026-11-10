/** Original ledger metadata only. None of these DTOs grants a send or work. */
export interface DshBudgetAccountRow {
    readonly account_id: string;
    readonly owner_id: string;
    readonly profile_id: string;
    readonly workspace_id: string;
    readonly tenant_id: string;
    readonly mandate_id: string;
    readonly mandate_revision: number;
    readonly authorization_epoch: number;
    readonly authority_hash: string;
    readonly currency: 'USD';
    readonly scale: 6;
    readonly token_limit: number;
    readonly cost_limit: number;
    readonly spent_tokens: number;
    readonly held_tokens: number;
    readonly spent_cost: number;
    readonly held_cost: number;
    readonly revision: number;
    readonly status: 'active' | 'closed';
    readonly close_reason: string | null;
    readonly valid_until: number;
}
export interface DshBudgetOperationRow {
    readonly account_id: string;
    readonly operation_key: string;
    readonly purpose: 'assessment' | 'preview' | 'draft';
    readonly input_id: string;
    readonly evidence_hash: string;
    readonly semantic_hash: string;
    readonly thread_hash: string;
    readonly work_id: string | null;
    readonly max_attempts: number;
    readonly deadline: number;
    readonly payload_hash: string;
}
export interface DshBudgetAttemptRow {
    readonly account_id: string;
    readonly operation_key: string;
    readonly attempt_sequence: number;
    readonly attempt_id: string;
    readonly body_hash: string;
    readonly provider_id: string;
    readonly model_id: string;
    readonly model_profile_id: string;
    readonly pricing_hash: string;
    readonly max_input_tokens: number;
    readonly max_output_tokens: number;
    readonly max_tokens: number;
    readonly max_cost: number;
    readonly tool_rounds: 0;
    readonly payload_hash: string;
    readonly state: 'prepared' | 'pre_send' | 'sent' | 'unknown' | 'settled' | 'not_sent';
    readonly actual_tokens: number | null;
    readonly actual_cost: number | null;
    readonly usage_receipt_hash: string | null;
    readonly settlement_hash: string | null;
    readonly settlement_revision: number;
    readonly cost_basis?:'actual'|'conservative_upper_bound';
}
export interface DshCostAccountingReceipt {
    readonly accountId:string;readonly operationKey:string;readonly attemptId:string;readonly sequence:number;
    readonly basis:'conservative_upper_bound';readonly actualTokens:number;readonly chargedCostUpperBoundMicros:number;
    readonly pricingHash:string;readonly usageReceiptHash:string;readonly settlementRevision:number;
}
export interface DshBudgetWorkSnapshotView {
    readonly schemaVersion:1;readonly kind:'work_snapshot';readonly accountId:string;readonly state:'not_observed'|'observed';
    readonly reservation:Readonly<Record<string,unknown>>|null;readonly head:Readonly<Record<string,unknown>>|null;
    readonly attestation:Readonly<Record<string,unknown>>|null;readonly commandReceipt:Readonly<Record<string,unknown>>|null;
    readonly closureBasis:Readonly<{commandReceiptsHash:string;usageHash:string}>|null;
    readonly status:DshBudgetStatus;
}
export interface DshBudgetStatus {
    readonly account: DshBudgetAccountRow;
    readonly operations: readonly DshBudgetOperationRow[];
    readonly attempts: readonly DshBudgetAttemptRow[];
    readonly costAccountingReceipts?:readonly DshCostAccountingReceipt[];
    readonly workCapacity?:Readonly<{maxActiveWorks:number;maxDraftRequestsPerWork:number;activeWorks:number}>|null;
}
export interface DshBudgetObservationView {
    readonly schemaVersion: 1;
    readonly kind: 'ledger_observation';
    readonly ownerId: string;
    readonly ownerEpoch: number;
    readonly profileId: string;
    readonly workspaceId: string;
    readonly status: DshBudgetStatus;
}
export interface DshBudgetAttemptReceiptView {
    readonly schemaVersion: 1;
    readonly kind: 'workless_attempt_receipt';
    readonly ownerId: string;
    readonly ownerEpoch: number;
    readonly profileId: string;
    readonly workspaceId: string;
    readonly accountId: string;
    readonly operationKey: string;
    readonly attemptId: string;
    readonly sequence: number;
    readonly disposition: 'newly_reserved' | 'existing';
    readonly status: DshBudgetStatus;
}
export interface DshDraftBudgetData {
    readonly reservationId:string;readonly issuerDomain:string;readonly mandateId:string;readonly mandateRevision:number;readonly authorizationEpoch:number;
    readonly scope:Readonly<{profileId:string;workspaceId:string}>;
    readonly thread:Readonly<{tenantId:string;workspaceId:string;sourceBindingId:string;provider:'github';repositoryId:string;kind:'issue';threadId:string}>;
    readonly operationKey:string;readonly semanticPayloadHash:string;readonly assessmentRef:string;readonly purpose:'draft_admission'|'draft_prepare';readonly state:'reserved';
}
export interface DshBudgetWorkReceiptView {
    readonly schemaVersion:1;readonly kind:'work_reservation_receipt';readonly ownerId:string;readonly ownerEpoch:number;
    readonly disposition:'newly_reserved'|'existing';readonly reservation:Readonly<Record<string,unknown>>;readonly head:Readonly<Record<string,unknown>>;readonly attestation:Readonly<Record<string,unknown>>;
    readonly data:DshDraftBudgetData;readonly status:DshBudgetStatus;
}
export interface OriginalDshBudgetPort {
    configureWorkPolicy(input:unknown,proof:object):Promise<unknown>;
    syncWorkPolicy(input:unknown,proof:object):Promise<unknown>;
    reserveDraftAdmission(input:unknown,proof:object):Promise<object>;
    bindDraftWork(input:unknown,proof:object):Promise<unknown>;
    closeWork(input:unknown,proof:object):Promise<unknown>;
    observe(input: unknown, proof: object): Promise<object>;
    observeWork(input:unknown,proof:object):Promise<object>;
    finalizeDraftUsage(input:unknown,proof:object):Promise<object>;
    reserveAttempt(input: unknown, proof: object): Promise<object>;
    reserveDraftAttempt(input:unknown,proof:object):Promise<object>;
    markPreSend(input:unknown,proof:object):Promise<unknown>;
    markSent(input:unknown,proof:object):Promise<unknown>;
    markUnknown(input:unknown,proof:object):Promise<unknown>;
    settleConservative(input:unknown,proof:object):Promise<unknown>;
}

export interface DshBudgetCommitProof {
 readonly proofId:string;readonly budgetOwnerId:string;readonly reservationRef:string;readonly operationKey:string;
 readonly ownerWorkId:string;readonly bindingId:string;readonly inputManifestHash:string;readonly finalizedUsageRevision:number;
 readonly validUntil:string;readonly receiptDigest:string;readonly chargedBasis:'actual'|'conservative_upper_bound';readonly ledgerRevision:number;
}
export interface DshBudgetCommitProofView {readonly issuerDomain:string;readonly proof:DshBudgetCommitProof}

export type DshBudgetDraftAttemptReceiptView=Omit<DshBudgetAttemptReceiptView,'kind'>&Readonly<{kind:'draft_attempt_receipt'}>;
