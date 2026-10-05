const FIELDS = ['authorityId', 'profileId', 'sourceSessionId', 'ownerAgentId', 'scopeId', 'permissionGeneration',
    'observationId', 'contentHash', 'revision', 'policyId', 'policyRevision'];
function invalid() { throw new Error('protected_observation_closure_invalid'); }
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid();
    return value;
}
function normalize(value) {
    if (value === undefined)
        return undefined;
    const closure = record(value);
    if (Object.keys(closure).length !== 3 || closure.version !== 1 || closure.requiresReauthorization !== true
        || !Array.isArray(closure.observations) || closure.observations.length > 4096)
        invalid();
    const observations = closure.observations.map(value => {
        const item = record(value);
        if (Object.keys(item).length !== FIELDS.length || FIELDS.some(field => !Object.hasOwn(item, field)))
            invalid();
        for (const field of FIELDS) {
            const value = item[field];
            if (field === 'permissionGeneration' || field === 'revision' || field === 'policyRevision') {
                if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (field === 'permissionGeneration' ? 0 : 1))
                    invalid();
            }
            else if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value))
                invalid();
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.authorityId)
            || !/^[0-9a-f]{64}$/.test(item.contentHash))
            invalid();
        return Object.fromEntries(FIELDS.map(field => [field, item[field]]));
    });
    return { version: 1, requiresReauthorization: true, observations };
}
/** Monotonic union. An absent incoming marker cannot erase a previously protected history. */
export function mergeProtectedObservationClosures(previous, incoming) {
    const old = normalize(previous), next = normalize(incoming);
    if (!old && !next)
        return undefined;
    const merged = new Map();
    const profiles = new Map();
    for (const reference of [...(old?.observations ?? []), ...(next?.observations ?? [])]) {
        const profile = profiles.get(reference.authorityId);
        if (profile !== undefined && profile !== reference.profileId)
            invalid();
        profiles.set(reference.authorityId, reference.profileId);
        const key = `${reference.authorityId}\0${reference.observationId}`;
        const existing = merged.get(key);
        if (existing && FIELDS.some(field => existing[field] !== reference[field]))
            throw new Error('protected_observation_reference_conflict');
        merged.set(key, reference);
    }
    if (merged.size > 4096)
        invalid();
    return { version: 1, requiresReauthorization: true, observations: [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value) };
}
