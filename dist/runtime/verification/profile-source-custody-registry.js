import { encodeBoundedProfileCaptureJson } from './profile-capture-json.js';
import { createHash, randomUUID } from 'node:crypto';
import { authorizeProfileSources } from './profile-source-authorization.js';
import { parseProfileSourceReview } from './profile-source-review.js';
import { startProfileSourceCapture, readProfileSourceCapture, readProfileCaptureMetadataBytes, readProfileDirectoryEntries, readProfileDirectoryFileRange, readProfileSqliteCapture, readProfileSqlitePage } from './profile-source-capture.js';
import { canonicalVerificationJson as json } from './protocol.js';
const LIMIT = 128 * 1024 ** 2;
/** Root-only composition component. It executes the native approval itself;
 * external receipt JSON is never an issuer. Fixed helper paths and kernel peer
 * observation must be supplied by the installed broker, not an RPC payload. */
export function createProfileSourceCustodyRegistry(input) {
    const { authorityId, directoryHelper, sqliteHelper } = input, allowedUserIds = Object.freeze([...input.allowedUserIds]), clock = input.clock.bind(input), observe = input.observe.bind(input), resolveAccount = input.resolveAccount.bind(input), approve = input.approve.bind(input);
    const endedHandles = new Map();
    const tombstones = new Set(), entries = new Map(), handles = new Map();
    let nativeRunning = 0;
    let closed = false, capturing = false, closePromise;
    const tasks = new Set();
    const expiry = setInterval(() => { if (closed)
        return; for (const e of entries.values()) {
        if (e.state === 'consumed' || e.state === 'unknown')
            continue;
        try {
            sample(e);
        }
        catch {
            e.controller.abort();
            if (!e.busy)
                void end(e).catch(() => { });
        }
    } }, 250);
    expiry.unref();
    function track(work) { if (closed)
        return Promise.reject(Error('source_custody_closed')); const task = work(); tasks.add(task); void task.then(() => tasks.delete(task), () => tasks.delete(task)); return task; }
    function sample(e) { if (closed || e.controller.signal.aborted)
        throw Error('source_custody_revoked'); const c = clock(), d = e.review.deadline; if (c.domainId !== d.domainId || c.qualificationEpoch !== d.qualificationEpoch || !Number.isSafeInteger(c.lowerBound) || !Number.isSafeInteger(c.upperBound) || c.upperBound < c.lowerBound || c.lowerBound < d.notBefore || c.upperBound >= d.validUntil)
        throw Error('source_custody_deadline'); }
    function peerCheck(e, peer) { if (json(peer) !== json(e.peer))
        throw Error('source_custody_peer'); }
    async function current(e, peer) { sample(e); peerCheck(e, peer); if (await observe(e.peer, e.controller.signal) !== e.incarnation)
        throw Error('source_custody_peer'); sample(e); if (await resolveAccount(e.review.principal.uid, e.controller.signal) !== e.review.principal.accountGeneration)
        throw Error('source_custody_account'); sample(e); if (await observe(e.peer, e.controller.signal) !== e.incarnation)
        throw Error('source_custody_peer'); sample(e); }
    function linked(e, signal) { const abort = () => e.controller.abort(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted)
        abort(); return () => signal.removeEventListener('abort', abort); }
    async function end(e) { if (e.closePromise)
        return e.closePromise; e.controller.abort(); e.state = 'closing'; e.closePromise = (async () => { try {
        await e.owner?.close();
        e.manifest?.fill(0);
        e.manifest = undefined;
        e.chargedBytes = 0;
        e.metadataBytes = 0;
        e.physical = undefined;
        e.token = undefined;
        if (e.handle) {
            handles.delete(e.handle);
            endedHandles.set(e.handle, { peer: e.peer, incarnation: e.incarnation });
        }
        e.state = 'consumed';
        entries.delete(e.review.challengeId);
    }
    catch (error) {
        e.state = 'unknown';
        throw error;
    } })(); return e.closePromise; }
    async function failed(e, error) { try {
        await end(e);
    }
    catch (closeError) {
        throw new AggregateError([error, closeError], 'source_custody_unknown');
    } throw error; }
    function occupied() { return entries.size; }
    async function checked(handle, peer, signal, read) { const e = handles.get(handle); if (!e || e.state !== 'held')
        throw Error('source_custody_handle'); if (e.busy)
        throw Error('source_custody_concurrent'); e.busy = true; const unlink = linked(e, signal); try {
        await current(e, peer);
        await e.owner.checkCurrent();
        await current(e, peer);
        const result = read(e);
        await e.owner.checkCurrent();
        await current(e, peer);
        return result;
    }
    catch (error) {
        return failed(e, error);
    }
    finally {
        unlink();
        e.busy = false;
    } }
    return Object.freeze({
        runNative(work) { return track(async () => { if (occupied() + nativeRunning >= 4)
            throw Error('source_custody_admission'); nativeRunning++; try {
            return await work();
        }
        finally {
            nativeRunning--;
        } }); },
        authorize(raw, peer, signal) { return track(async () => { const review = parseProfileSourceReview(raw); if (tombstones.has(review.challengeId))
            throw Error('source_custody_replay'); if (occupied() + nativeRunning >= 4 || tombstones.size >= 4096)
            throw Error('source_custody_admission'); const e = { review, peer: Object.freeze({ ...peer }), state: 'authorizing', controller: new AbortController(), chargedBytes: 0, metadataBytes: 0, busy: true }; tombstones.add(review.challengeId); entries.set(review.challengeId, e); const unlink = linked(e, signal); try {
            sample(e);
            e.incarnation = await observe(e.peer, e.controller.signal);
            if (!e.incarnation)
                throw Error('source_custody_peer');
            await current(e, peer);
            e.receipt = await authorizeProfileSources(review, { requestSource: review.requestSource, authorityId, allowedUserIds, signal: e.controller.signal, clock, resolveAccount: async (uid, s) => { await current(e, peer); return resolveAccount(uid, s); }, approve });
            await current(e, peer);
            e.state = 'approved';
            return e.receipt;
        }
        catch (error) {
            return failed(e, error);
        }
        finally {
            unlink();
            e.busy = false;
        } }); },
        capture(request, peer, signal) { return track(async () => { const e = entries.get(request.challengeId); if (!e || e.state !== 'approved' || e.busy)
            throw Error('source_custody_consumed'); e.state = 'capturing'; e.busy = true; const unlink = linked(e, signal); let ownsCapture = false; try {
            if (request.reviewHash !== e.receipt?.reviewHash)
                throw Error('source_custody_review');
            await current(e, peer);
            if (capturing)
                throw Error('source_custody_capture_busy');
            capturing = true;
            ownsCapture = true;
            const remaining = LIMIT - [...entries.values()].reduce((sum, v) => sum + v.chargedBytes, 0);
            if (remaining <= 0)
                throw Error('source_custody_capacity');
            const remainingMetadata = LIMIT - [...entries.values()].reduce((sum, v) => sum + v.metadataBytes, 0);
            e.metadataBytes = remainingMetadata;
            e.owner = await startProfileSourceCapture({ uid: e.review.principal.uid, directoryHelper, sqliteHelper, sources: e.review.sourceSet.sources.map(({ namespaceId, reviewedSnapshotSha256, ...source }) => source), signal: e.controller.signal, maximumCaptureBytes: remaining, maximumMetadataBytes: remainingMetadata });
            await current(e, peer);
            e.token = await e.owner.capture();
            const facts = readProfileSourceCapture(e.owner, e.token);
            e.chargedBytes = facts.capturedBytes;
            e.metadataBytes = readProfileCaptureMetadataBytes(e.owner, e.token);
            const physical = new Map();
            const addPhysical = (device, inode, size) => { const key = device + ':' + inode, old = physical.get(key); if (old !== undefined && old !== size)
                throw Error('source_custody_physical_changed'); physical.set(key, size); };
            for (const source of facts.sources) {
                if (source.source.kind === 'sqlite-db')
                    for (const f of readProfileSqliteCapture(e.owner, e.token, source.source.sourceId).physicalFiles)
                        addPhysical(f.device, f.inode, f.byteLength);
                else
                    for (const f of readProfileDirectoryEntries(e.owner, e.token, source.source.sourceId))
                        if ((f.mode & 0o170000) === 0o100000)
                            addPhysical(f.device, f.inode, f.physicalSize);
            }
            e.physical = physical;
            const allPhysical = new Map();
            for (const entry of entries.values())
                for (const [key, size] of entry.physical ?? []) {
                    const old = allPhysical.get(key);
                    if (old !== undefined && old !== size)
                        throw Error('source_custody_physical_changed');
                    allPhysical.set(key, size);
                }
            if ([...allPhysical.values()].reduce((sum, size) => sum + BigInt(size), 0n) > BigInt(LIMIT))
                throw Error('source_custody_physical_capacity');
            for (const source of e.review.sourceSet.sources)
                if (facts.sources.find(f => f.source.sourceId === source.sourceId)?.snapshotHash !== source.reviewedSnapshotSha256)
                    throw Error('source_custody_snapshot');
            await e.owner.checkCurrent();
            await current(e, peer);
            e.manifest = encodeBoundedProfileCaptureJson({ facts, databases: e.review.sourceSet.sources.filter(s => s.kind === 'sqlite-db').map(s => ({ sourceId: s.sourceId, capture: readProfileSqliteCapture(e.owner, e.token, s.sourceId) })), directories: e.review.sourceSet.sources.filter(s => s.kind !== 'sqlite-db').map(s => ({ sourceId: s.sourceId, entries: readProfileDirectoryEntries(e.owner, e.token, s.sourceId) })) }, LIMIT - [...entries.values()].reduce((sum, v) => sum + (v.manifest?.length ?? 0), 0));
            e.handle = randomUUID();
            handles.set(e.handle, e);
            e.state = 'held';
            return Object.freeze({ handle: e.handle, reviewHash: e.receipt.reviewHash, inventoryHash: e.review.inventoryHash, manifestHash: createHash('sha256').update(e.manifest).digest('hex'), manifestBytes: e.manifest.length, capturedBytes: facts.capturedBytes });
        }
        catch (error) {
            return failed(e, error);
        }
        finally {
            if (ownsCapture)
                capturing = false;
            unlink();
            e.busy = false;
        } }); },
        readManifest(handle, offset, length, peer, signal) { return track(() => checked(handle, peer, signal, e => { if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 256 * 1024 || offset > e.manifest.length)
            throw Error('source_custody_range'); return Buffer.from(e.manifest.subarray(offset, offset + length)); })); },
        readFile(handle, sourceId, entryIndex, offset, length, peer, signal) { return track(() => checked(handle, peer, signal, e => { if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 256 * 1024)
            throw Error('source_custody_range'); return readProfileDirectoryFileRange(e.owner, e.token, sourceId, entryIndex, offset, length); })); },
        readSqlitePage(handle, sourceId, pageNo, peer, signal) { return track(() => checked(handle, peer, signal, e => readProfileSqlitePage(e.owner, e.token, sourceId, pageNo))); },
        check(handle, peer, signal) { return track(() => checked(handle, peer, signal, () => undefined)); },
        release(handle, peer) { return track(async () => { const e = handles.get(handle); if (!e) {
            const ended = endedHandles.get(handle);
            if (!ended || json(ended.peer) !== json(peer) || await observe(peer, new AbortController().signal) !== ended.incarnation)
                throw Error('source_custody_handle');
            return;
        } peerCheck(e, peer); if (await observe(peer, new AbortController().signal) !== e.incarnation)
            throw Error('source_custody_peer'); if (e.busy)
            throw Error('source_custody_concurrent'); return end(e); }); },
        close() { return closePromise ??= (async () => { closed = true; clearInterval(expiry); for (const e of entries.values())
            e.controller.abort(); await Promise.allSettled([...tasks]); const result = await Promise.allSettled([...entries.values()].map(end)), errors = result.filter((r) => r.status === 'rejected').map(r => r.reason); if (errors.length)
            throw new AggregateError(errors, 'source_custody_shutdown_unknown'); })(); },
    });
}
