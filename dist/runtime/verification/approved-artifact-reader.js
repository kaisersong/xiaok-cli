import { extractSingleArtifact } from '../isolated-execution/artifact-export.js';
import { canonicalVerificationJson as json } from './protocol.js';
const artifactReaders = new WeakMap();
/** Identity only; approval/physical receipts remain the original reader gates. */
export function assertApprovedRecipeArtifactReader(value, raw) { const facts = artifactReaders.get(value); if (!facts || facts.raw !== raw)
    throw Error('recipe_artifact_identity'); if (facts.closed)
    throw Error('recipe_artifact_closed'); }
/** Private installed recipe read port. Registered objects must originate from the
 * actual raw runner and physical authority, not a public result DTO. */
export function createApprovedRecipeArtifactReader(input) {
    const readCaptured = input.raw.readCapturedOutput.bind(input.raw), readArchive = input.raw.readArchive.bind(input.raw), physical = input.quiescence.assertQuiescent.bind(input.quiescence), approved = input.readApprovedRecipeBinding;
    const outputs = new Map(), identity = { raw: input.raw, closed: false };
    function current() { if (identity.closed)
        throw Error('recipe_artifact_closed'); }
    function sync(value) { if (value !== undefined) {
        void Promise.resolve(value).catch(() => { });
        throw Error('recipe_artifact_sync');
    } }
    function approval(binding) { current(); const value = approved(binding); if (!value || typeof value.then === 'function') {
        void Promise.resolve(value).catch(() => { });
        throw Error('recipe_artifact_approval');
    } if (json(value.attempt.expected) !== json(binding.expected))
        throw Error('recipe_artifact_binding'); return JSON.parse(json(value)); }
    const result = Object.freeze({
        registerActualOutput(raw) {
            current();
            const { output, receipt } = raw, expected = Object.freeze(JSON.parse(json(raw.expected))), key = json(expected);
            sync(physical(receipt, expected));
            readCaptured(output, { expected });
            const old = outputs.get(key);
            if (old) {
                if (old.output !== output || old.receipt !== receipt)
                    throw Error('recipe_artifact_original_conflict');
                return;
            }
            if (outputs.size >= 4096)
                throw Error('recipe_artifact_capacity');
            outputs.set(key, { expected, output, receipt });
        },
        async readArtifact(rawBinding, path, limits) {
            const binding = JSON.parse(json(rawBinding)), maxBytes = limits?.maxBytes ?? 16 * 1024 ** 2;
            if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 16 * 1024 ** 2)
                throw Error('recipe_artifact_limit');
            const original = approval(binding), spec = original.recipe, allowed = spec.kind === 'artifact-content' ? spec.checks.map(c => c.path) : spec.kind === 'diagnostic-coverage' ? ('sources' in spec ? spec.sources.map(s => s.diagnosisPath) : [spec.diagnosisPath]) : [];
            if (!allowed.includes(path))
                throw Error('recipe_artifact_path');
            const key = json(binding.expected), record = outputs.get(key);
            if (!record)
                throw Error('recipe_artifact_missing');
            sync(physical(record.receipt, record.expected));
            const archive = await readArchive(record.output, path, { expected: record.expected, maxBytes });
            current();
            if (outputs.get(key) !== record || json(approval(binding)) !== json(original))
                throw Error('recipe_artifact_binding');
            sync(physical(record.receipt, record.expected));
            const bytes = extractSingleArtifact(archive, path);
            if (bytes.length > maxBytes)
                throw Error('recipe_artifact_limit');
            return bytes;
        },
        forgetOutput(expected) { current(); outputs.delete(json(expected)); },
        close() { identity.closed = true; outputs.clear(); },
    });
    artifactReaders.set(result, identity);
    return result;
}
