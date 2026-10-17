import { assertVerificationCompletionDatabase } from './completion-composition.js';
import { assertMaterialDeadline } from './material-deadline.js';
import { canonicalVerificationJson as json } from './protocol.js';
const databases = new WeakMap();
export function assertApprovedSourceCapabilitiesDatabase(caps, database) { const known = databases.get(caps); if (!known || known.database !== database)
    throw Error('source_capability_database'); known.assertCurrent(); }
const copy = (value) => JSON.parse(json(value));
/** Private source read capabilities. Native committed exact entries authorize old
 * archives; candidate material grants do not. Never expose the issuer on RPC. */
export function createApprovedSourceCapabilities(input) {
    const db = input.database, host = input.completion, clock = input.clock.bind(input), wall = input.wallNow?.bind(input) ?? Date.now;
    assertVerificationCompletionDatabase(host, db);
    const starts = new WeakMap(), reads = new WeakMap();
    let closed = false;
    function current() { if (closed)
        throw Error('source_capability_closed'); assertVerificationCompletionDatabase(host, db); }
    // No inspectOwner/readApprovedRecipe call here: this also runs inside the
    // authority's scope guard, where recursive proof inspection is forbidden.
    function snapshot(owner, obligationId) {
        current();
        const key = json(owner), profile = db.prepare("SELECT p.uid,p.account_id,p.profile_id FROM verification_registered_owners o JOIN verification_profiles p ON p.uid=o.uid WHERE o.owner_key=? AND o.state='active' AND p.state='active' AND p.profile_id=?").get(key, owner.profileId);
        if (!profile)
            throw Error('source_capability_owner');
        const intent = db.prepare('SELECT registration_json,committed FROM owner_enrollment_intents WHERE logical_owner_key=?').get(json({ uid: profile.uid, accountGeneration: profile.account_id.toUpperCase(), ownerKind: owner.ownerKind, ownerId: owner.ownerId }));
        const actual = db.prepare('SELECT migration_epoch,epoch,pending FROM verification_owners WHERE owner_key=?').get(key);
        if (!intent || intent.committed !== 1 || !actual || actual.pending)
            throw Error('source_capability_owner');
        const registration = JSON.parse(intent.registration_json), entries = registration.obligations.filter((item) => item.obligation.obligationId === obligationId), mandatory = db.prepare('SELECT definition_json FROM mandatory_observation_checks WHERE owner_key=? AND obligation_id=?').get(key, obligationId);
        if (entries.length !== 1 || !mandatory || actual.migration_epoch !== registration.migrationEpoch || json(entries[0].obligation) !== mandatory.definition_json)
            throw Error('source_capability_entry');
        return json({ profile, owner, entry: entries[0], source: registration.source, migrationEpoch: actual.migration_epoch, epoch: actual.epoch });
    }
    function check(record) { assertMaterialDeadline(record.deadline, { wallNow: wall(), clock: clock() }); if (snapshot(record.owner, record.obligationId) !== record.snapshot)
        throw Error('source_capability_changed'); }
    const result = Object.freeze({
        issueStart(raw) {
            current();
            const proposal = copy(raw);
            host.enrollment.readApprovedRecipe(proposal.owner, proposal.obligationId);
            const record = { ...proposal, snapshot: snapshot(proposal.owner, proposal.obligationId) };
            check(record);
            if (host.enrollment.resolveOwnerKey(record.peer, record.invocation) !== json(record.owner))
                throw Error('source_start_owner');
            const cap = Object.freeze({});
            starts.set(cap, record);
            return cap;
        },
        assertStart(proposal, authorization) {
            current();
            const record = starts.get(authorization);
            if (!record)
                throw Error('source_start_identity');
            check(record);
            if (proposal.ownerKey !== json(record.owner) || json(proposal.rootInvocation) !== json(record.invocation) || host.enrollment.resolveOwnerKey(record.peer, record.invocation) !== json(record.owner))
                throw Error('source_start_binding');
            check(record);
        },
        issueRead(raw) {
            current();
            const proposal = copy(raw), recipe = host.enrollment.readApprovedRecipe(proposal.owner, proposal.obligationId);
            if (recipe.kind !== 'diagnostic-coverage')
                throw Error('source_capability_unapproved');
            const { kind: _kind, ...single } = recipe;
            const sources = 'sources' in recipe ? recipe.sources : [single];
            if (!sources.some(source => json(source) === json(proposal.source)))
                throw Error('source_capability_unapproved');
            const record = { ...proposal, snapshot: snapshot(proposal.owner, proposal.obligationId) };
            check(record);
            const cap = Object.freeze({});
            reads.set(cap, record);
            return cap;
        },
        assertRead(facts, authorization) {
            current();
            const record = reads.get(authorization);
            if (!record)
                throw Error('source_capability_identity');
            check(record);
            const source = record.source;
            if (facts.ownerKey !== json(record.owner) || facts.sourceRunId !== source.sourceRunId || facts.runNonce !== source.runNonce || facts.archiveHash !== source.archiveHash || facts.scope !== (source.sourceScope ?? 'isolated-execution'))
                throw Error('source_capability_binding');
            check(record);
        },
        close() { closed = true; },
    });
    databases.set(result, { database: db, assertCurrent: current });
    return result;
}
