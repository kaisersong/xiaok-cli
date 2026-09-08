// Private, bounded CPU protocol. No runtime capabilities cross this boundary.
export const DELIVERY_INPUT_LIMIT = 131072;
export const DELIVERY_OUTPUT_LIMIT = 65536;
const STRING_LIMIT = 65536;
const ARRAY_LIMIT = 256;
const EVENT_LIMIT = 16384;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class DeliveryVerificationError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'DeliveryVerificationError';
    }
}
function invalid() { throw new DeliveryVerificationError('verifier_input_invalid'); }
function limit() { throw new DeliveryVerificationError('validation_limit'); }
function object(value, required, optional = []) {
    if (!value || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
        invalid();
    const record = value;
    if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !required.includes(key) && !optional.includes(key)))
        invalid();
    return record;
}
function string(value, max = STRING_LIMIT) {
    if (typeof value !== 'string')
        invalid();
    if (value.length > max || Buffer.byteLength(value, 'utf8') > max)
        limit();
    return value;
}
function array(value) {
    if (!Array.isArray(value))
        invalid();
    if (value.length > ARRAY_LIMIT)
        limit();
    return value;
}
function integer(value, max) {
    if (!Number.isSafeInteger(value) || value < 0)
        invalid();
    if (value > max)
        limit();
    return value;
}
function boolean(value) { if (typeof value !== 'boolean')
    invalid(); return value; }
function strings(value) { return array(value).map(item => string(item)); }
// One exact JSON leaf/string counter serves request projection and response
// framing, including UTF-8, escaping and well-formed lone-surrogate encoding.
function jsonBytes(value) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
        invalid();
    return Buffer.byteLength(encoded, 'utf8');
}
function frameBudget(max, initial) {
    let encodedBytes = 0;
    const reserve = (bytes) => { encodedBytes += bytes; if (encodedBytes > max)
        limit(); };
    reserve(initial);
    return reserve;
}
/** Callers have already validated the fixed, shallow DTO schema. Visit its
 * fields with the same request meter, never stringify a derived root to learn
 * that its duplicated strings exceed the frame limit. */
