/** Capture only data. Optional undefined object fields use existing durable JSON semantics. */
export function captureIntentData(raw) {
    const seen = new Set();
    function copy(value, depth) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            return value;
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (!value || typeof value !== 'object' || depth > 128 || seen.has(value) || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))))
            throw Error('intent_commit_data');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(value).some(k => typeof k !== 'string') || Object.values(descriptors).some(d => !('value' in d)))
            throw Error('intent_commit_accessor');
        seen.add(value);
        try {
            if (Array.isArray(value)) {
                if (Object.keys(descriptors).length !== value.length + 1)
                    throw Error('intent_commit_array');
                return Array.from({ length: value.length }, (_, i) => copy(descriptors[String(i)]?.value, depth + 1));
            }
            return Object.fromEntries(Object.entries(descriptors).filter(([, d]) => d.value !== undefined).map(([k, d]) => [k, copy(d.value, depth + 1)]));
        }
        finally {
            seen.delete(value);
        }
    }
    const result = copy(raw, 0);
    if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024 * 1024)
        throw Error('intent_commit_limit');
    return result;
}
