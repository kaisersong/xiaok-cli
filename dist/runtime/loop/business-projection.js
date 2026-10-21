import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
import { freezeLoopPublicationValue } from './publication-config.js';
export function loopProjectionHash(value) { return createHash('sha256').update('loop-business-projection-v1\0').update(json(value)).digest('hex'); }
export function freezeProjection(value) { return freezeLoopPublicationValue(JSON.parse(json(value))); }
export function projectedLoopRows(before, now) {
    if (!Number.isSafeInteger(now) || now < before.run.updated_at || before.run.status !== 'running' || before.stages.some(s => s.status !== 'running' || now < s.updated_at) || before.members.some(m => m.status !== 'staged'))
        throw Error('loop_projection_original_state');
    return { run: { ...before.run, status: 'success', finished_at: now, updated_at: now, failure_kind: null, message: null },
        stages: before.stages.map(s => ({ ...s, status: 'success', finished_at: now, updated_at: now, failure_kind: null, message: null })), members: before.members.map(m => ({ ...m, status: 'pending' })) };
}
export function validateLoopProjectionOrigin(origin) {
    if (json(projectedLoopRows(origin.before, origin.after.run.updated_at)) !== json(origin.after))
        throw Error('loop_projection_origin_transition');
}
const decisionFields = ['status', 'target_kind', 'target_id', 'accepted_target_ref', 'decided_at'];
/** Interpret only an exact originally projected row. Decisions may overlay an
 * original member, but can never change its immutable business contents. */
export function normalizeLoopProjectionRows(current, origin) {
    validateLoopProjectionOrigin(origin);
    const rows = JSON.parse(json(current));
    if (json(rows.run) !== json(origin.after.run) || json(rows.stages) !== json(origin.after.stages) || rows.members.length !== origin.after.members.length)
        throw Error('loop_projection_rows_changed');
    for (let i = 0; i < rows.members.length; i++)
        assertLoopProjectedMember(rows.members[i], origin.after.members[i]);
    return JSON.parse(json(origin.before));
}
/** The exact ordinary decision overlay used by the full projector and captured
 * row reader. It neither mutates the source row nor establishes current proof. */
export function assertLoopProjectedMember(current, after) {
    const actual = JSON.parse(json(current));
    if (!['pending', 'accepting', 'accepted', 'accept_failed', 'rejected'].includes(actual.status))
        throw Error('loop_projection_decision');
    if (actual.status === 'accepted' && (!actual.target_kind || !actual.target_id || !actual.accepted_target_ref || actual.decided_at === null))
        throw Error('loop_projection_decision');
    if (actual.status !== 'pending' && actual.decided_at === null)
        throw Error('loop_projection_decision');
    for (const field of decisionFields)
        actual[field] = after[field];
    if (json(actual) !== json(after))
        throw Error('loop_projection_member_changed');
}
