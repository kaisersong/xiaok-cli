import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonicalVerificationJson as json } from './protocol.js';
const LIMIT = 128 * 1024 ** 2;
const owners = new WeakMap(), captures = new WeakMap();
function fields(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('source_directory_protocol'); }
function decimal(value, positive = false) { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n || positive && value === '0')
    throw Error('source_directory_identity'); }
/** Private leaf driver. Captured facts are not native approval, all-source
 * custody, effect drain or a capacity permit. The installed caller pins the
 * helper and keeps every source child alive through the full-set commit. */
export async function startDirectorySourceCustody(input) {
    const { executable, uid, signal } = input;
    if (!Number.isSafeInteger(uid) || uid < 1 || input.sources.length < 1 || input.sources.length > 64)
        throw Error('source_directory_arguments');
    const sources = input.sources.map(source => { fields(source, ['kind', 'directory']); fields(source.directory, ['canonicalPath', 'device', 'inode']); if (!['session-root', 'task-root', 'goal-file-root', 'profile-registry', 'session-alias-holder'].includes(source.kind) || typeof source.directory.canonicalPath !== 'string' || !source.directory.canonicalPath.startsWith('/') || source.directory.canonicalPath.includes('\0'))
        throw Error('source_directory_arguments'); decimal(source.directory.device); decimal(source.directory.inode, true); return Object.freeze({ kind: source.kind, directory: Object.freeze({ ...source.directory }) }); });
    const references = (input.references ?? []).map(r => { fields(r, ['sourceIndex', 'path', 'device', 'inode']); decimal(r.device); decimal(r.inode, true); if (!Number.isSafeInteger(r.sourceIndex) || r.sourceIndex < 0 || r.sourceIndex >= sources.length || typeof r.path !== 'string' || !r.path || Buffer.byteLength(r.path) > 4095 || r.path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f\x7f]/.test(r.path))
        throw Error('source_directory_reference'); return Object.freeze({ ...r }); });
    const args = [String(uid), ...sources.flatMap(s => [s.kind, s.directory.canonicalPath, s.directory.device, s.directory.inode])];
    if (args.reduce((n, a) => n + Buffer.byteLength(a) + 1, 0) > 192 * 1024)
        throw Error('source_directory_arguments');
    signal.throwIfAborted();
    const child = spawn(executable, args, { cwd: '/', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, stdio: 'pipe' });
    let failure, ended = false, closing = false, busy = false, consumed = false, firstSeen = false, first, buffer = Buffer.alloc(0), stderrBytes = 0, closePromise;
    let pending;
    let resolveClosed;
    const closed = new Promise(resolve => resolveClosed = resolve), retained = [];
    function poison(error) { failure ??= error; if (pending) {
        clearTimeout(pending.timer);
        pending.reject(failure);
        pending = undefined;
    } if (!ended)
        child.kill('SIGKILL'); }
    function current() { if (failure)
        throw failure; if (ended || closing)
        throw Error('source_directory_closed'); signal.throwIfAborted(); }
    const abort = () => poison(Error('source_directory_aborted'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        abort();
    child.on('error', () => poison(Error('source_directory_spawn')));
    child.stdin.on('error', () => poison(Error('source_directory_channel')));
    child.stderr.on('data', (bytes) => { stderrBytes += bytes.length; if (stderrBytes > 4096)
        poison(Error('source_directory_output_limit')); });
    child.stdout.on('data', (bytes) => { if (failure || closing)
        return; if (buffer.length + bytes.length > 1024 ** 2) {
        poison(Error('source_directory_output_limit'));
        return;
    } buffer = Buffer.concat([buffer, bytes]); for (;;) {
        const at = buffer.indexOf(10);
        if (at < 0)
            break;
        let value;
        try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, at)));
        }
        catch {
            poison(Error('source_directory_protocol'));
            return;
        }
        buffer = buffer.subarray(at + 1);
        if (pending) {
            firstSeen = true;
            const p = pending;
            pending = undefined;
            clearTimeout(p.timer);
            p.resolve(value);
        }
        else if (!firstSeen) {
            firstSeen = true;
            first = value;
        }
        else {
            poison(Error('source_directory_unsolicited'));
            return;
        }
    } });
    child.on('close', () => { ended = true; signal.removeEventListener('abort', abort); if (pending) {
        clearTimeout(pending.timer);
        pending.reject(failure ?? Error('source_directory_ended'));
        pending = undefined;
    } resolveClosed(); });
    async function receive(command) { current(); if (pending)
        throw Error('source_directory_concurrent'); if (!command && firstSeen) {
        const value = first;
        first = undefined;
        return value;
    } const answer = new Promise((resolve, reject) => { pending = { resolve, reject, timer: setTimeout(() => poison(Error('source_directory_timeout')), 10000) }; }); if (command)
        child.stdin.write(command + '\n'); return answer; }
    async function close() { if (closePromise)
        return closePromise; closing = true; closePromise = (async () => { if (!ended) {
        const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
        child.stdin.end('RELEASE\n');
        await closed;
        clearTimeout(timer);
    } for (const bytes of retained)
        bytes.fill(0); retained.length = 0; })(); return closePromise; }
    function parseHeader(value) { fields(value, ['state', 'pid', 'nonce', 'count']); if (value.state !== 'held' || value.pid !== child.pid || value.count !== sources.length || typeof value.nonce !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.nonce))
        throw Error('source_directory_header'); return value; }
    let header;
    try {
        header = parseHeader(await receive());
    }
    catch (error) {
        poison(error instanceof Error ? error : Error('source_directory_header'));
        await close();
        throw error;
    }
    async function check() { if (json(parseHeader(await receive('CHECK'))) !== json(header))
        throw Error('source_directory_changed'); current(); }
    const owner = Object.freeze({
        async checkCurrent() { current(); if (busy)
            throw Error('source_directory_concurrent'); busy = true; try {
            await check();
        }
        catch (error) {
            poison(error instanceof Error ? error : Error('source_directory_changed'));
            await close();
            throw error;
        }
        finally {
            busy = false;
        } },
        async capture(maximumBytes = 128 * 1024 ** 2, maximumMetadataBytes = LIMIT) {
            current();
            if (!Number.isSafeInteger(maximumMetadataBytes) || maximumMetadataBytes < 0 || maximumMetadataBytes > LIMIT)
                throw Error('source_directory_capture_limit');
            if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 128 * 1024 ** 2)
                throw Error('source_directory_capture_limit');
            if (busy || consumed)
                throw Error('source_directory_capture_consumed');
            busy = true;
            consumed = true;
            try {
                const budget = await receive('BUDGET ' + maximumMetadataBytes);
                fields(budget, ['state', 'nonce']);
                if (budget.state !== 'budget' || budget.nonce !== header.nonce)
                    throw Error('source_directory_budget');
                for (const r of references) {
                    const reply = await receive(`REFERENCE ${r.sourceIndex} ${Buffer.from(r.path).toString('hex')} ${r.device} ${r.inode}`);
                    fields(reply, ['state', 'nonce']);
                    if (reply.state !== 'reference' || reply.nonce !== header.nonce)
                        throw Error('source_directory_reference');
                }
                const sealed = await receive('REFERENCES-END');
                fields(sealed, ['state', 'nonce']);
                if (sealed.state !== 'references-sealed' || sealed.nonce !== header.nonce)
                    throw Error('source_directory_reference');
                const start = await receive('CAPTURE');
                fields(start, ['state', 'nonce', 'entries', 'metadataBytes']);
                if (start.state !== 'capture' || start.nonce !== header.nonce || !Number.isSafeInteger(start.entries) || start.entries < 0 || start.entries > LIMIT / 128 || !Number.isSafeInteger(start.metadataBytes) || start.metadataBytes < 0 || start.metadataBytes > maximumMetadataBytes)
                    throw Error('source_directory_capture');
                const facts = [], bodies = [];
                let total = 0, metadataBytes = 0, lastSource = -1, lastPath = Buffer.alloc(0);
                for (let i = 0; i < start.entries; i++) {
                    const entry = await receive('NEXT');
                    fields(entry, ['state', 'nonce', 'sourceIndex', 'entryIndex', 'kind', 'pathHex', 'size', 'physicalSize', 'device', 'inode', 'mode']);
                    if (entry.state !== 'entry' || entry.nonce !== header.nonce || entry.entryIndex !== i || !Number.isSafeInteger(entry.sourceIndex) || entry.sourceIndex < 0 || entry.sourceIndex >= sources.length || !['file', 'directory', 'source-reference'].includes(entry.kind) || typeof entry.pathHex !== 'string' || entry.pathHex.length > 8192 || !/^([a-f0-9]{2})+$/.test(entry.pathHex) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0xffffffff)
                        throw Error('source_directory_entry');
                    decimal(entry.physicalSize);
                    decimal(entry.device);
                    decimal(entry.inode, true);
                    const pathBytes = Buffer.from(entry.pathHex, 'hex'), path = new TextDecoder('utf-8', { fatal: true }).decode(pathBytes);
                    if (/[\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || entry.sourceIndex < lastSource || entry.sourceIndex === lastSource && Buffer.compare(lastPath, pathBytes) >= 0 || entry.kind !== 'file' && entry.size !== 0 || entry.kind === 'file' && BigInt(entry.physicalSize) !== BigInt(entry.size))
                        throw Error('source_directory_entry');
                    lastSource = entry.sourceIndex;
                    lastPath = pathBytes;
                    const cost = Buffer.byteLength(json(entry));
                    if (cost > maximumMetadataBytes - metadataBytes || entry.size > maximumBytes - total)
                        throw Error('source_directory_total_limit');
                    metadataBytes += cost;
                    total += entry.size;
                    let body, sha256;
                    if (entry.kind === 'file') {
                        body = Buffer.alloc(entry.size);
                        retained.push(body);
                        const hash = createHash('sha256');
                        let offset = 0;
                        while (offset < entry.size) {
                            const chunk = await receive('NEXT');
                            fields(chunk, ['state', 'nonce', 'entryIndex', 'offset', 'bytes']);
                            if (chunk.state !== 'chunk' || chunk.nonce !== header.nonce || chunk.entryIndex !== i || chunk.offset !== offset || typeof chunk.bytes !== 'string' || chunk.bytes.length > 65536 * 2 || !/^([a-f0-9]{2})+$/.test(chunk.bytes))
                                throw Error('source_directory_chunk');
                            const bytes = Buffer.from(chunk.bytes, 'hex');
                            if (bytes.length > entry.size - offset)
                                throw Error('source_directory_chunk');
                            hash.update(bytes);
                            bytes.copy(body, offset);
                            offset += bytes.length;
                        }
                        sha256 = hash.digest('hex');
                    }
                    bodies.push(body);
                    facts.push(Object.freeze({ sourceIndex: entry.sourceIndex, path, kind: entry.kind, byteLength: entry.size, physicalSize: entry.physicalSize, device: entry.device, inode: entry.inode, mode: entry.mode, ...(sha256 ? { sha256 } : {}) }));
                }
                const end = await receive('NEXT');
                fields(end, ['state', 'nonce', 'entries']);
                if (end.state !== 'capture-complete' || end.nonce !== header.nonce || end.entries !== facts.length)
                    throw Error('source_directory_incomplete');
                await check();
                const token = Object.freeze({});
                captures.set(token, { owner, facts: Object.freeze(facts), bodies: Object.freeze(bodies), metadataBytes: Math.max(start.metadataBytes, metadataBytes) });
                return token;
            }
            catch (error) {
                poison(error instanceof Error ? error : Error('source_directory_capture'));
                await close();
                throw error;
            }
            finally {
                busy = false;
            }
        }, close,
    });
    owners.set(owner, { current });
    return owner;
}
export function readDirectorySourceCapture(owner, token) { const o = owners.get(owner), capture = captures.get(token); if (!o || !capture || capture.owner !== owner)
    throw Error('source_directory_capture_brand'); o.current(); return capture.facts; }
export function readDirectorySourceFile(owner, token, index) { const facts = readDirectorySourceCapture(owner, token); if (!Number.isSafeInteger(index) || index < 0 || index >= facts.length)
    throw Error('source_directory_index'); if (facts[index].kind !== 'file')
    throw Error('source_directory_not_file'); return Buffer.from(captures.get(token).bodies[index]); }
export function readDirectorySourceFileRange(owner, token, index, offset, length) {
    const facts = readDirectorySourceCapture(owner, token);
    if (!Number.isSafeInteger(index) || index < 0 || index >= facts.length || facts[index].kind !== 'file')
        throw Error('source_directory_not_file');
    const body = captures.get(token).bodies[index];
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > body.length || !Number.isSafeInteger(length) || length < 1 || length > 256 * 1024)
        throw Error('source_directory_range');
    return Buffer.from(body.subarray(offset, offset + length));
}
export function readDirectorySourceMetadataBytes(owner, token) { readDirectorySourceCapture(owner, token); return captures.get(token).metadataBytes; }
