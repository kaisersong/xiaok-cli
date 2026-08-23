/**
 * SkillRootPlan + collision reducer (design v58 §4.4; R47-01, R48-02, R49-01).
 *
 * Why this exists: `loadSkills()` resolves roots as builtin+extra → global →
 * project and then de-duplicates with `map.set(name)` (last write wins) while
 * alias lookup is first-match. Those two rules disagree, so whether a
 * third-party skill or a trusted bundled skill wins depends on enumeration
 * order. A trusted provider gateway must never be shadowed by accident, and a
 * third-party skill must never impersonate a capability the consumer does not
 * even load (KSwarm deliberately has no CUA gateway).
 *
 * The reducer therefore:
 *  - takes a fully materialised plan (explicit-plan-only: no implicit appending
 *    of builtin/global/project by a lower layer);
 *  - freezes nonreserved priority as project > global > plugin/extra > builtin,
 *    then normalised absolute root path, then relative entry path;
 *  - treats reserved skills as an uncontestable set per consumer, including a
 *    deny-reservation for skills the consumer does not load;
 *  - fails closed when two reserved skills collide, and skips (never merges) a
 *    nonreserved skill that collides with a reserved name or alias.
 */
/** Lower number wins. Frozen by design; not configurable per call site. */
export const NONRESERVED_PRIORITY = Object.freeze({
    project: 0,
    global: 1,
    plugin: 2,
    builtin: 3,
});
export class TrustedSkillContractConflictError extends Error {
    key;
    paths;
    code = 'trusted_skill_contract_conflict';
    constructor(key, paths) {
        super(`trusted_skill_contract_conflict: ${key} declared by ${paths.join(' and ')}`);
        this.key = key;
        this.paths = paths;
        this.name = 'TrustedSkillContractConflictError';
    }
}
function keysOf(candidate) {
    return [candidate.name, ...candidate.aliases];
}
function comparePriority(a, b) {
    const pa = NONRESERVED_PRIORITY[a.provenance] ?? 99;
    const pb = NONRESERVED_PRIORITY[b.provenance] ?? 99;
    if (pa !== pb)
        return pa - pb;
    if (a.rootPath !== b.rootPath)
        return a.rootPath < b.rootPath ? -1 : 1;
    if (a.relativePath !== b.relativePath)
        return a.relativePath < b.relativePath ? -1 : 1;
    return 0;
}
/**
 * The single production reducer. Reversing root or entry enumeration order must
 * not change its output, which is what the tests assert.
 */
export function reduceSkillPlan(plan, candidates) {
    const diagnostics = [];
    const planRoots = new Set(plan.roots.map((r) => r.path));
    const inPlan = candidates.filter((c) => planRoots.has(c.rootPath));
    // 1. Reserved skills form an uncontestable set; two of them colliding is a
    //    contract bug that must stop startup rather than pick a winner.
    const reserved = inPlan
        .filter((c) => c.provenance === 'reserved' && plan.reservedLoaded.includes(c.name))
        .sort(comparePriority);
    const reservedKeyOwner = new Map();
    for (const candidate of reserved) {
        for (const key of keysOf(candidate)) {
            const existing = reservedKeyOwner.get(key);
            if (existing && existing !== candidate) {
                throw new TrustedSkillContractConflictError(key, [existing.relativePath, candidate.relativePath]);
            }
            reservedKeyOwner.set(key, candidate);
        }
    }
    // 2. Names/aliases this consumer refuses to let anyone else claim, even though
    //    it does not load the skill itself.
    const deniedKeys = new Set(plan.reservedDenied);
    // 3. Nonreserved candidates in frozen priority order.
    const accepted = [...reserved];
    const claimed = new Map(reservedKeyOwner);
    const nonReserved = inPlan
        .filter((c) => c.provenance !== 'reserved')
        .sort(comparePriority);
    for (const candidate of nonReserved) {
        const keys = keysOf(candidate);
        const deniedHit = keys.find((k) => deniedKeys.has(k));
        if (deniedHit !== undefined) {
            diagnostics.push({
                code: 'denied_reserved_skill_impersonation',
                path: candidate.relativePath,
                key: deniedHit,
                consumer: plan.consumer,
            });
            continue;
        }
        const reservedHit = keys.find((k) => reservedKeyOwner.has(k));
        if (reservedHit !== undefined) {
            diagnostics.push({
                code: 'reserved_skill_name_conflict',
                path: candidate.relativePath,
                key: reservedHit,
                provenance: candidate.provenance,
                consumer: plan.consumer,
            });
            continue;
        }
        const legacyHit = keys.find((k) => claimed.has(k));
        if (legacyHit !== undefined) {
            const winner = claimed.get(legacyHit);
            diagnostics.push({
                code: 'legacy_skill_name_conflict',
                winner: winner.relativePath,
                loser: candidate.relativePath,
                key: legacyHit,
            });
            continue;
        }
        for (const key of keys)
            claimed.set(key, candidate);
        accepted.push(candidate);
    }
    return { skills: Object.freeze(accepted), diagnostics: Object.freeze(diagnostics) };
}
/** Guards the explicit-plan-only rule: no consumer may hide a root population. */
export function assertPlanIsClosed(plan, expected) {
    const present = new Set(plan.roots.map((r) => r.provenance));
    const missing = expected.filter((p) => !present.has(p));
    if (missing.length > 0) {
        throw new Error(`skill_root_plan_incomplete: missing provenance ${missing.join(', ')}`);
    }
}
