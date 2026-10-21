import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
const hash = (x) => createHash('sha256').update(x).digest('hex');
function frozen(value) { const v = JSON.parse(json(value)); const visit = (x) => { if (x && typeof x === 'object') {
    Object.values(x).forEach(visit);
    Object.freeze(x);
} }; visit(v); return v; }
const capacityLineage = new WeakMap();
export function readApprovedBlackboxCapacityLineage(plan) { return capacityLineage.get(plan)?.(); }
export function createApprovedBlackboxStager(input) {
    const getOriginal = input.stager.getManifest.bind(input.stager), readOriginal = input.stager.readFile.bind(input.stager), approved = input.readApprovedRecipeBinding;
    const cases = new WeakMap();
    let closed = false;
    function current() { if (closed)
        throw Error('blackbox_stager_closed'); }
    function originalApproval(binding) { current(); const value = approved(binding); if (!value || typeof value.then === 'function') {
        void Promise.resolve(value).catch(() => { });
        throw Error('blackbox_stager_approval');
    } if (json(value.attempt.expected) !== json(binding.expected))
        throw Error('blackbox_stager_binding'); return frozen(value); }
    function record(plan) { current(); const r = cases.get(plan); if (!r)
        throw Error('blackbox_stager_case_identity'); if (json(originalApproval(r.binding)) !== r.approval || json(getOriginal(r.originalPlan)) !== r.original)
        throw Error('blackbox_stager_original_changed'); return r; }
    return Object.freeze({
        prepareCase(raw) {
            current();
            const originalPlan = raw.originalPlan, binding = frozen(raw.binding), caseId = raw.caseId, caseInvocationId = raw.caseInvocationId, provided = raw.input;
            if (!Buffer.isBuffer(provided) || provided.length > 2 * 1024 ** 2 || typeof caseInvocationId !== 'string' || !caseInvocationId || caseInvocationId.length > 160 || /[\x00-\x1f\x7f]/.test(caseInvocationId) || caseInvocationId === binding.expected.validationInvocationId)
                throw Error('blackbox_stager_case');
            const bytes = Buffer.from(provided), approval = originalApproval(binding), original = frozen(getOriginal(originalPlan));
            if (approval.recipe.kind !== 'blackbox')
                throw Error('blackbox_stager_recipe');
            const test = approval.recipe.cases.find(c => c.id === caseId);
            if (!test || !bytes.equals(Buffer.from(test.inputBase64, 'base64')))
                throw Error('blackbox_stager_case_input');
            const invocation = { sessionIdentity: binding.expected.sessionIdentity, compoundOperationId: binding.expected.compoundOperationId, validationInvocationId: binding.expected.validationInvocationId };
            if (json(original.invocation) !== json(invocation) || original.scopeDigest !== binding.expected.scopeDigest || original.stdin)
                throw Error('blackbox_stager_original_scope');
            const descriptor = { sha256: hash(bytes), bytes: bytes.length }, scopeDigest = hash(json({ originalScope: original.scopeDigest, recipeHash: hash(json(approval.recipe)), binding, caseId, caseInvocationId, stdin: descriptor }));
            const manifest = frozen({ ...original, invocation: { ...original.invocation, validationInvocationId: caseInvocationId }, scopeDigest, stdin: descriptor }), plan = Object.freeze({});
            if (json(originalApproval(binding)) !== json(approval) || json(getOriginal(originalPlan)) !== json(original))
                throw Error('blackbox_stager_original_changed');
            cases.set(plan, { originalPlan, binding, approval: json(approval), original: json(original), manifest, bytes });
            capacityLineage.set(plan, () => { const actual = record(plan); return Object.freeze({ originalPlan: actual.originalPlan, scopeDigest: actual.manifest.scopeDigest }); });
            return plan;
        },
        getManifest(plan) { current(); return cases.has(plan) ? record(plan).manifest : getOriginal(plan); },
        readFile(plan, path) { current(); if (!cases.has(plan))
            return readOriginal(plan, path); const r = record(plan); if (!r.manifest.files.some(f => f.path === path))
            throw Error('blackbox_stager_file'); const bytes = readOriginal(r.originalPlan, path); record(plan); return bytes; },
        readStdin(plan) { const r = record(plan); return Buffer.from(r.bytes); },
        close() { closed = true; },
    });
}
