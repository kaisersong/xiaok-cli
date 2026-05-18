import { createHash } from 'node:crypto';
export function computeBaselineHash(input) {
    return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`;
}
export function validateBaselineUpdate(input) {
    const errors = [];
    const newFailures = extractFailures(input.newBaseline);
    for (const failure of newFailures) {
        if (failure.severity === 'critical' || failure.severity === 'high') {
            if (!input.manifestOverride?.actor || !input.manifestOverride.reason.trim()) {
                errors.push(`failureCategoryDelta:${failure.severity}:${failure.category}`);
            }
        }
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
function extractFailures(value) {
    if (!isRecord(value) || !Array.isArray(value.failures))
        return [];
    return value.failures
        .filter(isRecord)
        .map((failure) => ({
        category: String(failure.category ?? 'unknown'),
        severity: String(failure.severity ?? 'unknown'),
    }));
}
function stableStringify(value) {
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
