const KNOWN_COMPONENTS = new Set([
    'trace',
    'diagnoser',
    'guard',
    'harness-memory',
    'desktop-contract',
    'kswarm-contract',
    'skill',
    'tool',
    'middleware',
    'eval',
    'prompt',
]);
export function validateHarnessManifest(input) {
    const errors = [];
    const manifest = isRecord(input) ? input : {};
    if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
        errors.push('components');
    }
    else {
        manifest.components.forEach((component, index) => {
            if (typeof component !== 'string' || !KNOWN_COMPONENTS.has(component)) {
                errors.push(`components[${index}]:${String(component)}`);
            }
        });
    }
    if (!Array.isArray(manifest.tests) || manifest.tests.length === 0)
        errors.push('tests');
    if (typeof manifest.rollback !== 'string' || manifest.rollback.trim().length === 0)
        errors.push('rollback');
    const expectedImpact = isRecord(manifest.expectedImpact) ? manifest.expectedImpact : {};
    for (const field of ['reliability', 'latency', 'tokenUsage', 'uxRisk']) {
        if (typeof expectedImpact[field] !== 'string' || expectedImpact[field].trim().length === 0) {
            errors.push(`expectedImpact.${field}`);
        }
    }
    const reviews = isRecord(manifest.reviews) ? manifest.reviews : {};
    if (typeof reviews.internal !== 'string' || reviews.internal.trim().length === 0)
        errors.push('reviews.internal');
    if (typeof reviews.qodercli !== 'string' || reviews.qodercli.trim().length === 0)
        errors.push('reviews.qodercli');
    return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