function reserveFrame(value, max) {
    const reserve = frameBudget(max, 1); // one trailing newline
    const visit = (item) => {
        if (!item || typeof item !== 'object') {
            reserve(jsonBytes(item));
            return;
        }
        reserve(2); // braces/brackets
        if (Array.isArray(item)) {
            for (let index = 0; index < item.length; index++) {
                if (index)
                    reserve(1);
                visit(item[index]);
            }
            return;
        }
        const keys = Object.keys(item);
        const record = object(item, keys);
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            reserve((index ? 1 : 0) + jsonBytes(key) + 1); // comma, key, colon
            visit(record[key]);
        }
    };
    visit(value);
}
function validateEvent(value) {
    const tag = value?.type;
    switch (tag) {
        case 'progress_plan_reported': {
            const v = object(value, ['type', 'steps']);
            for (const step of array(v.steps))
                string(object(step, ['status']).status);
            break;
        }
        case 'result':
            string(object(object(value, ['type', 'result']).result, ['summary']).summary);
            break;
        case 'artifact_recorded': {
            const v = object(value, ['type', 'artifactId', 'kind', 'label', 'filePath']);
            for (const key of ['artifactId', 'kind', 'label', 'filePath'])
                string(v[key]);
            break;
        }
        case 'canvas_file_changed':
            string(object(value, ['type', 'filePath']).filePath);
            break;
        case 'goal_tool_fact': {
            const v = object(value, ['type', 'factKind', 'invocationId'], ['normalizedFilePaths']);
            if (v.factKind !== 'file_mutation')
                invalid();
            string(v.invocationId);
            if (Object.hasOwn(v, 'normalizedFilePaths'))
                strings(v.normalizedFilePaths);
            break;
        }
        case 'goal_tool_finished': {
            const v = object(value, ['type', 'invocationId', 'ok']);
            string(v.invocationId);
            boolean(v.ok);
            break;
        }
        case 'canvas_tool_call': {
            if (object(value, ['type', 'toolName']).toolName !== 'create_project')
                invalid();
            break;
        }
        case 'canvas_tool_result': {
            const v = object(value, ['type', 'toolName', 'ok', 'response']);
            if (v.toolName !== 'create_project')
                invalid();
            boolean(v.ok);
            string(v.response);
            break;
        }
        case 'assistant_delta':
            object(value, ['type']);
            break;
        default: invalid();
    }
}
export function validateDeliveryFactsV1(value) {
    const v = object(value, ['version', 'requestId', 'taskId', 'prompt', 'eventCount', 'eventFacts'], ['result']);
    if (v.version !== 1 || !UUID_V4.test(string(v.requestId, 36)))
        invalid();
    if (!string(v.taskId, 128).trim())
        invalid();
    string(v.prompt);
    const count = integer(v.eventCount, EVENT_LIMIT);
    let previous = -1;
    let assistantSeen = false;
    for (const fact of array(v.eventFacts)) {
        const item = object(fact, ['index', 'event']);
        const index = integer(item.index, EVENT_LIMIT);
        if (index <= previous || index >= count)
            invalid();
        previous = index;
        validateEvent(item.event);
        if (item.event.type === 'assistant_delta') {
            if (assistantSeen)
                invalid();
            assistantSeen = true;
        }
    }
    if (Object.hasOwn(v, 'result')) {
        const result = object(v.result, ['summary', 'artifacts']);
        string(result.summary);
        for (const artifact of array(result.artifacts)) {
            const a = object(artifact, ['artifactId', 'kind', 'title'], ['filePath']);
            string(a.artifactId);
            string(a.kind);
            string(a.title);
            if (Object.hasOwn(a, 'filePath'))
                string(a.filePath);
        }
    }
}
export function encodeDeliveryFrame(value, max) {
    reserveFrame(value, max);
    const frame = JSON.stringify(value) + '\n';
    if (frame.length > max || Buffer.byteLength(frame, 'utf8') > max)
        limit();
    return frame;
}
export function parseDeliveryFrame(frame, max) {
    if (typeof frame !== 'string')
        invalid();
    if (frame.length > max || Buffer.byteLength(frame, 'utf8') > max)
        limit();
    if (!frame.endsWith('\n'))
        invalid();
    try {
        return JSON.parse(frame);
    }
    catch {
        return invalid();
    }
}
/** Project incrementally before serializing; never clone an unbounded snapshot. */
export function buildDeliveryFactsV1(snapshot, requestId) {
    const eventCount = integer(snapshot.events.length, EVENT_LIMIT);
    // Account the complete frame's known structure, including closing delimiters
    // and empty required fields, before reading their payloads. Each replacement
    // adds only its exact encoded delta; no whole-snapshot serialization occurs.
    const facts = { version: 1, requestId: '', taskId: '', prompt: '', eventCount, eventFacts: [] };
    const reserve = frameBudget(DELIVERY_INPUT_LIMIT, jsonBytes(facts) + 1);
    const copyString = (value, max = STRING_LIMIT) => {
        const text = string(value, max);
        reserve(jsonBytes(text) - 2); // replace ""
        return text;
    };
    const copyBoolean = (value) => { const result = boolean(value); if (!result)
        reserve(1); return result; }; // replace true
    const append = (target, empty) => {
        reserve((target.length ? 1 : 0) + jsonBytes(empty));
        target.push(empty);
        return empty;
    };
    const retain = (index, event) => {
        // Only discriminants select this path. Non-retained events remain legal
        // when all slots are used; no payload is touched to make that decision.
        if (facts.eventFacts.length === ARRAY_LIMIT)
            limit();
        append(facts.eventFacts, { index, event });
        return event;
    };
    const field = (key, empty) => {
        reserve(1 + jsonBytes(key) + 1 + jsonBytes(empty));
    };
    facts.requestId = copyString(requestId, 36);
    facts.taskId = copyString(snapshot.taskId, 128);
    facts.prompt = copyString(snapshot.prompt);
    let assistantSeen = false;
    for (let index = 0; index < eventCount; index++) {
        const source = snapshot.events[index];
        switch (source.type) {
            case 'progress_plan_reported': {
                const event = retain(index, { type: 'progress_plan_reported', steps: [] });
                const steps = array(source.steps);
                for (let i = 0; i < steps.length; i++) {
                    const step = append(event.steps, { status: '' });
                    step.status = copyString(steps[i].status);
                }
                break;
            }
            case 'result': {
                const event = retain(index, { type: 'result', result: { summary: '' } });
                event.result.summary = copyString(source.result.summary);
                break;
            }
            case 'artifact_recorded': {
                const event = retain(index, { type: 'artifact_recorded', artifactId: '', kind: '', label: '', filePath: '' });
                event.artifactId = copyString(source.artifactId);
                event.kind = copyString(source.kind);
                event.label = copyString(source.label);
                event.filePath = copyString(source.filePath);
                break;
            }
            case 'canvas_file_changed': {
                const event = retain(index, { type: 'canvas_file_changed', filePath: '' });
                event.filePath = copyString(source.filePath);
                break;
            }
            case 'goal_tool_fact': {
                if (source.factKind === 'file_mutation') {
                    const event = retain(index, { type: 'goal_tool_fact', factKind: 'file_mutation', invocationId: '' });
                    event.invocationId = copyString(source.invocationId);
                    const paths = source.normalizedFilePaths;
                    if (paths !== undefined) {
                        const values = array(paths);
                        field('normalizedFilePaths', []);
                        event.normalizedFilePaths = [];
                        for (let i = 0; i < values.length; i++) {
                            append(event.normalizedFilePaths, '');
                            event.normalizedFilePaths[i] = copyString(values[i]);
                        }
                    }
                }
                break;
            }
            case 'goal_tool_finished': {
                const event = retain(index, { type: 'goal_tool_finished', invocationId: '', ok: true });
                event.invocationId = copyString(source.invocationId);
                event.ok = copyBoolean(source.ok);
                break;
            }
            case 'canvas_tool_call':
                if (source.toolName === 'create_project')
                    retain(index, { type: 'canvas_tool_call', toolName: 'create_project' });
                break;
            case 'canvas_tool_result': {
                if (source.toolName === 'create_project') {
                    const event = retain(index, { type: 'canvas_tool_result', toolName: 'create_project', ok: true, response: '' });
                    event.ok = copyBoolean(source.ok);
                    event.response = copyString(source.response);
                }
                break;
            }
            case 'assistant_delta':
                if (!assistantSeen) {
                    retain(index, { type: 'assistant_delta' });
                    assistantSeen = true;
                }
                break;
        }
    }
    const result = snapshot.result;
    if (result != null) {
        facts.result = { summary: '', artifacts: [] };
        field('result', facts.result);
        facts.result.summary = copyString(result.summary);
        const artifacts = array(result.artifacts);
        for (let i = 0; i < artifacts.length; i++) {
            const target = append(facts.result.artifacts, { artifactId: '', kind: '', title: '' });
            const a = artifacts[i];
            target.artifactId = copyString(a.artifactId);
            target.kind = copyString(a.kind);
            target.title = copyString(a.title);
            const filePath = a.filePath;
            if (filePath !== undefined) {
                field('filePath', '');
                target.filePath = copyString(filePath);
            }
        }
    }
    validateDeliveryFactsV1(facts);
    encodeDeliveryFrame(facts, DELIVERY_INPUT_LIMIT);
    return facts;
}
/** Only the shared CPU helpers consume this deliberately minimal snapshot. */
export function deliveryFactsSnapshot(facts) {
    const events = Array.from({ length: facts.eventCount }, () => ({ type: 'delivery_ignored' }));
    for (const fact of facts.eventFacts)
        events[fact.index] = fact.event;
    return { taskId: facts.taskId, prompt: facts.prompt, events, ...(facts.result ? { result: facts.result } : {}) };
}
export function validateDeliveryResponse(value, request) {
    const v = object(value, ['version', 'requestId', 'result']);
    if (v.version !== 1 || v.requestId !== request.requestId)
        invalid();
    const result = v.result;
    if (result?.kind === 'error') {
        const error = object(result, ['kind', 'code']);
        if (!['verifier_input_invalid', 'verifier_internal_error', 'validation_limit'].includes(String(error.code)))
            invalid();
        return;
    }
    const r = object(result, ['kind', 'planComplete', 'emptyDelivery', 'guard']);
    if (r.kind !== 'facts')
        invalid();
    boolean(r.planComplete);
    boolean(r.emptyDelivery);
    const guard = r.guard;
    if (guard?.kind === 'skip') {
        object(guard, ['kind']);
        return;
    }
    const g = object(guard, ['kind', 'expectation', 'evidence']);
    if (g.kind !== 'evaluate')
        invalid();
    const expectation = object(g.expectation, ['ownerKind', 'ownerId', 'expectedKinds', 'source', 'confidence']);
    if (expectation.ownerKind !== 'task' || expectation.ownerId !== request.taskId)
        invalid();
    if (!['tool_schema', 'task_spec', 'kswarm_deliverable_type', 'legacy_classifier'].includes(String(expectation.source)))
        invalid();
    if (!['explicit', 'inferred'].includes(String(expectation.confidence)))
        invalid();
    const kinds = strings(expectation.expectedKinds);
    if (kinds.length !== 1 || !['answer', 'file_artifact', 'project_update'].includes(kinds[0]))
        invalid();
    for (const item of array(g.evidence)) {
        const evidence = object(item, ['ownerKind', 'ownerId', 'kind', 'summary', 'metadata'], ['uri']);
        if (evidence.ownerKind !== 'task' || evidence.ownerId !== request.taskId)
            invalid();
        string(evidence.summary);
        if (evidence.kind === 'answer') {
            if (Object.hasOwn(evidence, 'uri'))
                invalid();
            const metadata = object(evidence.metadata, ['responseId']);
            const responseId = string(metadata.responseId);
            if (!request.eventFacts.some(fact => fact.event.type === 'result' && responseId === `${request.taskId}:result:${fact.index}`))
                invalid();
        }
        else if (evidence.kind === 'file_artifact') {
            string(evidence.uri);
            const metadata = object(evidence.metadata, [], ['paths', 'artifactId', 'kind']);
            if (Object.hasOwn(metadata, 'paths'))
                strings(metadata.paths);
            if (Object.hasOwn(metadata, 'artifactId'))
                string(metadata.artifactId);
            if (Object.hasOwn(metadata, 'kind'))
                string(metadata.kind);
        }
        else if (evidence.kind === 'project_update') {
            if (Object.hasOwn(evidence, 'uri'))
                invalid();
            const metadata = object(evidence.metadata, ['projectId', 'changedDeliverables']);
            string(metadata.projectId);
            const changed = strings(metadata.changedDeliverables);
            if (changed.length !== 1 || changed[0] !== 'project_card')
                invalid();
        }
        else
            invalid();
    }
}
