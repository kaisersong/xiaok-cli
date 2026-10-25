import { readPublishedArtifact } from './published-artifact-reader.js';
import { readInstalledCurrentOwner } from './installed-owner-state.js';
import { createInstalledVerificationClient } from './controller-client.js';
import { createPublicationClient } from './publication-client.js';
import { canonicalVerificationJson as json } from './protocol.js';
/** Fixed installed publisher, with no endpoint/profile/key override. This cannot
 * project a completion into a caller-owned legacy store. */
export function createInstalledCompletionPublisher(raw, requestSource) {
    const requested = JSON.parse(json(raw)), route = readInstalledCurrentOwner(requested);
    if (route.kind !== 'migrated' && route.kind !== 'protected-unregistered')
        throw Error('publication_installed_owner_unavailable');
    const original = json(route), owner = route.owner, client = createInstalledVerificationClient();
    let closed = false;
    function current() { if (closed || json(readInstalledCurrentOwner(requested)) !== original)
        throw Error('publication_installed_owner_changed'); }
    try {
        const publication = createPublicationClient({ owner, requestSource, transport: client.publicationTransport });
        return Object.freeze({
            async readArtifact(observation, selection, signal) { current(); const payload = await publication.readPayload(observation, signal); current(); const artifact = readPublishedArtifact(payload, selection); signal?.throwIfAborted(); current(); return artifact; },
            async readPayload(observation, signal) { current(); const result = await publication.readPayload(observation, signal); current(); return result; },
            async observe(signal) { current(); const result = await publication.observe(signal); current(); return result; },
            async prepare(signal) { current(); const result = await publication.prepare(signal); current(); return result; },
            async prepareRequest(requestId, signal) { current(); const result = await publication.prepareRequest(requestId, signal); current(); return result; },
            async lookupRequest(requestId, signal) { current(); const result = await publication.lookupRequest(requestId, signal); current(); return result; },
            async recoverRequest(requestId, signal) { current(); const result = await publication.recoverRequest(requestId, signal); current(); return result; },
            async approve(ticket, signal) { current(); const result = await publication.approve(ticket, signal); current(); return result; },
            async reconcile(record, signal) { current(); const result = await publication.reconcile(record, signal); current(); return result; },
            async recoverExpired(record, signal) { current(); const result = await publication.recoverExpired(record, signal); current(); return result; },
            dispose() { if (!closed) {
                closed = true;
                client.dispose();
            } },
        });
    }
    catch (error) {
        client.dispose();
        throw error;
    }
}
