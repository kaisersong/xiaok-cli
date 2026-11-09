import { captureDispatchBusinessData } from '../conversation-activity/dispatch-business-data.js';
import { canonicalVerificationJson } from '../verification/protocol.js';
import { instantMs, invalid, parseA2Snapshot, parseSourceControl } from './parse.js';
import { hashA2Data, hashEvidenceManifest, hashEvaluationSnapshot, hashMandateProjection, hashPreflightSnapshot, hashSemanticAssessment, timeStates, } from './hash.js';
import type * as T from './types.js';
export { hashA2Data, hashEvidenceManifest, hashEvaluationSnapshot, hashMandateProjection, hashPreflightSnapshot, hashSemanticAssessment, timeStates };
const own = Object.hasOwn;
const axes = [
    'mandate', 'egress', 'privacy', 'readonly'
] as const;
const leafKinds = [
    'source_auth', 'mandate', 'egress', 'readonly'
] as const;
type Failure = Readonly<{
    verdict: 'reject' | 'needs_review';
    reason: T.Reason;
    receipt?: string;
}>;
function failure(reason: T.Reason, verdict: Failure['verdict'] = 'needs_review', receipt?: string): Failure {
    return {
        verdict, reason, receipt
    };
}
function equal(left: unknown, right: unknown): boolean {
    return canonicalVerificationJson(left) === canonicalVerificationJson(right);
}
function contains(list: readonly unknown[], value: unknown): boolean {
    for (let i = 0; i < list.length; i++) {
        if (list[i] === value) {
            return true;
        }
    }
    return false;
}
function identities(snapshot: T.A2SnapshotV1, mandateId: string): readonly T.PrefixIdentity[] {
    const thread = snapshot.input.envelope.thread;
    return [
        {
            kind: 'global'
        },
        {
            kind: 'tenant', tenantId: thread.tenantId
        },
        {
            kind: 'workspace', tenantId: thread.tenantId, workspaceId: thread.workspaceId
        },
        {
            kind: 'sourceBinding', tenantId: thread.tenantId, workspaceId: thread.workspaceId, provider: thread.provider, repositoryId: thread.repositoryId, sourceBindingId: thread.sourceBindingId
        },
        {
            kind: 'mandate', tenantId: thread.tenantId, workspaceId: thread.workspaceId, provider: thread.provider, repositoryId: thread.repositoryId, sourceBindingId: thread.sourceBindingId, mandateId
        },
    ];
}
function identityFailure(snapshot: T.A2SnapshotV1): Failure | null {
    const input = snapshot.input.envelope, thread = input.thread, auth = input.authScope;
    const bad = () => failure('IDENTITY_OR_SCOPE_MISMATCH', 'reject');
    if (thread.tenantId !== auth.tenantId || thread.workspaceId !== auth.workspaceId || thread.repositoryId !== auth.repositoryId) {
        return bad();
    }
    if (input.objectKind === 'issue' && input.objectId !== thread.threadId) {
        return bad();
    }
    if (snapshot.source.state === 'known') {
        const binding = snapshot.source.value.binding;
        if (binding.sourceBindingId !== thread.sourceBindingId || binding.tenantId !== thread.tenantId || binding.workspaceId !== thread.workspaceId || binding.provider !== thread.provider || binding.repositoryId !== thread.repositoryId || !equal(binding.activeAuthScope, auth)) {
            return bad();
        }
    }
    if (snapshot.input.evidence.state === 'known' && !equal(snapshot.input.evidence.value.thread, thread)) {
        return bad();
    }
    if (snapshot.mandate.state === 'known') {
        const mandate = snapshot.mandate.value.document;
        if (mandate.sourceBindingId !== thread.sourceBindingId || mandate.issuedByUserId !== snapshot.principalId) {
            return bad();
        }
        if (snapshot.binding.state === 'known' && snapshot.binding.value.kind !== 'none') {
            const binding = snapshot.binding.value.binding;
            if (!equal(binding.thread, thread)) {
                return bad();
            }
            if (binding.mandateId !== mandate.mandateId) {
                return failure('MANDATE_BINDING_MISMATCH');
            }
        }
        if (snapshot.consumption.state === 'known' && snapshot.consumption.value.kind === 'consumed') {
            const consumed = snapshot.consumption.value;
            if (!equal(consumed.thread, thread) || consumed.inputId !== input.inputId || consumed.mandateId !== mandate.mandateId) {
                return bad();
            }
        }
    }
    return null;
}
function ruleFailure(snapshot: T.A2SnapshotV1): Failure | null {
    if (snapshot.mandate.state !== 'known') {
        return failure('MANDATE_UNAVAILABLE');
    }
    const mandate = snapshot.mandate.value.document, input = snapshot.input.envelope;
    const selection = mandate.selection;
    if ('issueIds' in selection) {
        if (!contains(selection.issueIds, input.thread.threadId)) {
            return failure('OUT_OF_RULE_SCOPE', 'reject');
        }
    }
    else {
        if (snapshot.labels.state !== 'known') {
            return failure('SOURCE_PROOF_UNCONFIRMED');
        }
        const labels = snapshot.labels.value;
        if (labels.repositoryId !== input.thread.repositoryId || labels.threadId !== input.thread.threadId) {
            return failure('IDENTITY_OR_SCOPE_MISMATCH', 'reject');
        }
        let matched = false;
        for (let i = 0; i < selection.labelIds.length; i++) {
            if (contains(labels.labelIds, selection.labelIds[i])) {
                matched = true;
            }
        }
        if (!matched) {
            return failure('OUT_OF_RULE_SCOPE', 'reject');
        }
    }
    if (input.actorEvidence.kind === 'unknown') {
        return failure('TRIGGER_ACTOR_UNPROVEN');
    }
    if (!contains(mandate.allowedActorProviderIds, input.actorEvidence.triggerActorId)) {
        return failure('ACTOR_NOT_WHITELISTED', 'reject');
    }
    return null;
}
function evidenceFailure(snapshot: T.A2SnapshotV1): Failure | null {
    const consumption = snapshot.consumption;
    if (consumption.state !== 'known' || consumption.value.kind === 'pending' || consumption.value.kind === 'unknown') {
        return failure('OWNER_BINDING_UNCONFIRMED');
    }
    const evidence = snapshot.input.evidence;
    if (consumption.value.kind === 'consumed') {
        if (evidence.state !== 'known' || consumption.value.evidenceManifestHash !== evidence.value.manifestHash) {
            return failure('INPUT_CONFLICT');
        }
        return failure('DUPLICATE_INPUT', 'reject', consumption.value.receiptRef);
    }
    const input = snapshot.input.envelope;
    if (input.completeness !== 'complete' || !input.paginationComplete) {
        return failure('SNAPSHOT_INCOMPLETE');
    }
    if (evidence.state !== 'known' || snapshot.source.state !== 'known') {
        return failure('SOURCE_PROOF_UNCONFIRMED');
    }
    const source = snapshot.source.value;
    if (source.credential !== 'active' || source.provenance !== 'verified' || source.actorMapping !== 'verified') {
        return failure('SOURCE_PROOF_UNCONFIRMED');
    }
    if (source.provenanceVersion !== input.provenanceVersion || source.actorMappingVersion !== input.actorMappingVersion || evidence.value.manifestHash !== hashEvidenceManifest(evidence.value)) {
        return failure('INPUT_CONFLICT');
    }
    let inputFound = false;
    for (let i = 0; i < evidence.value.entries.length; i++) {
        const entry = evidence.value.entries[i]!;
        if (entry.inputId === input.inputId) {
            inputFound = entry.objectKind === input.objectKind && entry.objectId === input.objectId && entry.revision === input.providerRevision && entry.contentHash === input.contentHash && entry.provenanceVersion === input.provenanceVersion && entry.actorEvidenceHash === input.actorEvidenceHash && entry.actorMappingVersion === input.actorMappingVersion;
            if (!inputFound) {
                return failure('INPUT_CONFLICT');
            }
        }
        let matched = 0;
        for (let j = 0; j < source.evidenceHeads.length; j++) {
            const head = source.evidenceHeads[j]!;
            if (head.inputId !== entry.inputId) {
                continue;
            }
            matched++;
            if (head.state === 'unconfirmed') {
                return failure('SOURCE_PROOF_UNCONFIRMED');
            }
            if (head.state !== 'current' || head.objectKind !== entry.objectKind || head.objectId !== entry.objectId || head.revision !== entry.revision || head.contentHash !== entry.contentHash || head.provenanceVersion !== entry.provenanceVersion || head.actorEvidenceHash !== entry.actorEvidenceHash || head.actorMappingVersion !== entry.actorMappingVersion) {
                return failure('INPUT_CONFLICT');
            }
        }
        if (matched !== 1) {
            return failure('SOURCE_PROOF_UNCONFIRMED');
        }
    }
    return inputFound ? null : failure('INPUT_CONFLICT');
}
function controlFailure(snapshot: T.A2SnapshotV1): Failure | null {
    if (snapshot.controls.state !== 'known' || snapshot.mandate.state !== 'known' || snapshot.source.state !== 'known' || snapshot.egress.state !== 'known') {
        return failure('BASELINE_UNCONFIRMED');
    }
    const control = snapshot.controls.value, mandate = snapshot.mandate.value, source = snapshot.source.value, egress = snapshot.egress.value;
    const expected = identities(snapshot, mandate.document.mandateId);
    const scopeKeys: string[] = [], modeRefs: {
        scopeKey: string;
        epoch: number;
    }[] = [];
    for (let i = 0; i < 5; i++) {
        const mode = control.prefixModes[i]!;
        const scopeKey = 'dsh-scope-key:' + hashA2Data(['dsh-trusted-control-scope-v1', snapshot.storageScope, expected[i]]);
        scopeKeys[i] = scopeKey;
        modeRefs[i] = {
            scopeKey, epoch: mode.epoch
        };
        if (!equal(mode.identity, expected[i]) || mode.scopeKey !== scopeKey) {
            return failure('IDENTITY_OR_SCOPE_MISMATCH', 'reject');
        }
    }
    for (let i = 0; i < 20; i++) {
        const cell = control.prefixPolicies[i]!, level = (i - i % 4) / 4;
        if (cell.axis !== axes[i % 4] || cell.scopeKey !== scopeKeys[level] || !equal(cell.identity, expected[level])) {
            return failure('IDENTITY_OR_SCOPE_MISMATCH', 'reject');
        }
    }
    const domainIds: string[] = [];
    for (let i = 0; i < mandate.document.ownerDomains.length; i++) {
        domainIds[i] = mandate.document.ownerDomains[i]!.domainId;
    }
    const domainsHash = hashA2Data(['dsh-owner-domains-v1', mandate.document.ownerDomains]);
    if (control.baseline !== 'confirmed' || mandate.document.ownerDomainsHash !== domainsHash || control.ownerDomainsHash !== domainsHash || !equal(control.confirmedOwnerDomains, domainIds)) {
        return failure('BASELINE_UNCONFIRMED');
    }
    for (let i = 0; i < 5; i++) {
        if (control.prefixModes[i]!.mode === 'off') {
            return failure('MODE_OFF', 'reject');
        }
    }
    for (let i = 0; i < 20; i++) {
        if (!control.prefixPolicies[i]!.allowed) {
            return failure(control.prefixPolicies[i]!.axis === 'egress' ? 'EGRESS_DENIED' : 'MANDATE_ACTION_UNAVAILABLE', 'reject');
        }
    }
    if (mandate.workProfile.state !== 'known' || mandate.contentHash === null || mandate.contentHash !== hashMandateProjection(mandate)) {
        return failure('MANDATE_UNAVAILABLE');
    }
    const leafValues: readonly unknown[] = [
        {
            authScope: source.binding.activeAuthScope, sourceBindingVersion: source.binding.version, roleMappingVersion: source.actorMappingVersion, provenanceVersion: source.provenanceVersion, status: source.credential, attestationRef: source.authAttestationRef
        },
        mandate.document,
        {
            policyRef: egress.policyRef, policyHash: egress.policyHash, provider: egress.provider, destinationRef: egress.destinationRef, purposes: egress.purposes, enabled: egress.decision === 'allow'
        },
        mandate.workProfile.value,
    ];
    for (let i = 0; i < 4; i++) {
        const leaf = control.leaves[i]!;
        if (leaf.kind !== leafKinds[i] || leaf.scopeKey !== scopeKeys[i === 0 ? 3 : 4]) {
            return failure('IDENTITY_OR_SCOPE_MISMATCH', 'reject');
        }
        if (leaf.contentHash !== hashA2Data(['dsh-authorization-leaf-v1', leaf.kind, leafValues[i]])) {
            return failure('BASELINE_UNCONFIRMED');
        }
    }
    if (snapshot.freshness.state === 'known' && snapshot.freshness.value.window.prefixModeGuardsHash !== hashA2Data(modeRefs)) {
        return failure('BASELINE_UNCONFIRMED');
    }
    return null;
}
function budgetFailure(snapshot: T.A2SnapshotV1): Failure | null {
    if (snapshot.mandate.state !== 'known') {
        return failure('MANDATE_UNAVAILABLE');
    }
    const mandate = snapshot.mandate.value.document;
    const shadow = forcedShadow(snapshot);
    if (snapshot.assessment !== null && shadow) {
        return null;
    }
    // Reusing a qualified assessment never charges its request budget a second time.
    const fact = snapshot.assessment === null ? snapshot.budget.assessment : snapshot.budget.draft;
    if (fact.state !== 'known') {
        return failure('BUDGET_UNCONFIRMED');
    }
    const value = fact.value;
    if (value.budgetRef !== mandate.budgetRef || value.inputId !== snapshot.input.envelope.inputId || value.mandateId !== mandate.mandateId || value.currency !== mandate.limits.currency || value.purpose !== (snapshot.assessment === null ? snapshot.purpose : 'draft')) {
        return failure('BUDGET_UNCONFIRMED');
    }
    if (value.requiredMaxTokens === 0 || value.requiredMaxCostMinor === 0 || mandate.limits.maxTokens === 0 || mandate.limits.maxCostMinor === 0) {
        return failure('BUDGET_EXHAUSTED', 'reject');
    }
    if (value.remainingTokens < value.requiredMaxTokens || value.remainingCostMinor < value.requiredMaxCostMinor || value.requiredMaxTokens > mandate.limits.maxTokens || value.requiredMaxCostMinor > mandate.limits.maxCostMinor || (!shadow && ((value.remainingActiveWorks === 0 && !(snapshot.binding.state === 'known' && snapshot.binding.value.kind === 'bound')) || mandate.limits.maxActiveWorks === 0 || mandate.limits.maxDraftRunsPerWork === 0))) {
        return failure('BUDGET_EXHAUSTED', 'reject');
    }
    return null;
}
function hardFailure(snapshot: T.A2SnapshotV1): Failure | null {
    const control = controlFailure(snapshot);
    if (control) {
        return control;
    }
    if (snapshot.mandate.state !== 'known') {
        return failure('MANDATE_UNAVAILABLE');
    }
    const mandate = snapshot.mandate.value.document;
    if (mandate.status === 'revoked') {
        return failure('MANDATE_REVOKED', 'reject');
    }
    if (mandate.status === 'expired') {
        return failure('MANDATE_EXPIRED', 'reject');
    }
    const actions = mandate.allowedActions;
    const needed = snapshot.binding.state === 'known' && snapshot.binding.value.kind === 'bound' ? 'local.draft.revise' : 'local.draft.create';
    if (!contains(actions, 'source.read') || !contains(actions, 'model.process_source') || !contains(actions, needed)) {
        return failure('MANDATE_ACTION_UNAVAILABLE', 'reject');
    }
    if (snapshot.input.inputUtf8Bytes > mandate.maxInputBytes) {
        return failure('OUT_OF_RULE_SCOPE', 'reject');
    }
    const time = timeStates(snapshot);
    if (time.clock !== 'verified') {
        return failure('TIME_BASIS_UNCONFIRMED');
    }
    if (time.work === 'unconfirmed' || snapshot.freshness.state === 'known' && snapshot.clock.state === 'verified' && instantMs(snapshot.freshness.value.eventOccurredAt) > snapshot.clock.nowMs) {
        return failure('TIME_BASIS_UNCONFIRMED');
    }
    if (time.mandate === 'closed') {
        return failure('MANDATE_EXPIRED', 'reject');
    }
    if (time.observation === 'closed') {
        return failure('OBSERVATION_WINDOW_CLOSED');
    }
    if (time.work === 'closed') {
        return failure('WORK_DEADLINE_EXCEEDED');
    }
    if (time.assessment === 'closed') {
        return failure('ASSESSMENT_EXPIRED_REVIEW_REQUIRED');
    }
    if (time.authority === 'closed') {
        return failure('AUTHORITY_EXPIRED');
    }
    const budget = budgetFailure(snapshot);
    if (budget) {
        return budget;
    }
    if (snapshot.egress.state !== 'known' || snapshot.egress.value.baseline !== 'confirmed') {
        return failure('EGRESS_UNCONFIRMED');
    }
    const egress = snapshot.egress.value;
    if (egress.policyRef !== mandate.dataEgressPolicyRef || !contains(egress.purposes, snapshot.purpose) || (snapshot.assessment !== null && !forcedShadow(snapshot) && !contains(egress.purposes, 'draft'))) {
        return failure('EGRESS_UNCONFIRMED');
    }
    if (egress.decision !== 'allow') {
        return failure('EGRESS_DENIED', 'reject');
    }
    if (snapshot.freshness.state !== 'known' || snapshot.input.evidence.state !== 'known') {
        return failure('BACKLOG_REQUIRES_REVIEW');
    }
    const fresh = snapshot.freshness.value, input = snapshot.input.envelope;
    if (fresh.inputId !== input.inputId || fresh.evidenceManifestHash !== snapshot.input.evidence.value.manifestHash || fresh.window.sourceBindingId !== input.thread.sourceBindingId || fresh.eventTimeEvidenceRef !== input.providerTimeEvidenceRef || fresh.eventOccurredAt !== input.providerOccurredAt || time.window !== 'fresh') {
        return failure('BACKLOG_REQUIRES_REVIEW');
    }
    return null;
}
function bindingFailure(snapshot: T.A2SnapshotV1): Failure | null {
    if (snapshot.binding.state !== 'known' || snapshot.binding.value.kind === 'reserved') {
        return failure('OWNER_BINDING_UNCONFIRMED');
    }
    const binding = snapshot.binding.value;
    if (binding.kind === 'bound' && (binding.binding.ownerKind !== 'kswarm_dsh' || binding.ownerVersion !== binding.binding.transport.ownerVersion)) {
        return failure('OWNER_BINDING_UNCONFIRMED');
    }
    if (binding.kind === 'bound' && (binding.stopped || binding.terminal || binding.completionReached || binding.generationClosed || binding.workGuard.mode === 'off')) {
        return failure('OWNER_NOT_RESUMABLE');
    }
    return null;
}
function assessmentFailure(snapshot: T.A2SnapshotV1, preflight: boolean, shadow: boolean): Failure | null {
    const assessment = snapshot.assessment;
    if (snapshot.selection.state !== 'known') {
        return failure('ASSESSMENT_SELECTION_UNCONFIRMED');
    }
    if (assessment === null) {
        if (snapshot.selection.value.kind !== 'none') {
            return failure('ASSESSMENT_SELECTION_UNCONFIRMED');
        }
        return preflight ? null : failure('ASSESSMENT_REQUIRED');
    }
    if (assessment.assessmentHash !== hashSemanticAssessment(assessment)) {
        return failure('ASSESSMENT_INVALID');
    }
    if (snapshot.input.evidence.state !== 'known' || assessment.evidenceManifestHash !== snapshot.input.evidence.value.manifestHash || assessment.ruleVersion !== snapshot.modelPolicy.ruleVersion || assessment.modelId !== snapshot.modelPolicy.modelId || assessment.promptVersion !== snapshot.modelPolicy.promptVersion || snapshot.mandate.state !== 'known' || assessment.dataEgressPolicyRef !== snapshot.mandate.value.document.dataEgressPolicyRef) {
        return failure('ASSESSMENT_BINDING_MISMATCH');
    }
    if (!assessment.evidenceRefs.length) {
        return failure('ASSESSMENT_INVALID');
    }
    if (!contains(assessment.evidenceRefs, snapshot.input.envelope.inputId)) {
        return failure('ASSESSMENT_BINDING_MISMATCH');
    }
    for (let i = 0; i < assessment.evidenceRefs.length; i++) {
        let found = false;
        for (let j = 0; j < snapshot.input.evidence.value.entries.length; j++) {
            if (snapshot.input.evidence.value.entries[j]!.inputId === assessment.evidenceRefs[i]) {
                found = true;
            }
        }
        if (!found) {
            return failure('ASSESSMENT_BINDING_MISMATCH');
        }
    }
    if (!shadow && (snapshot.purpose !== 'admission' || assessment.purpose !== 'admission' || !assessment.decisive)) {
        return failure('ASSESSMENT_PREVIEW_ONLY');
    }
    if (assessment.purpose !== snapshot.purpose) {
        return failure('ASSESSMENT_BINDING_MISMATCH');
    }
    if (assessment.decisive) {
        if (snapshot.selection.value.kind !== 'selected') {
            return failure('ASSESSMENT_SELECTION_UNCONFIRMED');
        }
        const selected = snapshot.selection.value.value, mandate = snapshot.mandate.value.document;
        if (selected.inputId !== snapshot.input.envelope.inputId || selected.mandateId !== mandate.mandateId || selected.mandateRevision !== mandate.revision || selected.assessmentId !== assessment.assessmentId || selected.assessmentHash !== assessment.assessmentHash || selected.assessmentVersion !== assessment.assessmentVersion) {
            return failure('ASSESSMENT_SELECTION_UNCONFIRMED');
        }
    }
    return null;
}
function forcedShadow(snapshot: T.A2SnapshotV1): boolean {
    if (snapshot.use === 'shadow') {
        return true;
    }
    if (snapshot.controls.state === 'known') {
        for (let i = 0; i < 5; i++) {
            if (snapshot.controls.value.prefixModes[i]!.mode === 'observe') {
                return true;
            }
        }
    }
    return snapshot.binding.state === 'known' && snapshot.binding.value.kind === 'bound' && snapshot.binding.value.workGuard.mode === 'observe';
}
function firstFailure(snapshot: T.A2SnapshotV1): Failure | null {
    return identityFailure(snapshot) ?? ruleFailure(snapshot) ?? evidenceFailure(snapshot) ?? hardFailure(snapshot) ?? bindingFailure(snapshot);
}
function semanticFailure(snapshot: T.A2SnapshotV1): Failure | null {
    const assessment = snapshot.assessment;
    if (!assessment) {
        return failure('ASSESSMENT_REQUIRED');
    }
    if (assessment.uncertainty !== null) {
        if (assessment.uncertainty === 'QUOTED_REQUEST_ONLY' && assessment.suggestedIntent === 'chat') {
            return failure('QUOTED_REQUEST_ONLY', 'reject');
        }
        return failure(assessment.uncertainty === 'OUT_OF_MANDATE_ACTION' ? 'OUT_OF_MANDATE_ACTION' : 'ASSESSMENT_UNCERTAIN');
    }
    if (assessment.suggestedIntent === 'chat') {
        return failure('NO_ACTIONABLE_REQUEST', 'reject');
    }
    if (assessment.suggestedIntent === 'ambiguous') {
        return failure('AMBIGUOUS_GOAL');
    }
    return null;
}
export function preflightAdmission(value: unknown): T.PreflightResult {
    const snapshot = parseA2Snapshot(value);
    if (snapshot.input.envelope.kind !== 'created' && snapshot.input.envelope.kind !== 'edited') {
        invalid();
    }
    const hash = hashPreflightSnapshot(snapshot), shadow = forcedShadow(snapshot);
    const blocked = firstFailure(snapshot) ?? assessmentFailure(snapshot, true, shadow);
    if (blocked) {
        return captureDispatchBusinessData({
            kind: 'preflight', state: 'blocked', recommendation: blocked.verdict, preflightSnapshotHash: hash, reasonCodes: [blocked.reason]
        }) as T.PreflightResult;
    }
    if (snapshot.assessment !== null) {
        return captureDispatchBusinessData({
            kind: 'preflight', state: 'assessment_available', preflightSnapshotHash: hash, assessmentRef: snapshot.assessment.assessmentId
        }) as T.PreflightResult;
    }
    return captureDispatchBusinessData({
        kind: 'preflight', state: 'assessment_required', preflightSnapshotHash: hash, reasonCodes: ['ASSESSMENT_REQUIRED']
    }) as T.PreflightResult;
}
export function evaluateAdmission(value: unknown): T.AdmissionSuggestion | T.ShadowSuggestion {
    const snapshot = parseA2Snapshot(value);
    if (snapshot.input.envelope.kind !== 'created' && snapshot.input.envelope.kind !== 'edited') {
        invalid();
    }
    const hash = hashEvaluationSnapshot(snapshot), shadow = forcedShadow(snapshot);
    let blocked = firstFailure(snapshot) ?? assessmentFailure(snapshot, false, shadow);
    const qualified = blocked === null;
    if (!blocked) {
        blocked = semanticFailure(snapshot);
    }
    if (shadow) {
        return captureDispatchBusinessData({
            kind: 'shadow_suggestion', semanticClassification: qualified && snapshot.assessment ? snapshot.assessment.suggestedIntent : 'unavailable', reasonCodes: [blocked?.reason ?? 'SHADOW_ONLY'], evaluatedSnapshotHash: hash, assessmentRef: qualified ? snapshot.assessment?.assessmentId ?? null : null
        }) as T.ShadowSuggestion;
    }
    let verdict: T.AdmissionSuggestion['verdict'] = blocked?.verdict ?? 'needs_review';
    let reason: T.Reason = blocked?.reason ?? 'OWNER_BINDING_UNCONFIRMED';
    if (!blocked && snapshot.binding.state === 'known' && snapshot.mandate.state === 'known') {
        if (snapshot.binding.value.kind === 'none' && snapshot.assessment?.suggestedIntent === 'draft_request') {
            verdict = 'accept';
            reason = 'EXPLICIT_DRAFT_REQUEST';
        }
        else if (snapshot.binding.value.kind === 'bound' && snapshot.mandate.value.document.followup.enabled) {
            verdict = 'followup';
            reason = 'ACTIVE_OWNER_INPUT';
        }
    }
    return captureDispatchBusinessData({
        kind: 'admission_suggestion', verdict, reasonCodes: [reason], evaluatedSnapshotHash: hash, assessmentRef: qualified ? snapshot.assessment?.assessmentId ?? null : null, previousReceiptRef: blocked?.receipt ?? null
    }) as T.AdmissionSuggestion;
}
export function classifySourceControl(value: unknown): T.SourceControlResult {
    const data = parseSourceControl(value), input = data.envelope;
    if (input.kind !== 'snapshot' && input.kind !== 'deleted') {
        invalid();
    }
    let disposition: T.SourceControlResult['disposition'] = 'needs_review';
    let reason: T.Reason = 'SOURCE_PROOF_UNCONFIRMED';
    const scopeValid = input.thread.tenantId === input.authScope.tenantId && input.thread.workspaceId === input.authScope.workspaceId && input.thread.repositoryId === input.authScope.repositoryId && (input.objectKind !== 'issue' || input.objectId === input.thread.threadId);
    if (!scopeValid) {
        reason = 'IDENTITY_OR_SCOPE_MISMATCH';
    }
    if (scopeValid && data.controlEvidence.state === 'known') {
        const proof = data.controlEvidence.value;
        if (equal(proof.thread, input.thread) && proof.objectKind === input.objectKind && proof.objectId === input.objectId && proof.providerRevision === input.providerRevision && proof.contentHash === input.contentHash && proof.kind === (input.kind === 'deleted' ? 'verified_deletion' : 'verified_snapshot')) {
            if (input.kind === 'deleted') {
                disposition = 'invalidation_only';
                reason = 'CONTROL_ONLY_INPUT';
            }
            else {
                disposition = 'observed_only';
                reason = input.completeness === 'complete' && input.paginationComplete ? 'SNAPSHOT_NOT_ACTIONABLE' : 'SNAPSHOT_INCOMPLETE';
            }
        }
    }
    return captureDispatchBusinessData({
        kind: 'source_control', inputId: input.inputId, disposition, reasonCodes: [reason]
    }) as T.SourceControlResult;
}
