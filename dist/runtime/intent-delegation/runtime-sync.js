import { cloneSessionIntentLedger } from './types.js';
const TERMINAL_INTENT_STATUSES = new Set(['completed', 'failed', 'cancelled']);
export function wireIntentDelegationToRuntimeSync(options) {
    let latestLedger;
    void options.ledgerStore.load(options.sessionId).then((ledger) => {
        latestLedger = ledger;
    });
    const syncState = new Map();
    const unsubscribers = [
        options.hooks.on('tool_started', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            if (!isIntentSyncTool(event.toolName)) {
                return;
            }
            const key = buildSyncKey(event.turnId, event.toolName);
            const queue = syncState.get(key) ?? [];
            queue.push({
                turnId: event.turnId,
                toolName: event.toolName,
                toolInput: event.toolInput,
                before: latestLedger ? cloneSessionIntentLedger(latestLedger) : undefined,
            });
            syncState.set(key, queue);
        }),
        options.hooks.on('tool_finished', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            if (isIntentSyncTool(event.toolName)) {
                void processIntentToolFinished(options, syncState, event.turnId, event.toolName, event.ok, {
                    getLatestLedger: () => latestLedger,
                    setLatestLedger: (ledger) => {
                        latestLedger = ledger;
                    },
                });
                return;
            }
            if (!event.ok) {
                void patchActiveIntent(options, {
                    blockedReason: `tool ${event.toolName} returned an error`,
                }, (ledger) => {
                    latestLedger = ledger;
                });
            }
        }),
        options.hooks.on('turn_failed', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            void patchActiveIntent(options, {
                overallStatus: 'failed',
                blockedReason: event.error.message,
            }, (ledger) => {
                latestLedger = ledger;
            });
        }),
        options.hooks.on('turn_aborted', (event) => {
            if (event.sessionId !== options.sessionId) {
                return;
            }
            void patchActiveIntent(options, {
                overallStatus: 'cancelled',
            }, (ledger) => {
                latestLedger = ledger;
            });
        }),
    ];
    return () => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
        syncState.clear();
    };
}
async function processIntentToolFinished(options, syncState, turnId, toolName, ok, state) {
    const key = buildSyncKey(turnId, toolName);
    const queue = syncState.get(key);
    const entry = queue?.shift();
    if (queue && queue.length === 0) {
        syncState.delete(key);
    }
    if (!ok) {
        const refreshed = await options.ledgerStore.load(options.sessionId);
        state.setLatestLedger(refreshed);
        return;
    }
    const after = await options.ledgerStore.load(options.sessionId);
    state.setLatestLedger(after);
    if (!entry || !after) {
        return;
    }
    if (toolName === 'intent_create') {
        emitIntentCreated(options.hooks, options.sessionId, entry, after);
        return;
    }
    if (toolName === 'intent_step_update') {
        emitStepUpdateTraces(options.hooks, options.sessionId, entry, after);
        return;
    }
    if (toolName === 'intent_stage_artifact') {
        emitArtifactTrace(options.hooks, options.sessionId, entry, after);
        return;
    }
    emitSalvageTrace(options.hooks, options.sessionId, entry, after);
}
function emitIntentCreated(hooks, sessionId, entry, after) {
    const beforeIntentIds = new Set(entry.before?.intents.map((intent) => intent.intentId) ?? []);
    const created = after.intents.find((intent) => !beforeIntentIds.has(intent.intentId))
        ?? resolveCreatedIntentFromInput(after, entry.toolInput);
    if (!created) {
        return;
    }
    hooks.emit({
        type: 'intent_created',
        sessionId,
        turnId: entry.turnId,
        intentId: created.intentId,
        templateId: created.templateId,
        deliverable: created.deliverable,
        riskTier: created.riskTier,
    });
    const initialStage = created.stages.find((stage) => stage.stageId === created.activeStageId) ?? created.stages[0];
    if (initialStage) {
        hooks.emit({
            type: 'stage_activated',
            sessionId,
            turnId: entry.turnId,
            intentId: created.intentId,
            stageId: initialStage.stageId,
            label: initialStage.label,
            order: initialStage.order,
            totalStages: created.stages.length,
        });
    }
}
function emitStepUpdateTraces(hooks, sessionId, entry, after) {
    const afterIntent = resolveIntentForInput(after, entry.toolInput);
    if (!afterIntent) {
        return;
    }
    const beforeIntent = entry.before
        ? entry.before.intents.find((intent) => intent.intentId === afterIntent.intentId)
        : undefined;
    const activeStepId = typeof entry.toolInput.active_step_id === 'string' ? entry.toolInput.active_step_id : afterIntent.activeStepId;
    const requestedStatus = readStepStatus(entry.toolInput.step_status);
    const requestedBreadcrumb = typeof entry.toolInput.breadcrumb === 'string' ? entry.toolInput.breadcrumb.trim() : '';
    const requestedReceipt = typeof entry.toolInput.receipt_note === 'string' ? entry.toolInput.receipt_note.trim() : '';
    if (beforeIntent?.activeStageId !== afterIntent.activeStageId) {
        const activeStage = afterIntent.stages.find((stage) => stage.stageId === afterIntent.activeStageId);
        if (activeStage) {
            hooks.emit({
                type: 'stage_activated',
                sessionId,
                turnId: entry.turnId,
                intentId: afterIntent.intentId,
                stageId: activeStage.stageId,
                label: activeStage.label,
                order: activeStage.order,
                totalStages: afterIntent.stages.length,
            });
        }
    }
    if (requestedStatus === 'running' && isStepRunning(afterIntent, activeStepId)) {
        const beforeStatus = beforeIntent?.steps.find((step) => step.stepId === activeStepId)?.status;
        if (!beforeIntent || beforeStatus !== 'running') {
            hooks.emit({
                type: 'step_activated',
                sessionId,
                turnId: entry.turnId,
                intentId: afterIntent.intentId,
                stepId: activeStepId,
            });
        }
    }
    const breadcrumbs = entry.before
        ? diffBreadcrumbs(entry.before, after).filter((breadcrumb) => matchesRequestedBreadcrumb(breadcrumb, afterIntent.intentId, activeStepId, requestedStatus, requestedBreadcrumb))
        : resolveBreadcrumbFromInput(after, afterIntent.intentId, activeStepId, requestedStatus, requestedBreadcrumb);
    for (const breadcrumb of breadcrumbs) {
        hooks.emit({
            type: 'breadcrumb_emitted',
            sessionId,
            turnId: entry.turnId,
            intentId: breadcrumb.intentId,
            stepId: breadcrumb.stepId,
            status: breadcrumb.status,
            message: breadcrumb.message,
        });
    }
    if (!requestedReceipt) {
        return;
    }
    if (after.receipt
        && after.receipt.intentId === afterIntent.intentId
        && after.receipt.stepId === activeStepId
        && after.receipt.note === requestedReceipt
        && (!entry.before || hasReceiptChanged(entry.before, after))) {
        hooks.emit({
            type: 'receipt_emitted',
            sessionId,
            turnId: entry.turnId,
            intentId: after.receipt.intentId,
            stepId: after.receipt.stepId,
            note: after.receipt.note,
        });
    }
}
function emitSalvageTrace(hooks, sessionId, entry, after) {
    const intentId = typeof entry.toolInput.intent_id === 'string' ? entry.toolInput.intent_id : undefined;
    const summary = readSummary(entry.toolInput.summary);
    const reason = typeof entry.toolInput.reason === 'string' ? entry.toolInput.reason : undefined;
    if (!intentId || summary.length === 0 || !after.salvage) {
        return;
    }
    if (after.salvage.intentId !== intentId || !sameSummary(after.salvage.summary, summary) || after.salvage.reason !== reason) {
        return;
    }
    if (entry.before && !hasSalvageChanged(entry.before, after)) {
        return;
    }
    hooks.emit({
        type: 'salvage_emitted',
        sessionId,
        turnId: entry.turnId,
        intentId,
        summary: [...summary],
        reason,
    });
}
function emitArtifactTrace(hooks, sessionId, entry, after) {
    const intent = resolveIntentForInput(after, entry.toolInput);
    const stageId = typeof entry.toolInput.stage_id === 'string' ? entry.toolInput.stage_id : undefined;
    const label = typeof entry.toolInput.label === 'string' ? entry.toolInput.label.trim() : '';
    if (!intent || !stageId || !label) {
        return;
    }
    const artifact = intent.artifacts?.[intent.artifacts.length - 1];
    if (!artifact || artifact.stageId !== stageId || artifact.label !== label) {
        return;
    }
    hooks.emit({
        type: 'artifact_recorded',
        sessionId,
        turnId: entry.turnId,
        intentId: intent.intentId,
        stageId,
        artifactId: artifact.artifactId,
        label: artifact.label,
        kind: artifact.kind,
        path: artifact.path,
    });
}
async function patchActiveIntent(options, patch, onPatched) {
    const ledger = await options.ledgerStore.load(options.sessionId);
    const intentId = ledger?.activeIntentId;
    if (!ledger || !intentId) {
        return;
    }
    const activeIntent = ledger.intents.find((intent) => intent.intentId === intentId);
    if (!activeIntent || TERMINAL_INTENT_STATUSES.has(activeIntent.overallStatus)) {
        onPatched?.(ledger);
        return;
    }
    const updated = await options.ledgerStore.updateIntent(options.sessionId, intentId, {
        overallStatus: patch.overallStatus,
        blockedReason: patch.blockedReason,
    });
    onPatched?.(updated);
}
function buildSyncKey(turnId, toolName) {
    return `${turnId}:${toolName}`;
}
function isIntentSyncTool(toolName) {
    return toolName === 'intent_create'
        || toolName === 'intent_step_update'
        || toolName === 'intent_stage_artifact'
        || toolName === 'intent_salvage';
}
function resolveCreatedIntentFromInput(after, toolInput) {
    const rawIntent = typeof toolInput.raw_intent === 'string' ? toolInput.raw_intent : undefined;
    const deliverable = typeof toolInput.deliverable === 'string' ? toolInput.deliverable : undefined;
    return after.intents.find((intent) => intent.rawIntent === rawIntent && intent.deliverable === deliverable)
        ?? after.latestPlan
        ?? undefined;
}
function resolveIntentForInput(ledger, toolInput) {
    const intentId = typeof toolInput.intent_id === 'string' ? toolInput.intent_id : ledger.activeIntentId;
    if (!intentId) {
        return undefined;
    }
    return ledger.intents.find((intent) => intent.intentId === intentId);
}
function isStepRunning(intent, stepId) {
    return intent.steps.some((step) => step.stepId === stepId && step.status === 'running');
}
function diffBreadcrumbs(before, after) {
    const previous = before.breadcrumbs;
    if (after.breadcrumbs.length <= previous.length) {
        return [];
    }
    return after.breadcrumbs.slice(previous.length);
}
function resolveBreadcrumbFromInput(after, intentId, stepId, status, breadcrumb) {
    if (!breadcrumb) {
        return [];
    }
    const latest = after.breadcrumbs[after.breadcrumbs.length - 1];
    if (!latest) {
        return [];
    }
    return matchesRequestedBreadcrumb(latest, intentId, stepId, status, breadcrumb) ? [latest] : [];
}
function matchesRequestedBreadcrumb(breadcrumb, intentId, stepId, status, message) {
    return breadcrumb.intentId === intentId
        && breadcrumb.stepId === stepId
        && breadcrumb.status === status
        && breadcrumb.message === message;
}
function hasReceiptChanged(before, after) {
    if (!after.receipt) {
        return false;
    }
    const previous = before.receipt;
    return !previous
        || previous.intentId !== after.receipt.intentId
        || previous.stepId !== after.receipt.stepId
        || previous.note !== after.receipt.note
        || previous.createdAt !== after.receipt.createdAt;
}
function hasSalvageChanged(before, after) {
    if (!after.salvage) {
        return false;
    }
    const previous = before.salvage;
    return !previous
        || previous.intentId !== after.salvage.intentId
        || previous.reason !== after.salvage.reason
        || previous.createdAt !== after.salvage.createdAt
        || !sameSummary(previous.summary, after.salvage.summary);
}
function readStepStatus(value) {
    return value === 'blocked' || value === 'completed' || value === 'failed' ? value : 'running';
}
function readSummary(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : [];
}
function sameSummary(left, right) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
