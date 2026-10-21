import { createHash } from 'node:crypto';
import { parseArchiveReadResource, parseArchiveDeleteResource } from './archive-operation-review.js';
import { canonicalVerificationJson as json } from './protocol.js';
function object(value, keys) { const parsed = JSON.parse(json(value)); if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== keys.sort().join(','))
    throw Error('archive_client_response'); return parsed; }
/** Explicit host read, never an agent tool. No output is returned until every
 * ordered page and the complete original content hash have been verified. */
export async function readUserArchive(transport, input, signal) {
    const request = JSON.parse(json(input));
    if (request.requestSource !== 'user')
        throw Error('archive_request_source');
    const call = transport.call.bind(transport);
    let handle, complete = false;
    try {
        const challenge = object(await call('archive.prepare', { ...request, action: 'read' }, signal), ['challengeId', 'validUntil', 'resourceKind']);
        if (typeof challenge.challengeId !== 'string' || !challenge.challengeId || challenge.resourceKind !== request.resource.kind || !Number.isSafeInteger(challenge.validUntil))
            throw Error('archive_client_challenge');
        const grant = object(await call('archive.authorize', { challengeId: challenge.challengeId }, signal), ['handle', 'resource', 'validUntil']);
        if (typeof grant.handle !== 'string' || !/^[a-f0-9]{64}$/.test(grant.handle))
            throw Error('archive_client_handle');
        handle = grant.handle;
        if (grant.validUntil !== challenge.validUntil)
            throw Error('archive_client_deadline');
        const resource = parseArchiveReadResource(grant.resource);
        if (resource.kind !== request.resource.kind || (resource.kind === 'transcript' ? resource.resourceId : resource.sourceRunId) !== request.resource.id)
            throw Error('archive_client_resource');
        const specs = resource.kind === 'transcript' ? { stdout: resource.stdout, stderr: resource.stderr } : { archive: { size: resource.archiveBytes, sha256: resource.archiveHash } }, streams = {};
        for (const [stream, spec] of Object.entries(specs)) {
            const chunks = [];
            let offset = 0;
            do {
                signal.throwIfAborted();
                const page = object(await call('archive.read', { handle, stream, offset, maxBytes: 262144 }, signal), ['stream', 'offset', 'totalBytes', 'contentHash', 'bytes', 'eof', 'scope', ...(resource.kind === 'transcript' ? ['complete', 'truncated'] : [])]);
                if (page.stream !== stream || page.offset !== offset || page.totalBytes !== spec.size || page.contentHash !== spec.sha256 || typeof page.bytes !== 'string' || page.bytes.length > 349528 || typeof page.eof !== 'boolean' || page.scope !== (resource.kind === 'transcript' ? 'isolated-execution' : 'protected-execution-run'))
                    throw Error('archive_client_page');
                if (resource.kind === 'transcript' && (page.complete !== resource.complete || page.truncated !== resource.truncated))
                    throw Error('archive_client_capture');
                const body = Buffer.from(page.bytes, 'base64');
                if (body.toString('base64') !== page.bytes || body.length > 262144 || offset + body.length > spec.size || page.eof !== (offset + body.length === spec.size) || !body.length && !page.eof)
                    throw Error('archive_client_page');
                chunks.push(body);
                offset += body.length;
                if (page.eof)
                    break;
            } while (true);
            const bytes = Buffer.concat(chunks, offset);
            if (createHash('sha256').update(bytes).digest('hex') !== spec.sha256)
                throw Error('archive_client_content_hash');
            streams[stream] = bytes;
        }
        complete = true;
        return Object.freeze({ resource, streams: Object.freeze(streams) });
    }
    finally {
        if (handle && !complete)
            await call('archive.close', { handle }, AbortSignal.timeout(1000)).catch(() => { });
    }
}
/** Metadata discovery does not authorize opening a resource. */
export async function listUserArchives(transport, input, signal) { const request = JSON.parse(json(input)); if (request.requestSource !== 'user')
    throw Error('archive_request_source'); if (!['transcript', 'protected-run'].includes(request.kind) || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 64)
    throw Error('archive_list_limit'); const result = object(await transport.call('archive.list', request, signal), ['items', 'nextCursor']); if (!Array.isArray(result.items) || result.items.length > request.limit || result.nextCursor !== null && (typeof result.nextCursor !== 'string' || result.nextCursor.length > 4096))
    throw Error('archive_client_list'); let previous = ''; const items = result.items.map((value) => { const row = object(value, ['id', 'kind', 'state']); if (typeof row.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.id) || row.id <= previous || row.kind !== request.kind || !(request.kind === 'transcript' ? ['prepared', 'ready', 'deleted'] : ['open', 'sealed', 'prepared', 'complete', 'deleted']).includes(row.state))
    throw Error('archive_client_list'); previous = row.id; return Object.freeze({ id: row.id, kind: row.kind, state: row.state }); }); return Object.freeze({ items: Object.freeze(items), nextCursor: result.nextCursor }); }
/** Explicit native-approved deletion. An unknown reply is not automatically retried. */
export async function deleteUserArchive(transport, input, signal) {
    const request = JSON.parse(json(input));
    if (request.requestSource !== 'user')
        throw Error('archive_request_source');
    const call = transport.call.bind(transport);
    let handle, done = false;
    try {
        const challenge = object(await call('archive.prepare', { ...request, action: 'delete' }, signal), ['challengeId', 'validUntil', 'resourceKind']);
        if (typeof challenge.challengeId !== 'string' || !challenge.challengeId || challenge.resourceKind !== request.resource.kind || !Number.isSafeInteger(challenge.validUntil))
            throw Error('archive_client_challenge');
        const grant = object(await call('archive.authorize', { challengeId: challenge.challengeId }, signal), ['handle', 'resource', 'validUntil']);
        if (typeof grant.handle !== 'string' || !/^[a-f0-9]{64}$/.test(grant.handle))
            throw Error('archive_client_handle');
        handle = grant.handle;
        const resource = parseArchiveDeleteResource(grant.resource);
        if (grant.validUntil !== challenge.validUntil || resource.kind !== request.resource.kind || (resource.kind === 'transcript' ? resource.resourceId : resource.sourceRunId) !== request.resource.id)
            throw Error('archive_client_resource');
        const reply = object(await call('archive.delete', { requestSource: 'user', handle }, signal), ['deleted']);
        if (reply.deleted !== true)
            throw Error('archive_client_delete_result');
        done = true;
        return Object.freeze({ deleted: true, resource });
    }
    finally {
        if (handle && !done)
            await call('archive.close', { handle }, AbortSignal.timeout(1000)).catch(() => { });
    }
}
