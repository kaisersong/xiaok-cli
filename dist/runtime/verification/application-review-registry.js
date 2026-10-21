import { createHash, randomBytes } from 'node:crypto';
import { parseApplicationBindingReview, applicationBindingReviewBytes } from './application-binding-review.js';
import { canonicalVerificationJson as json } from './protocol.js';
/** Fixed broker data handoff only. Neither registration nor its ticket approves anything. */
export function createApplicationReviewRegistry(options) {
    const authorityId = options.authorityId, clock = options.clock.bind(options), observe = options.observe.bind(options), resolveAccount = options.resolveAccount.bind(options);
    const rows = new Map();
    let closed = false;
    function time() { if (closed)
        throw Error('application_registry_closed'); const c = clock(); if (closed || !c || !Number.isSafeInteger(c.lowerBound) || !Number.isSafeInteger(c.upperBound) || c.lowerBound < 0 || c.upperBound < c.lowerBound)
        throw Error('application_registry_clock'); return { ...c }; }
    function current(row) { const c = time(), d = row.review.deadline; if (c.domainId !== d.domainId || c.qualificationEpoch !== d.qualificationEpoch || c.lowerBound < d.notBefore || c.upperBound >= d.validUntil)
        throw Error('application_registry_expired'); }
    function principal(raw) { const p = JSON.parse(json(raw)); if (!p || Object.keys(p).sort().join(',') !== 'auditSessionId,gid,pid,uid' || Object.values(p).some(n => !Number.isSafeInteger(n) || n < 0) || p.uid < 1 || p.pid < 1 || p.auditSessionId < 1)
        throw Error('application_registry_peer'); return json(p); }
    async function same(row) { current(row); const start = await observe(Object.freeze(JSON.parse(row.peer))); current(row); if (!/^\d+:\d+$/.test(start) || start !== row.start)
        throw Error('application_registry_identity'); const account = await resolveAccount(row.review.principal.uid); current(row); if (account !== row.review.principal.accountGeneration)
        throw Error('application_registry_account'); const finalStart = await observe(Object.freeze(JSON.parse(row.peer))); current(row); if (finalStart !== row.start)
        throw Error('application_registry_identity'); }
    return Object.freeze({
        async register(raw, peer, signal) {
            signal?.throwIfAborted();
            const review = parseApplicationBindingReview(raw), p = principal(peer), bytes = applicationBindingReviewBytes(review);
            if (review.authorityId !== authorityId)
                throw Error('application_registry_authority');
            const row = { review, peer: p, start: null, ready: false, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
            current(row);
            for (const [ticket, old] of rows)
                if (old.peer === p && old.hash === row.hash) {
                    if (!old.ready)
                        throw Error('application_registry_pending');
                    await same(old);
                    signal?.throwIfAborted();
                    if (rows.get(ticket) !== old)
                        throw Error('application_registry_binding');
                    return Object.freeze({ ticket, reviewHash: old.hash });
                }
            const c = time();
            for (const [ticket, old] of rows)
                if (old.review.deadline.domainId !== c.domainId || old.review.deadline.qualificationEpoch !== c.qualificationEpoch || old.review.deadline.validUntil <= c.upperBound)
                    rows.delete(ticket);
            if (rows.size >= 4 || [...rows.values()].reduce((n, r) => n + r.bytes, bytes.length) > 4 * 1024 ** 2)
                throw Error('application_registry_capacity');
            const ticket = randomBytes(32).toString('hex');
            rows.set(ticket, row);
            const aborted = () => { if (rows.get(ticket) === row)
                rows.delete(ticket); };
            signal?.addEventListener('abort', aborted, { once: true });
            try {
                const start = await observe(Object.freeze(JSON.parse(p)));
                current(row);
                if (!/^\d+:\d+$/.test(start) || rows.get(ticket) !== row)
                    throw Error('application_registry_identity');
                row.start = start;
                await same(row);
                signal?.throwIfAborted();
                if (rows.get(ticket) !== row)
                    throw Error('application_registry_binding');
                signal?.removeEventListener('abort', aborted);
                row.ready = true;
                return Object.freeze({ ticket, reviewHash: row.hash });
            }
            catch (error) {
                rows.delete(ticket);
                throw error;
            }
            finally {
                signal?.removeEventListener('abort', aborted);
            }
        },
        async consume(ticket, reviewHash, peer) {
            const row = rows.get(ticket);
            rows.delete(ticket);
            if (!row || !row.ready || row.hash !== reviewHash || row.peer !== principal(peer))
                throw Error('application_registry_binding');
            await same(row);
            return Object.freeze({ review: row.review, assertCaller: () => same(row) });
        },
        async release(ticket, reviewHash, peer) {
            const row = rows.get(ticket);
            if (!row)
                return;
            if (!row.ready || row.hash !== reviewHash || row.peer !== principal(peer))
                throw Error('application_registry_binding');
            await same(row);
            if (rows.get(ticket) === row)
                rows.delete(ticket);
        },
        close() { closed = true; rows.clear(); },
    });
}
