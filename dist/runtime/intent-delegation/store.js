import { cloneIntentRecord, cloneSessionIntentLedger, createEmptySessionIntentLedger, createIntentLedgerRecord, } from './types.js';
export { createEmptySessionIntentLedger } from './types.js';
export { rekeySessionIntentLedger } from './types.js';
export class SessionIntentDelegationStore {
    sessionStore;
    constructor(sessionStore) {
        this.sessionStore = sessionStore;
    }
    async load(sessionId) {
        const snapshot = await this.sessionStore.load(sessionId);
        if (!snapshot) {
            return null;
        }
        return readLedger(snapshot);
    }
    async appendIntent(sessionId, plan) {
        return this.mutate(sessionId, (ledger) => appendIntentToLedger(ledger, plan));
    }
    async updateIntent(sessionId, intentId, patch) {
        return this.mutate(sessionId, (ledger) => updateIntentInLedger(ledger, intentId, patch));
    }
    async recordBreadcrumb(sessionId, input) {
        return this.mutate(sessionId, (ledger) => recordBreadcrumbInLedger(ledger, input));
    }
    async recordReceipt(sessionId, input) {
        return this.mutate(sessionId, (ledger) => recordReceiptInLedger(ledger, input));
    }
    async recordSalvage(sessionId, input) {
        return this.mutate(sessionId, (ledger) => recordSalvageInLedger(ledger, input));
    }
    async saveDispatchedIntent(sessionId, intent) {
        return this.mutate(sessionId, (ledger) => saveDispatchedIntentInLedger(ledger, intent));
    }
    async mutate(sessionId, apply) {
        const snapshot = await this.requireSnapshot(sessionId);
        const current = readLedger(snapshot);
        const next = apply(current);
        await this.sessionStore.save({
            ...snapshot,
            updatedAt: next.updatedAt,
            intentDelegation: cloneSessionIntentLedger(next),
        });
        return next;
    }
    async requireSnapshot(sessionId) {
        const snapshot = await this.sessionStore.load(sessionId);
        if (!snapshot) {
            throw new Error(`session not found: ${sessionId}`);
        }
        return snapshot;
    }
}
export function appendIntentToLedger(ledger, plan, now = Date.now()) {
    const next = cloneSessionIntentLedger(ledger);
    const record = createIntentLedgerRecord(plan, now);
    if (!next.ownership.ownerInstanceId && !next.ownership.previousOwnerInstanceId) {
        next.ownership = {
            state: 'owned',
            ownerInstanceId: plan.instanceId,
            updatedAt: now,
        };
    }
    next.instanceId = next.ownership.ownerInstanceId ?? plan.instanceId;
    next.activeIntentId = record.intentId;
    next.latestPlan = cloneIntentRecord(record);
    next.intents = [...next.intents.filter((intent) => intent.intentId !== record.intentId), record];
    next.updatedAt = now;
    return next;
}
export function updateIntentInLedger(ledger, intentId, patch, now = Date.now()) {
    if (patch.activeStageId !== undefined
        || patch.activeStepId !== undefined
        || patch.steps !== undefined
        || patch.stages !== undefined
        || patch.artifacts !== undefined) {
        throw new Error('dispatcher-owned fields activeStageId, activeStepId, stages, artifacts, and steps cannot be patched through the store');
    }
    const next = cloneSessionIntentLedger(ledger);
    const intent = requireIntent(next, intentId);
    intent.overallStatus = patch.overallStatus ?? intent.overallStatus;
    intent.blockedReason = normalizeOptional(patch.blockedReason, intent.blockedReason);
    intent.latestBreadcrumb = normalizeOptional(patch.latestBreadcrumb, intent.latestBreadcrumb);
    intent.latestReceipt = normalizeOptional(patch.latestReceipt, intent.latestReceipt);
    intent.salvageSummary = patch.salvageSummary ? [...patch.salvageSummary] : intent.salvageSummary;
    intent.attemptCount = patch.attemptCount ?? intent.attemptCount;
    intent.updatedAt = now;
    return syncLedgerSummaryToIntent(next, intent, now);
}
export function recordBreadcrumbInLedger(ledger, input, now = input.createdAt ?? Date.now()) {
    const next = cloneSessionIntentLedger(ledger);
    const intent = requireIntent(next, input.intentId);
    const breadcrumb = {
        intentId: input.intentId,
        stepId: input.stepId,
        status: input.status,
        message: input.message,
        createdAt: now,
    };
    next.breadcrumbs = [...next.breadcrumbs, breadcrumb];
    intent.latestBreadcrumb = input.message;
    intent.updatedAt = now;
    return syncLedgerSummaryToIntent(next, intent, now);
}
export function recordReceiptInLedger(ledger, input, now = input.createdAt ?? Date.now()) {
    const next = cloneSessionIntentLedger(ledger);
    const intent = requireIntent(next, input.intentId);
    const receipt = {
        intentId: input.intentId,
        stepId: input.stepId,
        note: input.note,
        createdAt: now,
    };
    next.receipt = receipt;
    intent.latestReceipt = input.note;
    intent.updatedAt = now;
    return syncLedgerSummaryToIntent(next, intent, now);
}
export function recordSalvageInLedger(ledger, input, now = input.createdAt ?? Date.now()) {
    const next = cloneSessionIntentLedger(ledger);
    const intent = requireIntent(next, input.intentId);
    const salvage = {
        intentId: input.intentId,
        summary: [...input.summary],
        reason: input.reason,
        createdAt: now,
    };
    next.salvage = salvage;
    intent.salvageSummary = [...input.summary];
    intent.updatedAt = now;
    return syncLedgerSummaryToIntent(next, intent, now);
}
export function saveDispatchedIntentInLedger(ledger, intentRecord) {
    const next = cloneSessionIntentLedger(ledger);
    const existing = requireIntent(next, intentRecord.intentId);
    const replacement = cloneIntentRecord({
        ...intentRecord,
        sessionId: existing.sessionId,
        instanceId: existing.instanceId,
    });
    next.intents = next.intents.map((intent) => intent.intentId === replacement.intentId ? replacement : intent);
    return syncLedgerSummaryToIntent(next, replacement, replacement.updatedAt);
}
export function readLedger(snapshot) {
    const existing = snapshot.intentDelegation;
    if (!existing) {
        return createEmptySessionIntentLedger(snapshot.sessionId, snapshot.updatedAt);
    }
    return {
        ...cloneSessionIntentLedger(existing),
        sessionId: snapshot.sessionId,
    };
}
function requireIntent(ledger, intentId) {
    const intent = ledger.intents.find((candidate) => candidate.intentId === intentId);
    if (!intent) {
        throw new Error(`intent not found: ${intentId}`);
    }
    return intent;
}
function normalizeOptional(value, fallback) {
    if (typeof value !== 'string') {
        return fallback;
    }
    return value.trim() ? value : undefined;
}
function syncLedgerSummaryToIntent(ledger, intent, now) {
    ledger.activeIntentId = intent.intentId;
    ledger.latestPlan = cloneIntentRecord(intent);
    ledger.updatedAt = now;
    return ledger;
}
