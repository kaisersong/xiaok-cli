import { existsSync, readFileSync } from 'node:fs';
import { computeBaselineHash } from './baseline.js';
import { diagnoseTraceBundle } from '../diagnostics/diagnoser.js';
import { validateTraceBundle } from '../trace/schema.js';
export function validateAheLiteEvalResult(input, options) {
    const errors = [];
    if (!isRecord(input))
        return { ok: false, errors: ['evalResult'] };
    const traceBundlePath = typeof input.traceBundlePath === 'string' ? input.traceBundlePath : '';
    let bundle = null;
    if (!traceBundlePath || !existsSync(traceBundlePath)) {
        errors.push('traceBundlePath');
    }
    else {
        try {
            bundle = JSON.parse(readFileSync(traceBundlePath, 'utf8'));
            const validation = validateTraceBundle(bundle);
            if (!validation.ok)
                errors.push(...validation.errors.map((error) => `trace:${error}`));
        }
        catch {
            errors.push('traceBundlePath:json');
        }
    }
    if (bundle) {
        const report = diagnoseTraceBundle(bundle);
        const evidenceIds = Array.isArray(input.evidenceIds) ? input.evidenceIds.map(String) : [];
        evidenceIds.forEach((id, index) => {
            if (!resolveEvidenceId(bundle, id))
                errors.push(`evidenceIds[${index}]:${id}`);
        });
        const expectedPrimary = report.primaryFinding ? findingSignature(report.primaryFinding.category, report.primaryFinding.evidenceIds[0]) : '';
        if (input.primaryFinding !== expectedPrimary)
            errors.push(`primaryFinding:${String(input.primaryFinding)}`);
        if (input.actualFailureCategory !== report.primaryFinding?.category) {
            errors.push(`actualFailureCategory:${String(input.actualFailureCategory)}`);
        }
    }
    if (!existsSync(options.baselinePath)) {
        errors.push('baselinePath');
    }
    else {
        const baseline = JSON.parse(readFileSync(options.baselinePath, 'utf8'));
        if (input.baselineHash !== computeBaselineHash(baseline))
            errors.push('baselineHash');
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
function findingSignature(category, evidenceId) {
    const suffix = evidenceId?.startsWith('task:') ? evidenceId.slice('task:'.length) : evidenceId;
    return suffix ? `${category}:${suffix}` : category;
}
function resolveEvidenceId(bundle, evidenceId) {
    const [kind, id] = evidenceId.split(':', 2);
    if (!kind || !id)
        return false;
    if (kind === 'task')
        return bundle.tasks.some((task) => task.id === id);
    if (kind === 'tool')
        return bundle.toolCalls.some((tool) => tool.id === id);
    if (kind === 'artifact')
        return bundle.artifacts.some((artifact) => artifact.id === id);
    if (kind === 'event')
        return bundle.events.some((event) => event.id === id);
    return false;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
