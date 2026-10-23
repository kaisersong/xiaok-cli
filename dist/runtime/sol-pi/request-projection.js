function integer(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function freeze(value, seen = new WeakSet()) {
    if (value && typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value))
            freeze(child, seen);
        Object.freeze(value);
    }
    return value;
}
function preview(text, bytes) {
    if (!bytes)
        return '';
    const body = Buffer.from(text, 'utf8');
    if (body.length <= bytes)
        return text;
    let end = Math.ceil(bytes / 2), start = body.length - Math.floor(bytes / 2);
    while (end > 0 && (body[end] & 0xc0) === 0x80)
        end--;
    while (start < body.length && (body[start] & 0xc0) === 0x80)
        start++;
    return `${body.subarray(0, end).toString('utf8')}\n…\n${body.subarray(start).toString('utf8')}`;
}
export function planObservationRequest(input) {
    const skip = (reason) => ({ status: 'skipped', reason });
    const estimator = input.tokenBound;
    if (typeof input.request.modelId !== 'string' || !input.request.modelId.trim()
        || typeof input.request.protocolId !== 'string' || !input.request.protocolId.trim()
        || typeof input.request.systemPrompt !== 'string' || !Array.isArray(input.request.tools))
        return skip('invalid_request_contract');
    if (!estimator || typeof estimator.countRequestTokens !== 'function'
        || typeof estimator.validationEvidenceId !== 'string' || !estimator.validationEvidenceId.trim()
        || estimator.modelId !== input.request.modelId || estimator.protocolId !== input.request.protocolId)
        return skip('token_bound_unverified');
    if (!integer(input.windowTokens) || !integer(input.outputReserveTokens) || input.outputReserveTokens === 0
        || !integer(input.safetyMarginTokens) || input.safetyMarginTokens === 0
        || !integer(input.previewBytes) || input.previewBytes > 65536
        || (input.outputLimitField === null
            ? !integer(input.verifiedDefaultOutputReserveTokens) || input.verifiedDefaultOutputReserveTokens !== input.outputReserveTokens
            : typeof input.outputLimitField !== 'string' || !Object.hasOwn(input.request, input.outputLimitField)
                || input.request[input.outputLimitField] !== input.outputReserveTokens))
        return skip('invalid_budget_contract');
    const reserved = input.outputReserveTokens + input.safetyMarginTokens;
    if (!Number.isSafeInteger(reserved))
        return skip('budget_overflow');
    const available = input.windowTokens - reserved;
    let request;
    let frozenObservations;
    try {
        request = structuredClone(input.request);
        frozenObservations = structuredClone(input.observations);
    }
    catch {
        return skip('request_not_cloneable');
    }
    const calls = new Set(), results = new Map();
    const pending = new Set();
    const order = [];
    if (!Array.isArray(request.messages))
        return skip('invalid_history');
    for (const message of request.messages) {
        if (!Array.isArray(message.content))
            return skip('invalid_history');
        for (const block of message.content) {
            if (block.type === 'tool_use') {
                if (typeof block.id !== 'string' || !block.id || calls.has(block.id))
                    return skip('invalid_tool_pairing');
                calls.add(block.id);
                pending.add(block.id);
            }
            else if (block.type === 'tool_result') {
                const id = block.tool_use_id;
                if (typeof id !== 'string' || !pending.has(id) || results.has(id))
                    return skip('invalid_tool_pairing');
                pending.delete(id);
                results.set(id, block);
                order.push(id);
            }
        }
    }
    if (pending.size)
        return skip('invalid_tool_pairing');
    const observations = new Map();
    const groups = new Map();
    const mappedTargets = new Set();
    for (const observation of frozenObservations) {
        if (typeof observation.observationId !== 'string' || !observation.observationId
            || mappedTargets.has(observation.toolUseId) || !results.has(observation.toolUseId)
            || typeof results.get(observation.toolUseId).content !== 'string')
            return skip('invalid_observation_mapping');
        mappedTargets.add(observation.toolUseId);
        // Recall is already a bounded page. Never package it again or count it as a full observation.
        if (observation.kind === 'recall')
            continue;
        if (observation.kind !== 'native' || !observation.segments
            || typeof observation.segments.before !== 'string' || typeof observation.segments.native !== 'string' || typeof observation.segments.after !== 'string'
            || observation.segments.before + observation.segments.native + observation.segments.after !== results.get(observation.toolUseId).content
            || typeof observation.authorizedText !== 'string'
            || typeof observation.mandatoryStatus !== 'string' || !observation.mandatoryStatus.trim()
            || Buffer.byteLength(observation.mandatoryStatus) > 4096
            || typeof observation.reference !== 'string' || !observation.reference.trim()
            || Buffer.byteLength(observation.reference) > 4096
            || (observation.fullLogicalSendCount !== null && !integer(observation.fullLogicalSendCount)))
            return skip('invalid_observation_mapping');
        const group = groups.get(observation.observationId) ?? [];
        const first = group[0];
        if (first && (first.authorizedText !== observation.authorizedText || first.mandatoryStatus !== observation.mandatoryStatus
            || first.reference !== observation.reference || first.fullLogicalSendCount !== observation.fullLogicalSendCount))
            return skip('inconsistent_observation_group');
        group.push(observation);
        groups.set(observation.observationId, group);
        observations.set(observation.toolUseId, observation);
        results.get(observation.toolUseId).content = `${observation.segments.before}${observation.mandatoryStatus}\n${observation.reference}${observation.segments.after}`;
    }
    const count = (value) => {
        // A callback cannot mutate either source history or the candidate being frozen.
        const bound = estimator.countRequestTokens(freeze(structuredClone(value)));
        if (!integer(bound))
            throw new Error('invalid_token_bound');
        return bound;
    };
    try {
        let tokens = count(request);
        if (tokens > available)
            return { status: 'context_budget_exceeded', reason: 'minimum_protocol_exceeds_budget' };
        const fullCountProposals = [];
        const fullObservationIds = [];
        const projectedGroups = new Set();
        for (const id of order) {
            const observation = observations.get(id);
            if (!observation || projectedGroups.has(observation.observationId))
                continue;
            projectedGroups.add(observation.observationId);
            const group = groups.get(observation.observationId);
            const renderGroup = (body) => {
                for (const item of group) {
                    const minimum = `${item.mandatoryStatus}\n${item.reference}`;
                    results.get(item.toolUseId).content = `${item.segments.before}${minimum}${body === undefined ? '' : `\n${body}`}${item.segments.after}`;
                }
            };
            if (observation.fullLogicalSendCount === null || observation.fullLogicalSendCount < 2) {
                renderGroup(observation.authorizedText);
                const fullTokens = count(request);
                if (fullTokens <= available) {
                    tokens = fullTokens;
                    fullObservationIds.push(observation.observationId);
                    // Unknown remains unknown; only the owner can reconcile durable counters.
                    if (observation.fullLogicalSendCount !== null)
                        fullCountProposals.push({ observationId: observation.observationId, expectedCount: observation.fullLogicalSendCount });
                    continue;
                }
            }
            for (let bytes = input.previewBytes;; bytes = Math.floor(bytes / 2)) {
                renderGroup(bytes ? preview(observation.authorizedText, bytes) : undefined);
                const previewTokens = count(request);
                if (previewTokens <= available) {
                    tokens = previewTokens;
                    break;
                }
                if (bytes === 0)
                    return { status: 'context_budget_exceeded', reason: 'minimum_protocol_exceeds_budget' };
            }
        }
        const total = tokens + reserved;
        if (!Number.isSafeInteger(total))
            return skip('budget_overflow');
        return { status: 'projected', request: freeze(request), inputTokenUpperBound: tokens, totalTokenUpperBound: total, fullCountProposals, fullObservationIds };
    }
    catch {
        return skip('token_bound_failed');
    }
}
