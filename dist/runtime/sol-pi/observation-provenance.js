const ports = new WeakMap();
/** Only the exact host-created port can wrap a sealed body, once. No callbacks or property reads. */
export function wrapNativeObservationHistory(port, before, body, after) {
    const state = port && typeof port === 'object' ? ports.get(port) : undefined;
    if (!state)
        return false;
    if (!state.valid || state.stage !== 'history' || state.wrapped || typeof before !== 'string'
        || typeof body !== 'string' || typeof after !== 'string' || body !== state.expected) {
        state.valid = false;
        return false;
    }
    state.wrapped = true;
    state.prefix = before;
    state.suffix += after;
    state.expected = before + body + after;
    return true;
}
const receipts = new WeakMap();
export function readFinalizedObservationProvenance(receipt) {
    if (!receipt || typeof receipt !== 'object')
        return undefined;
    const entry = receipts.get(receipt);
    return entry?.state.valid && entry.state.stage === 'finalized' ? entry.value : undefined;
}
export function createNativeObservationProvenance(input) {
    const { hostInvocationId, ownerGeneration, nativePreview } = input;
    const state = { valid: typeof hostInvocationId === 'string' && !!hostInvocationId
            && Number.isSafeInteger(ownerGeneration) && ownerGeneration >= 0 && typeof nativePreview === 'string',
        stage: 'registry', expected: nativePreview, suffix: '', prefix: '', wrapped: false };
    const registry = () => { if (state.stage !== 'registry')
        state.valid = false; return state.valid; };
    const port = Object.freeze({
        appendSuffix(suffix) {
            if (!registry())
                return;
            if (typeof suffix !== 'string') {
                state.valid = false;
                return;
            }
            state.expected += suffix;
            state.suffix += suffix;
        },
        observeTransform(value) {
            if (!registry())
                return;
            if (!value || value.before !== state.expected || value.after !== value.before)
                state.valid = false;
        },
        sealRegistry(finalResult) {
            if (!registry())
                return;
            if (finalResult !== state.expected) {
                state.valid = false;
                return;
            }
            state.stage = 'history';
        },
        finalizeHistory(finalContent) {
            if (!state.valid || state.stage !== 'history' || finalContent !== state.expected) {
                state.valid = false;
                return undefined;
            }
            state.stage = 'finalized';
            const receipt = Object.freeze({ kind: 'host-native-observation' });
            receipts.set(receipt, { state, value: Object.freeze({ hostInvocationId, ownerGeneration, wholeContent: finalContent,
                    segments: Object.freeze({ before: state.prefix, native: nativePreview, after: state.suffix }) }) });
            return receipt;
        },
        invalidate() { state.valid = false; },
    });
    ports.set(port, state);
    return port;
}
