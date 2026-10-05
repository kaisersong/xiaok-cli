import { readInstalledCurrentOwner } from '../verification/installed-owner-state.js';
import { createInstalledVerificationClient } from '../verification/controller-client.js';
import { parseLoopApplicationBinding } from '../verification/loop-application-binding.js';
import { parseActiveBusinessApplicationBinding } from '../verification/business-application-binding.js';
import { loopHostSubjectOwner } from '../verification/loop-host-subject.js';
import { canonicalVerificationJson as json } from '../verification/protocol.js';
const negativeReads = new WeakSet();
function notCurrent(message) { const error = Error(message); negativeReads.add(error); return error; }
/** Only local currentness checks are branded; malformed or failed RPCs are not. */
export function isLoopPublicationSetNotCurrent(error) { return error instanceof Error && negativeReads.has(error); }
function shape(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.sort().join(','))
    throw Error('loop_publication_set_shape'); }
function id(v) { if (typeof v !== 'string' || !v || Buffer.byteLength(v) > 160 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('loop_publication_set_identity'); }
function integer(v, min = 0) { if (!Number.isSafeInteger(v) || v < min)
    throw Error('loop_publication_set_number'); }
function hash(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    throw Error('loop_publication_set_hash'); }
/** Parse the exact retained response for an independently supplied owner and
 * application set. This pure declaration parser does not inspect current routes. */
export function parseLoopPublicationSetObservation(response, raw, expectedOwners) {
    const values = JSON.parse(json(raw));
    if (!Array.isArray(values) || values.length < 1 || values.length > 3)
        throw Error('loop_publication_set');
    const bindings = values.map(parseLoopApplicationBinding), expected = JSON.parse(json(expectedOwners));
    if (!Array.isArray(expected) || expected.length !== bindings.length || new Set(bindings.map(b => json(loopHostSubjectOwner(b.subject)))).size !== bindings.length || bindings.some(b => b.subject.loopId !== bindings[0].subject.loopId || b.subject.runId !== bindings[0].subject.runId))
        throw Error('loop_publication_set');
    expected.forEach((owner, i) => { shape(owner, ['profileId', 'ownerKind', 'ownerId']); id(owner.profileId); id(owner.ownerId); const subjectOwner = loopHostSubjectOwner(bindings[i].subject); if (owner.ownerKind !== subjectOwner.ownerKind || owner.ownerId !== subjectOwner.ownerId || owner.profileId !== expected[0].profileId)
        throw Error('loop_publication_set_owner'); });
    const value = JSON.parse(json(response));
    shape(value, ['clock', 'publications']);
    shape(value.clock, ['domainId', 'qualificationEpoch', 'lowerBound', 'upperBound', 'evidenceHash']);
    id(value.clock.domainId);
    hash(value.clock.evidenceHash);
    for (const k of ['qualificationEpoch', 'lowerBound', 'upperBound'])
        integer(value.clock[k]);
    if (value.clock.upperBound < value.clock.lowerBound)
        throw Error('loop_publication_set_clock');
    if (!Array.isArray(value.publications) || value.publications.length !== bindings.length)
        throw Error('loop_publication_set_inventory');
    const publications = value.publications.map((p, i) => {
        shape(p, ['owner', 'businessRevision', 'operationId', 'fullTupleHash', 'application']);
        if (json(p.owner) !== json(expected[i]))
            throw Error('loop_publication_set_owner');
        integer(p.businessRevision, 1);
        id(p.operationId);
        hash(p.fullTupleHash);
        const application = parseActiveBusinessApplicationBinding(p.application);
        if (application.binding.kind !== 'loop' || json(application.binding) !== json(bindings[i]))
            throw Error('loop_publication_set_application');
        return Object.freeze({ ...p, owner: Object.freeze(expected[i]), application });
    });
    return Object.freeze({ clock: Object.freeze(value.clock), publications: Object.freeze(publications) });
}
/** Same-authority-time observation of this exact requested set. It does not
 * prove the requested inventory is complete, read payload bytes, or grant any
 * business mutation. The authority clock cannot be compared with Main wall time. */
export async function readCurrentLoopPublicationSet(raw, signal) {
    const values = JSON.parse(json(raw));
    if (!Array.isArray(values) || values.length < 1 || values.length > 3)
        throw Error('loop_publication_set');
    const bindings = values.map(parseLoopApplicationBinding), owners = bindings.map(b => loopHostSubjectOwner(b.subject));
    if (new Set(owners.map(o => json(o))).size !== owners.length || bindings.some(b => b.subject.loopId !== bindings[0].subject.loopId || b.subject.runId !== bindings[0].subject.runId))
        throw Error('loop_publication_set');
    signal?.throwIfAborted();
    const routes = owners.map(o => readInstalledCurrentOwner(o));
    const first = routes[0];
    if (first.kind !== 'migrated' && first.kind !== 'protected-unregistered')
        throw notCurrent('loop_publication_set_route');
    const expected = routes.map(r => { if ((r.kind !== 'migrated' && r.kind !== 'protected-unregistered') || r.authorityId !== first.authorityId || r.owner.profileId !== first.owner.profileId)
        throw notCurrent('loop_publication_set_route'); return JSON.parse(json(r.owner)); });
    const routeKeys = routes.map(r => json(r)), deadline = new AbortController(), active = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    const timer = setTimeout(() => deadline.abort(Error('loop_publication_set_timeout')), 10000);
    let client;
    function current() { active.throwIfAborted(); if (owners.some((o, i) => json(readInstalledCurrentOwner(o)) !== routeKeys[i]))
        throw notCurrent('loop_publication_set_route_changed'); }
    try {
        client = createInstalledVerificationClient();
        current();
        // Preserve the actual transport lifetime through cancellation, as for each
        // payload read. A timeout fences the result; it cannot certify shutdown drain.
        let response;
        try {
            response = await client.publicationTransport.call('publication.observeLoopSet', { owners }, active);
        }
        catch (error) {
            active.throwIfAborted();
            throw error;
        }
        current();
        return parseLoopPublicationSetObservation(response, bindings, expected);
    }
    finally {
        clearTimeout(timer);
        client?.dispose();
    }
}
