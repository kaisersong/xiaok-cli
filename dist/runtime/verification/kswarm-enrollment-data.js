import { types } from 'node:util';
import { canonicalVerificationJson as json } from './protocol.js';
function descriptors(raw) {
    if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
        throw Error('kswarm_enrollment_data');
    const d = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(d).some(k => typeof k !== 'string') || Object.values(d).some(v => !('value' in v) || !v.enumerable))
        throw Error('kswarm_enrollment_data');
    return d;
}
/** Capture the new branch before entering a transaction or serializing it. */
export function captureKSwarmEnrollmentData(raw, envelope = false) {
    const d = descriptors(raw), branch = envelope ? d.enrollment?.value : raw;
    if (branch === undefined)
        return raw;
    const e = descriptors(branch);
    if (e.ownerKind?.value !== 'kswarm' && !e.kswarmSubject)
        return raw;
    let nodes = 0;
    const seen = new Set();
    function copy(value, depth) {
        if (++nodes > 65536 || depth > 128)
            throw Error('kswarm_enrollment_limit');
        if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value))
            return value;
        if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value))
            throw Error('kswarm_enrollment_data');
        seen.add(value);
        try {
            if (Array.isArray(value)) {
                if (Object.getPrototypeOf(value) !== Array.prototype)
                    throw Error('kswarm_enrollment_data');
                const a = Object.getOwnPropertyDescriptors(value), length = a['length']?.value;
                if (!Number.isSafeInteger(length) || length < 0 || length > 65536 || Reflect.ownKeys(a).length !== length + 1)
                    throw Error('kswarm_enrollment_data');
                const result = [];
                for (let i = 0; i < length; i++) {
                    const item = a[String(i)];
                    if (!item || !('value' in item) || !item.enumerable)
                        throw Error('kswarm_enrollment_data');
                    result.push(copy(item.value, depth + 1));
                }
                return Object.freeze(result);
            }
            return Object.freeze(Object.fromEntries(Object.entries(descriptors(value)).map(([key, entry]) => [key, copy(entry.value, depth + 1)])));
        }
        finally {
            seen.delete(value);
        }
    }
    const result = copy(raw, 0);
    if (Buffer.byteLength(json(result)) > 65536)
        throw Error('kswarm_enrollment_limit');
    return result;
}
