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
export type SkillProvenance = 'builtin' | 'reserved' | 'plugin' | 'global' | 'project';
export type SkillConsumer = 'main' | 'settings' | 'agent' | 'kswarm';
/** Lower number wins. Frozen by design; not configurable per call site. */
export declare const NONRESERVED_PRIORITY: Record<Exclude<SkillProvenance, 'reserved'>, number>;
export interface SkillRootEntry {
    readonly path: string;
    readonly provenance: SkillProvenance;
}
export interface SkillCandidate {
    readonly name: string;
    readonly aliases: readonly string[];
    /** Normalised path of the skill file/dir, used as the stable tiebreaker. */
    readonly relativePath: string;
    readonly rootPath: string;
    readonly provenance: SkillProvenance;
}
export interface SkillRootPlan {
    readonly consumer: SkillConsumer;
    readonly roots: readonly SkillRootEntry[];
    /**
     * Reserved skill names this consumer loads. Their names and aliases become an
     * uncontestable set.
     */
    readonly reservedLoaded: readonly string[];
    /**
     * Reserved names this consumer deliberately does NOT load but still reserves,
     * so nothing can impersonate them (KSwarm ↔ CUA).
     */
    readonly reservedDenied: readonly string[];
}
export type SkillPlanDiagnostic = {
    code: 'reserved_skill_name_conflict';
    path: string;
    key: string;
    provenance: SkillProvenance;
    consumer: SkillConsumer;
} | {
    code: 'legacy_skill_name_conflict';
    winner: string;
    loser: string;
    key: string;
} | {
    code: 'denied_reserved_skill_impersonation';
    path: string;
    key: string;
    consumer: SkillConsumer;
};
export declare class TrustedSkillContractConflictError extends Error {
    readonly key: string;
    readonly paths: readonly string[];
    readonly code = "trusted_skill_contract_conflict";
    constructor(key: string, paths: readonly string[]);
}
export interface SkillPlanResult {
    readonly skills: readonly SkillCandidate[];
    readonly diagnostics: readonly SkillPlanDiagnostic[];
}
/**
 * The single production reducer. Reversing root or entry enumeration order must
 * not change its output, which is what the tests assert.
 */
export declare function reduceSkillPlan(plan: SkillRootPlan, candidates: readonly SkillCandidate[]): SkillPlanResult;
/** Guards the explicit-plan-only rule: no consumer may hide a root population. */
export declare function assertPlanIsClosed(plan: SkillRootPlan, expected: readonly SkillProvenance[]): void;
