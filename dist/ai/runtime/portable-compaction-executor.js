function throwIfAborted(signal) {
    if (!signal.aborted)
        return;
    if (signal.reason !== undefined)
        throw signal.reason;
    throw new DOMException('portable compaction aborted', 'AbortError');
}
function isClosedAbortError(error) {
    if (error instanceof DOMException) {
        return error.name === 'AbortError';
    }
    if (!(error instanceof Error))
        return false;
    return error.name === 'AbortError';
}
export async function executePortableCompaction(request, ports) {
    throwIfAborted(request.signal);
    if (request.plan.invalidReason || (request.trigger.kind === 'semantic' && !ports.applySemanticPlan)) {
        return {
            status: 'invalid_plan',
            record: null,
            trigger: request.trigger,
            summaryAttempted: false,
            summaryModelFailed: false,
        };
    }
    if (request.plan.replacedMessages <= 0) {
        return {
            status: 'no_replacement',
            record: null,
            trigger: request.trigger,
            summaryAttempted: false,
            summaryModelFailed: false,
        };
    }
    let summaryText;
    try {
        summaryText = await ports.summarizePrefix(structuredClone(request.plan.messagesToSummarize), request.signal);
        throwIfAborted(request.signal);
    }
    catch (error) {
        throwIfAborted(request.signal);
        if (isClosedAbortError(error))
            throw error;
        return {
            ...(request.trigger.kind === 'semantic'
                ? { status: 'no_gain', record: null }
                : ports.applyPlan(request.plan, undefined)),
            trigger: request.trigger,
            summaryAttempted: true,
            summaryModelFailed: true,
            summaryFailureCode: 'portable_summary_failed',
        };
    }
    if (request.trigger.kind === 'semantic') {
        return {
            ...(summaryText.trim()
                ? await ports.applySemanticPlan(request.plan, summaryText)
                : { status: 'no_gain', record: null }),
            trigger: request.trigger,
            summaryAttempted: true,
            summaryModelFailed: false,
        };
    }
    return {
        ...ports.applyPlan(request.plan, summaryText),
        trigger: request.trigger,
        summaryAttempted: true,
        summaryModelFailed: false,
    };
}
