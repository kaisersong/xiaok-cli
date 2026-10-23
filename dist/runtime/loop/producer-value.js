/** Capture actual typed producer records. Optional undefined object properties
 * are omitted, but accessors and non-data objects are never executed. */
export function captureLoopProducerValue(raw) {
    function copy(value) {
        if (value === null || ['string', 'boolean'].includes(typeof value))
            return value;
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (!value || typeof value !== 'object' || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))))
            throw Error('loop_producer_value');
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.values(descriptors).some(d => !('value' in d)))
            throw Error('loop_producer_accessor');
        if (Array.isArray(value)) {
            if (Object.keys(descriptors).length !== value.length + 1)
                throw Error('loop_producer_array');
            return Array.from({ length: value.length }, (_, i) => copy(descriptors[String(i)]?.value));
        }
        return Object.fromEntries(Object.entries(descriptors).filter(([, d]) => d.value !== undefined).map(([key, d]) => [key, copy(d.value)]));
    }
    return copy(raw);
}
