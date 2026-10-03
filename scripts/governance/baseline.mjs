import { createHash } from 'node:crypto';
export function fingerprint(diagnostic) {
    return createHash('sha256').update(JSON.stringify([diagnostic.path.replaceAll('\\', '/'), diagnostic.rule, diagnostic.source.trim().replace(/\s+/g, ' '), diagnostic.message])).digest('hex');
}
export function makeBaseline(diagnostics, metadata = {}) {
    const entries = {};
    for (const d of diagnostics) {
        const key = fingerprint(d);
        entries[key] ??= { ...d, count: 0 };
        entries[key].count++;
    }
    return { version: 1, metadata, entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) };
}
export function compareBaseline(diagnostics, baseline) {
    if (baseline?.version !== 1 || !baseline.entries)
        throw new Error('Invalid governance baseline');
    const remaining = new Map(Object.entries(baseline.entries).map(([key, d]) => {
        if (fingerprint(d) !== key || !Number.isInteger(d.count) || d.count < 1)
            throw new Error('Invalid baseline fingerprint/count');
        return [key, d.count];
    }));
    return diagnostics.filter(d => { const key = fingerprint(d); const count = remaining.get(key) ?? 0; if (!count)
        return true; remaining.set(key, count - 1); return false; });
}
export function requireMatchingMetadata(baseline, metadata) {
    if (baseline && JSON.stringify(baseline.metadata) !== JSON.stringify(metadata))
        throw new Error('Baseline configuration/tool mismatch; review scope and explicitly refresh baseline');
}
