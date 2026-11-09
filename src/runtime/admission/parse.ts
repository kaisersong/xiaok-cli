import { captureDispatchBusinessData } from '../conversation-activity/dispatch-business-data.js';
import type * as T from './types.js';
const own = Object.hasOwn, keys = Reflect.ownKeys, isArray = Array.isArray, integer = Number.isSafeInteger, is = Object.is;
const charCode = String.prototype.charCodeAt, slice = String.prototype.slice;
const apply = Reflect.apply, exec = RegExp.prototype.exec, NativeError = Error, NativeDate = Date, dateParse = Date.parse, dateString = Date.prototype.toISOString;
export function invalid(): never {
    throw new NativeError('A2_CONTRACT_INVALID');
}
type RecordData = Record<string, unknown>;
type Check = (value: unknown) => void;
function has(list: readonly unknown[], value: unknown): boolean {
    for (let i = 0; i < list.length; i++) {
        if (list[i] === value) {
            return true;
        }
    }
    return false;
}
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is RecordData {
    if (!value || typeof value !== 'object' || isArray(value)) {
        invalid();
    }
    const names = keys(value);
    if (names.length < required.length || names.length > required.length + optional.length) {
        invalid();
    }
    for (let i = 0; i < required.length; i++) {
        if (!own(value, required[i]!)) {
            invalid();
        }
    }
    for (let i = 0; i < names.length; i++) {
        if (typeof names[i] !== 'string' || !has(required, names[i]) && !has(optional, names[i])) {
            invalid();
        }
    }
}
function matches(pattern: RegExp, value: string): boolean {
    return apply(exec, pattern, [value]) !== null;
}
function unicode(value: string): void {
    for (let i = 0; i < value.length; i++) {
        const code = apply(charCode, value, [i]) as number;
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = apply(charCode, value, [++i]) as number;
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                invalid();
            }
        }
        else if (code >= 0xdc00 && code <= 0xdfff) {
            invalid();
        }
    }
}
function text(value: unknown, empty = false): asserts value is string {
    if (typeof value !== 'string' || value.length > 2048 || !empty && !value.length || matches(/\x00/, value)) {
        invalid();
    }
    unicode(value);
}
function id(value: unknown): asserts value is string {
    text(value);
    if (matches(/[\x00-\x1f\x7f]/, value)) {
        invalid();
    }
}
function hash(value: unknown): void {
    if (typeof value !== 'string' || !matches(/^[a-f0-9]{64}$/, value)) {
        invalid();
    }
}
function count(value: unknown): asserts value is number {
    if (typeof value !== 'number' || !integer(value) || value < 0 || is(value, -0)) {
        invalid();
    }
}
function revision(value: unknown): void {
    count(value);
    if (value < 1) {
        invalid();
    }
}
function bool(value: unknown): void {
    if (typeof value !== 'boolean') {
        invalid();
    }
}
function literal(value: unknown, values: readonly unknown[]): void {
    if (!has(values, value)) {
        invalid();
    }
}
function nullable(value: unknown, check: Check): void {
    if (value !== null) {
        check(value);
    }
}
function list(value: unknown, check: Check, max = 4096): asserts value is unknown[] {
    if (!isArray(value) || value.length > max) {
        invalid();
    }
    for (let i = 0; i < value.length; i++) {
        check(value[i]);
    }
}
function ids(value: unknown): void {
    list(value, id);
    for (let i = 1; i < value.length; i++) {
        if ((value[i - 1] as string) >= (value[i] as string)) {
            invalid();
        }
    }
}
export function instantMs(value: string): number {
    if (!matches(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/, value)) {
        invalid();
    }
    const ms = dateParse(value);
    count(ms);
    if (ms > 253402300799999) {
        invalid();
    }
    const canonical = apply(dateString, new NativeDate(ms), []) as string;
    if (value.length === 20 ? canonical !== (apply(slice, value, [0, 19]) as string) + '.000Z' : canonical !== value) {
        invalid();
    }
    return ms;
}
function instant(value: unknown): void {
    if (typeof value !== 'string') {
        invalid();
    }
    instantMs(value);
}
function fact(value: unknown, check: Check): void {
    if (!value || typeof value !== 'object') {
        invalid();
    }
    const state = (value as RecordData).state;
    if (state === 'known') {
        fields(value, ['state', 'value']);
        check(value.value);
    }
    else {
        fields(value, ['state', 'reason']);
        literal(value.state, ['unknown']);
        literal(value.reason, [
            'producer_unavailable', 'missing', 'pending', 'inconsistent'
        ]);
    }
}
function strings(value: RecordData, names: readonly string[], check: Check = id): void {
    for (let i = 0; i < names.length; i++) {
        check(value[names[i]!]);
    }
}
function thread(value: unknown): void {
    fields(value, [
        'sourceBindingId', 'tenantId', 'workspaceId', 'provider', 'repositoryId', 'kind', 'threadId'
    ]);
    strings(value, keys(value) as string[]);
    literal(value.provider, ['github']);
    literal(value.kind, ['issue']);
}
function auth(value: unknown): void {
    fields(value, [
        'tenantId', 'workspaceId', 'connectionId', 'providerAccountId', 'repositoryId', 'credentialEpoch'
    ]);
    strings(value, [
        'tenantId', 'workspaceId', 'connectionId', 'providerAccountId', 'repositoryId'
    ]);
    revision(value.credentialEpoch);
}
function actor(value: unknown): void {
    if (!value || typeof value !== 'object') {
        invalid();
    }
    const kind = (value as RecordData).kind;
    if (kind === 'verified_event') {
        fields(value, ['kind', 'eventRef', 'triggerActorId']);
        id(value.eventRef);
        id(value.triggerActorId);
    }
    else if (kind === 'verified_audit') {
        fields(value, ['kind', 'auditRef', 'triggerActorId']);
        id(value.auditRef);
        id(value.triggerActorId);
    }
    else {
        fields(value, ['kind', 'reason']);
        literal(value.kind, ['unknown']);
        text(value.reason);
    }
}
function envelope(value: unknown): void {
    fields(value, [
        'schemaVersion', 'inputId', 'thread', 'authScope', 'providerEventId', 'objectKind', 'objectId', 'providerRevision', 'contentHash', 'receivedAt', 'objectAuthorId', 'actorEvidence', 'actorMappingVersion', 'provenanceVersion', 'actorEvidenceHash', 'kind', 'trust', 'snapshotRef', 'completeness', 'paginationComplete', 'authorizationCheckedAt'
    ], ['providerOccurredAt', 'providerTimeEvidenceRef']);
    literal(value.schemaVersion, [1]);
    thread(value.thread);
    auth(value.authScope);
    actor(value.actorEvidence);
    strings(value, [
        'inputId', 'objectId', 'providerRevision', 'snapshotRef'
    ]);
    nullable(value.providerEventId, id);
    nullable(value.objectAuthorId, id);
    hash(value.contentHash);
    hash(value.actorEvidenceHash);
    instant(value.receivedAt);
    instant(value.authorizationCheckedAt);
    revision(value.actorMappingVersion);
    revision(value.provenanceVersion);
    literal(value.objectKind, ['issue', 'comment']);
    literal(value.kind, [
        'created', 'edited', 'deleted', 'snapshot'
    ]);
    literal(value.trust, ['external_untrusted']);
    literal(value.completeness, ['complete', 'partial', 'unknown']);
    bool(value.paginationComplete);
    if (own(value, 'providerOccurredAt')) {
        instant(value.providerOccurredAt);
    }
    if (own(value, 'providerTimeEvidenceRef')) {
        id(value.providerTimeEvidenceRef);
    }
}
function entry(value: unknown): void {
    fields(value, [
        'inputId', 'objectKind', 'objectId', 'revision', 'contentHash', 'provenanceVersion', 'actorEvidenceHash', 'actorMappingVersion'
    ]);
    strings(value, ['inputId', 'objectId', 'revision']);
    literal(value.objectKind, ['issue', 'comment']);
    hash(value.contentHash);
    hash(value.actorEvidenceHash);
    revision(value.provenanceVersion);
    revision(value.actorMappingVersion);
}
function evidence(value: unknown): void {
    fields(value, [
        'schemaVersion', 'thread', 'entries', 'sourceSnapshotAt', 'manifestHash'
    ]);
    literal(value.schemaVersion, [1]);
    thread(value.thread);
    list(value.entries, entry, 1024);
    if (!value.entries.length) {
        invalid();
    }
    instant(value.sourceSnapshotAt);
    hash(value.manifestHash);
    for (let i = 1; i < value.entries.length; i++) {
        if (((value.entries[i - 1] as RecordData).inputId as string) >= ((value.entries[i] as RecordData).inputId as string)) {
            invalid();
        }
    }
}
function sourceBinding(value: unknown): void {
    fields(value, [
        'sourceBindingId', 'tenantId', 'workspaceId', 'provider', 'repositoryId', 'activeAuthScope', 'version'
    ]);
    strings(value, [
        'sourceBindingId', 'tenantId', 'workspaceId', 'repositoryId'
    ]);
    literal(value.provider, ['github']);
    auth(value.activeAuthScope);
    revision(value.version);
}
function source(value: unknown): void {
    fields(value, [
        'binding', 'credential', 'credentialRevision', 'authAttestationRef', 'provenance', 'provenanceVersion', 'actorMapping', 'actorMappingVersion', 'evidenceHeads'
    ]);
    sourceBinding(value.binding);
    literal(value.credential, ['active', 'revoked']);
    revision(value.credentialRevision);
    id(value.authAttestationRef);
    literal(value.provenance, ['verified', 'unproven', 'revoked']);
    literal(value.actorMapping, ['verified', 'unproven']);
    revision(value.provenanceVersion);
    revision(value.actorMappingVersion);
    list(value.evidenceHeads, head => {
        fields(head, [
            'inputId', 'objectKind', 'objectId', 'revision', 'contentHash', 'provenanceVersion', 'actorEvidenceHash', 'actorMappingVersion', 'headHash', 'proofHash', 'state'
        ]);
        strings(head, ['inputId', 'objectId', 'revision']);
        literal(head.objectKind, ['issue', 'comment']);
        strings(head, [
            'contentHash', 'actorEvidenceHash', 'headHash', 'proofHash'
        ], hash);
        revision(head.provenanceVersion);
        revision(head.actorMappingVersion);
        literal(head.state, [
            'current', 'superseded', 'deleted', 'conflict', 'unconfirmed'
        ]);
    }, 1024);
}
function domains(value: unknown): void {
    list(value, row => {
        fields(row, ['domainId', 'kind']);
        id(row.domainId);
        literal(row.kind, ['work', 'egress_gate', 'active_pointer']);
    }, 64);
    for (let i = 1; i < value.length; i++) {
        if (((value[i - 1] as RecordData).domainId as string) >= ((value[i] as RecordData).domainId as string)) {
            invalid();
        }
    }
}
function mandateDocument(value: unknown): void {
    fields(value, [
        'schemaVersion', 'mandateId', 'sourceBindingId', 'revision', 'authorizationEpoch', 'status', 'issuedByUserId', 'allowedActorProviderIds', 'allowedActions', 'ruleVersion', 'selection', 'validUntil', 'maxInputBytes', 'budgetRef', 'limits', 'dataEgressPolicyRef', 'ownerDomains', 'ownerDomainsHash', 'followup'
    ]);
    literal(value.schemaVersion, [1]);
    strings(value, [
        'mandateId', 'sourceBindingId', 'issuedByUserId', 'budgetRef', 'dataEgressPolicyRef'
    ]);
    revision(value.revision);
    revision(value.authorizationEpoch);
    literal(value.status, ['active', 'revoked', 'expired']);
    ids(value.allowedActorProviderIds);
    list(value.allowedActions, action => literal(action, [
        'source.read', 'model.process_source', 'local.draft.create', 'local.draft.revise'
    ]));
    for (let i = 1; i < value.allowedActions.length; i++) {
        if ((value.allowedActions[i - 1] as string) >= (value.allowedActions[i] as string)) {
            invalid();
        }
    }
    literal(value.ruleVersion, ['github_issue_draft_v1']);
    if (value.selection && typeof value.selection === 'object' && own(value.selection, 'issueIds')) {
        fields(value.selection, ['issueIds']);
        ids(value.selection.issueIds);
    }
    else {
        fields(value.selection, ['labelIds']);
        ids(value.selection.labelIds);
    }
    instant(value.validUntil);
    count(value.maxInputBytes);
    fields(value.limits, [
        'maxActiveWorks', 'maxDraftRunsPerWork', 'maxTokens', 'maxCostMinor', 'currency', 'executionDeadline'
    ]);
    strings(value.limits, [
        'maxActiveWorks', 'maxDraftRunsPerWork', 'maxTokens', 'maxCostMinor'
    ], count);
    id(value.limits.currency);
    instant(value.limits.executionDeadline);
    domains(value.ownerDomains);
    hash(value.ownerDomainsHash);
    fields(value.followup, [
        'enabled', 'observationEndsAt', 'completionPredicate', 'resumeAfterCompletion'
    ]);
    bool(value.followup.enabled);
    instant(value.followup.observationEndsAt);
    literal(value.followup.completionPredicate, ['draft_ready']);
    literal(value.followup.resumeAfterCompletion, [false]);
}
function profile(value: unknown): void {
    fields(value, [
        'executionProfile', 'schemaVersion', 'snapshotHash', 'snapshotPolicyDigest', 'approvalRef'
    ]);
    if (value.executionProfile === 'model_text_only_v1') {
        literal(value.schemaVersion, [1]);
        literal(value.snapshotHash, [null]);
        literal(value.snapshotPolicyDigest, [null]);
        literal(value.approvalRef, [null]);
    }
    else {
        literal(value.executionProfile, ['dsh_readonly_v1']);
        literal(value.schemaVersion, [2]);
        hash(value.snapshotHash);
        hash(value.snapshotPolicyDigest);
        id(value.approvalRef);
    }
}
function mandate(value: unknown): void {
    fields(value, [
        'document', 'assessmentProfile', 'workProfile', 'contentHash'
    ]);
    mandateDocument(value.document);
    literal(value.assessmentProfile, ['model_text_only_v1']);
    fact(value.workProfile, profile);
    nullable(value.contentHash, hash);
}
function identity(value: unknown): void {
    if (!value || typeof value !== 'object') {
        invalid();
    }
    const kind = (value as RecordData).kind;
    let expected: string[];
    if (kind === 'global') {
        expected = ['kind'];
    }
    else if (kind === 'tenant') {
        expected = ['kind', 'tenantId'];
    }
    else if (kind === 'workspace') {
        expected = ['kind', 'tenantId', 'workspaceId'];
    }
    else if (kind === 'sourceBinding' || kind === 'mandate') {
        expected = kind === 'mandate' ? [
            'kind', 'tenantId', 'workspaceId', 'provider', 'repositoryId', 'sourceBindingId', 'mandateId'
        ] : [
            'kind', 'tenantId', 'workspaceId', 'provider', 'repositoryId', 'sourceBindingId'
        ];
    }
    else {
        invalid();
    }
    fields(value, expected);
    strings(value, expected);
    if (own(value, 'provider')) {
        literal(value.provider, ['github']);
    }
}
function modeCell(value: unknown): void {
    fields(value, [
        'identity', 'scopeKey', 'epoch', 'revision', 'mode'
    ]);
    identity(value.identity);
    id(value.scopeKey);
    revision(value.epoch);
    revision(value.revision);
    literal(value.mode, ['off', 'observe', 'auto_draft']);
}
function controls(value: unknown): void {
    fields(value, [
        'prefixModes', 'prefixPolicies', 'leaves', 'confirmedOwnerDomains', 'ownerDomainsHash', 'baseline'
    ]);
    list(value.prefixModes, modeCell, 5);
    if (value.prefixModes.length !== 5) {
        invalid();
    }
    list(value.prefixPolicies, row => {
        fields(row, [
            'identity', 'scopeKey', 'axis', 'epoch', 'revision', 'allowed'
        ]);
        identity(row.identity);
        id(row.scopeKey);
        literal(row.axis, [
            'mandate', 'egress', 'privacy', 'readonly'
        ]);
        revision(row.epoch);
        revision(row.revision);
        bool(row.allowed);
    }, 20);
    if (value.prefixPolicies.length !== 20) {
        invalid();
    }
    list(value.leaves, row => {
        fields(row, [
            'kind', 'scopeKey', 'epoch', 'revision', 'contentHash'
        ]);
        literal(row.kind, [
            'source_auth', 'mandate', 'egress', 'readonly'
        ]);
        id(row.scopeKey);
        revision(row.epoch);
        revision(row.revision);
        hash(row.contentHash);
    }, 4);
    if (value.leaves.length !== 4) {
        invalid();
    }
    ids(value.confirmedOwnerDomains);
    hash(value.ownerDomainsHash);
    literal(value.baseline, ['confirmed', 'pending', 'missing']);
}
function headroom(value: unknown): void {
    fields(value, [
        'budgetRef', 'inputId', 'mandateId', 'purpose', 'scopeRevision', 'budgetPolicyVersion', 'requirementHash', 'remainingTokens', 'remainingCostMinor', 'requiredMaxTokens', 'requiredMaxCostMinor', 'currency', 'remainingActiveWorks'
    ]);
    strings(value, [
        'budgetRef', 'inputId', 'mandateId', 'budgetPolicyVersion', 'currency'
    ]);
    hash(value.requirementHash);
    revision(value.scopeRevision);
    literal(value.purpose, ['admission', 'preview', 'draft']);
    strings(value, [
        'remainingTokens', 'remainingCostMinor', 'requiredMaxTokens', 'requiredMaxCostMinor', 'remainingActiveWorks'
    ], count);
}
function egress(value: unknown): void {
    fields(value, [
        'policyRef', 'revision', 'epoch', 'policyHash', 'provider', 'destinationRef', 'purposes', 'executionProfile', 'decision', 'baseline'
    ]);
    strings(value, ['policyRef', 'provider', 'destinationRef']);
    revision(value.revision);
    revision(value.epoch);
    hash(value.policyHash);
    list(value.purposes, v => literal(v, ['admission', 'preview', 'draft']));
    literal(value.executionProfile, ['model_text_only_v1']);
    literal(value.decision, ['allow', 'deny']);
    literal(value.baseline, ['confirmed', 'pending', 'missing']);
}
function workGuard(value: unknown): void {
    fields(value, [
        'scopeKey', 'epoch', 'revision', 'mode'
    ]);
    id(value.scopeKey);
    revision(value.epoch);
    revision(value.revision);
    literal(value.mode, ['off', 'observe', 'auto_draft']);
}
function binding(value: unknown): void {
    if (!value || typeof value !== 'object') {
        invalid();
    }
    const kind = (value as RecordData).kind;
    if (kind === 'none') {
        fields(value, ['kind']);
        return;
    }
    if (kind === 'reserved') {
        fields(value, ['kind', 'binding']);
    }
    else {
        literal(kind, ['bound']);
        fields(value, [
            'kind', 'binding', 'ownerVersion', 'inputSetRevision', 'stopped', 'terminal', 'completionReached', 'generationClosed', 'workGuard'
        ]);
        revision(value.ownerVersion);
        revision(value.inputSetRevision);
        strings(value, [
            'stopped', 'terminal', 'completionReached', 'generationClosed'
        ], bool);
        workGuard(value.workGuard);
    }
    const b = (value as RecordData).binding;
    fields(b, [
        'bindingId', 'mandateId', 'thread', 'generation', 'ownerKind', 'version', 'transport'
    ]);
    strings(b, ['bindingId', 'mandateId', 'ownerKind']);
    thread(b.thread);
    literal(b.generation, [1]);
    revision(b.version);
    if (kind === 'reserved') {
        fields(b.transport, [
            'kind', 'createOperationKey', 'createCommandId', 'canonicalInitialInputId', 'canonicalCreateManifestHash'
        ]);
        literal(b.transport.kind, ['reserved']);
        strings(b.transport, ['createOperationKey', 'createCommandId', 'canonicalInitialInputId']);
        hash(b.transport.canonicalCreateManifestHash);
    }
    else {
        fields(b.transport, [
            'kind', 'ownerWorkId', 'ownerVersion', 'workCreatedAt', 'workExecutionDeadline'
        ]);
        literal(b.transport.kind, ['bound']);
        id(b.transport.ownerWorkId);
        revision(b.transport.ownerVersion);
        instant(b.transport.workCreatedAt);
        instant(b.transport.workExecutionDeadline);
    }
}
function consumption(value: unknown): void {
    if (!value || typeof value !== 'object') {
        invalid();
    }
    const kind = (value as RecordData).kind;
    if (kind !== 'consumed') {
        fields(value, ['kind']);
        literal(kind, ['none', 'pending', 'unknown']);
        return;
    }
    fields(value, [
        'kind', 'thread', 'inputId', 'evidenceManifestHash', 'mandateId', 'bindingId', 'ownerWorkId', 'ownerVersion', 'inputSetRevision', 'operationKey', 'semanticPayloadHash', 'receiptRef'
    ]);
    thread(value.thread);
    strings(value, [
        'inputId', 'mandateId', 'bindingId', 'ownerWorkId', 'operationKey', 'receiptRef'
    ]);
    hash(value.evidenceManifestHash);
    hash(value.semanticPayloadHash);
    revision(value.ownerVersion);
    revision(value.inputSetRevision);
}
function selection(value: unknown): void {
    if (!value || typeof value !== 'object') {
        invalid();
    }
    if ((value as RecordData).kind === 'none') {
        fields(value, ['kind']);
        return;
    }
    fields(value, ['kind', 'value']);
    literal(value.kind, ['selected']);
    fields(value.value, [
        'inputId', 'mandateId', 'mandateRevision', 'assessmentVersion', 'assessmentId', 'assessmentHash'
    ]);
    strings(value.value, ['inputId', 'mandateId', 'assessmentId']);
    revision(value.value.mandateRevision);
    literal(value.value.assessmentVersion, [1, 2]);
    hash(value.value.assessmentHash);
}
function semantic(value: unknown): void {
    fields(value, [
        'assessmentId', 'evidenceManifestHash', 'ruleVersion', 'modelId', 'promptVersion', 'dataEgressPolicyRef', 'validUntil', 'assessmentHash', 'assessmentVersion', 'purpose', 'decisive', 'suggestedIntent', 'evidenceRefs', 'uncertainty'
    ]);
    strings(value, [
        'assessmentId', 'ruleVersion', 'modelId', 'promptVersion', 'dataEgressPolicyRef'
    ]);
    hash(value.evidenceManifestHash);
    hash(value.assessmentHash);
    instant(value.validUntil);
    literal(value.assessmentVersion, [1, 2]);
    literal(value.purpose, ['admission', 'preview']);
    bool(value.decisive);
    literal(value.suggestedIntent, [
        'draft_request', 'followup', 'chat', 'ambiguous'
    ]);
    ids(value.evidenceRefs);
    nullable(value.uncertainty, v => text(v, true));
}
function freshness(value: unknown): void {
    fields(value, [
        'window', 'inputId', 'evidenceManifestHash', 'eventTimeEvidenceRef', 'eventOccurredAt', 'attestationRef', 'state'
    ]);
    strings(value, ['inputId', 'eventTimeEvidenceRef', 'attestationRef']);
    hash(value.evidenceManifestHash);
    instant(value.eventOccurredAt);
    literal(value.state, ['fresh', 'backlog', 'unproven']);
    fields(value.window, [
        'windowId', 'sourceBindingId', 'prefixModeGuardsHash', 'admissionGrantHash', 'effectiveAt', 'baselineCheckpointRef', 'providerTimeBasisProofRef', 'freshnessPolicyVersion'
    ]);
    strings(value.window, [
        'windowId', 'sourceBindingId', 'baselineCheckpointRef', 'providerTimeBasisProofRef'
    ]);
    hash(value.window.prefixModeGuardsHash);
    hash(value.window.admissionGrantHash);
    instant(value.window.effectiveAt);
    literal(value.window.freshnessPolicyVersion, [1]);
}
function snapshot(value: unknown): void {
    fields(value, [
        'schemaVersion', 'policyVersion', 'use', 'purpose', 'storageScope', 'principalId', 'input', 'source', 'labels', 'mandate', 'controls', 'budget', 'egress', 'binding', 'consumption', 'selection', 'assessment', 'freshness', 'modelPolicy', 'clock'
    ]);
    literal(value.schemaVersion, [1]);
    literal(value.policyVersion, ['github_issue_draft_v1/a2-evaluator-v1']);
    literal(value.use, ['admission', 'shadow']);
    literal(value.purpose, ['admission', 'preview']);
    id(value.principalId);
    fields(value.storageScope, ['profileId', 'workspaceId']);
    hash(value.storageScope.profileId);
    hash(value.storageScope.workspaceId);
    fields(value.input, ['envelope', 'inputUtf8Bytes', 'evidence']);
    envelope(value.input.envelope);
    count(value.input.inputUtf8Bytes);
    fact(value.input.evidence, evidence);
    fact(value.source, source);
    fact(value.labels, v => {
        fields(v, [
            'repositoryId', 'threadId', 'revision', 'labelIds'
        ]);
        id(v.repositoryId);
        id(v.threadId);
        revision(v.revision);
        ids(v.labelIds);
    });
    fact(value.mandate, mandate);
    fact(value.controls, controls);
    fields(value.budget, ['assessment', 'draft']);
    fact(value.budget.assessment, headroom);
    fact(value.budget.draft, headroom);
    fact(value.egress, egress);
    fact(value.binding, binding);
    fact(value.consumption, consumption);
    fact(value.selection, selection);
    nullable(value.assessment, semantic);
    fact(value.freshness, freshness);
    fields(value.modelPolicy, [
        'modelId', 'promptVersion', 'ruleVersion', 'assessmentProfile', 'negativeHintPolicy'
    ]);
    id(value.modelPolicy.modelId);
    id(value.modelPolicy.promptVersion);
    literal(value.modelPolicy.ruleVersion, ['github_issue_draft_v1']);
    literal(value.modelPolicy.assessmentProfile, ['model_text_only_v1']);
    literal(value.modelPolicy.negativeHintPolicy, ['uncertainty-negative-v1']);
    if (value.clock && typeof value.clock === 'object' && (value.clock as RecordData).state === 'verified') {
        fields(value.clock, [
            'state', 'domainId', 'qualificationEpoch', 'nowMs'
        ]);
        id(value.clock.domainId);
        revision(value.clock.qualificationEpoch);
        count(value.clock.nowMs);
        if (value.clock.nowMs > 253402300799999) {
            invalid();
        }
    }
    else {
        fields(value.clock, ['state']);
        literal(value.clock.state, ['unverified', 'rollback_detected']);
    }
}
function captured(raw: unknown): unknown {
    try {
        return captureDispatchBusinessData(raw);
    }
    catch {
        invalid();
    }
}
/** Data rejection never observes or declares SDK tails drained. */
export function parseA2Snapshot(raw: unknown): T.A2SnapshotV1 {
    const data = captured(raw);
    snapshot(data);
    return data as T.A2SnapshotV1;
}
export function parseEvidenceManifest(raw: unknown): T.FrozenEvidenceManifest {
    const data = captured(raw);
    evidence(data);
    return data as T.FrozenEvidenceManifest;
}
export function parseMandateProjection(raw: unknown): T.A2MandateProjectionV1 {
    const data = captured(raw);
    mandate(data);
    return data as T.A2MandateProjectionV1;
}
export function parseSemanticAssessment(raw: unknown): T.FrozenSemanticAssessment {
    const data = captured(raw);
    semantic(data);
    return data as T.FrozenSemanticAssessment;
}
export function parseSourceControl(raw: unknown): T.SourceControlInputV1 {
    const data = captured(raw);
    fields(data, ['envelope', 'controlEvidence']);
    envelope(data.envelope);
    fact(data.controlEvidence, v => {
        fields(v, [
            'thread', 'objectKind', 'objectId', 'providerRevision', 'contentHash', 'proofRef', 'sourceBindingVersion', 'kind'
        ]);
        thread(v.thread);
        literal(v.objectKind, ['issue', 'comment']);
        id(v.objectId);
        id(v.providerRevision);
        hash(v.contentHash);
        id(v.proofRef);
        revision(v.sourceBindingVersion);
        literal(v.kind, ['verified_snapshot', 'verified_deletion']);
    });
    return data as T.SourceControlInputV1;
}
