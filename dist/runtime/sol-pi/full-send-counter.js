import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomicallySync } from '../../utils/atomic-file.js';
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_ROOT_BYTES = 4 * MAX_BYTES;
function denied(reason) { throw new Error(`SOL_PI_COUNTER_${reason}`); }
/** Void TypeScript callbacks can still return promises at runtime. Never await a
 * persistence hook: dispatch requires completion in this synchronous call. */
export function assertSynchronousFullSendResult(result) {
    if (result === undefined)
        return;
    // Adopt thenables too, so a rejected miswired hook cannot escape unhandled.
    void Promise.resolve(result).catch(() => { });
    denied('NON_SYNCHRONOUS_RESULT');
}
function identifier(value) { if (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
    denied('INVALID_ID'); }
/** HOST ONLY. registerNewObservation is called only from a new native capture,
 * never from restored references, model arguments, or a missing-count fallback. */
export function createFullSendCounter(options) {
    identifier(options.sessionId);
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink() || process.platform !== 'win32' && (lstatSync(options.root).mode & 0o077) !== 0)
        denied('UNSAFE_ROOT');
    const root = realpathSync(options.root);
    const path = join(root, 'full-send.json');
    const lockPath = join(root, 'owner.sqlite');
    function storageUsage(temporaryBytes = 0) {
        let total = 0;
        let lockBytes = 0;
        for (const name of readdirSync(root)) {
            const stat = lstatSync(join(root, name));
            if (!['full-send.json', 'owner.sqlite', 'owner.sqlite-journal'].includes(name) || !stat.isFile() || stat.isSymbolicLink())
                denied('UNSAFE_ROOT');
            total += stat.size;
            if (name === 'full-send.json') {
                if (stat.size > MAX_BYTES)
                    denied('QUOTA');
            }
            else
                lockBytes += stat.size;
        }
        if (lockBytes > 2 * MAX_BYTES || total + temporaryBytes > MAX_ROOT_BYTES)
            denied('QUOTA');
    }
    storageUsage();
    if (existsSync(lockPath) && lstatSync(lockPath).isSymbolicLink())
        denied('UNSAFE_ROOT');
    const initialFiles = readdirSync(root);
    let db;
    try {
        db = new Database(lockPath, { timeout: 0 });
        db.exec('BEGIN EXCLUSIVE');
        storageUsage();
    }
    catch {
        db?.close();
        denied('OWNER_ACTIVE');
    }
    let disposed = false;
    let poisoned = false;
    const uncertain = new Set();
    const atomicWrite = options.atomicWrite ?? writeFileAtomicallySync;
    let ledger;
    function write(next) {
        const text = JSON.stringify(next);
        const bytes = Buffer.byteLength(text);
        if (bytes > MAX_BYTES)
            denied('QUOTA');
        try {
            storageUsage(bytes);
            assertSynchronousFullSendResult(atomicWrite(path, text, { requireDirectorySync: true }));
            storageUsage();
            ledger = next;
        }
        catch (error) {
            poisoned = true;
            throw error;
        }
    }
    try {
        if (existsSync(path)) {
            if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size > MAX_BYTES)
                denied('CORRUPT');
            ledger = JSON.parse(readFileSync(path, 'utf8'));
            if (ledger.version !== 1 || ledger.sessionId !== options.sessionId || typeof ledger.clean !== 'boolean' || !ledger.observations || !ledger.invocations
                || typeof ledger.observations !== 'object' || Array.isArray(ledger.observations) || typeof ledger.invocations !== 'object' || Array.isArray(ledger.invocations)
                || Object.keys(ledger.observations).length > MAX_ENTRIES || Object.keys(ledger.invocations).length > MAX_ENTRIES)
                denied('CORRUPT');
            for (const [id, count] of Object.entries(ledger.observations)) {
                identifier(id);
                if (count !== null && (!Number.isInteger(count) || count < 0 || count > 2))
                    denied('CORRUPT');
            }
            for (const [id, invocation] of Object.entries(ledger.invocations)) {
                identifier(id);
                if (!invocation || !/^[a-f0-9]{64}$/.test(invocation.digest) || !Array.isArray(invocation.ids) || !invocation.ids.length || invocation.ids.length > 128
                    || new Set(invocation.ids).size !== invocation.ids.length || !['pending', 'confirmed', 'unknown'].includes(invocation.state))
                    denied('CORRUPT');
                for (const observed of invocation.ids) {
                    identifier(observed);
                    if (!Object.hasOwn(ledger.observations, observed))
                        denied('CORRUPT');
                }
            }
            if (!ledger.clean) {
                for (const id of Object.keys(ledger.observations))
                    ledger.observations[id] = null;
                for (const invocation of Object.values(ledger.invocations))
                    if (invocation.state === 'pending')
                        invocation.state = 'unknown';
            }
        }
        else {
            if (initialFiles.length)
                denied('LEDGER_MISSING');
            ledger = { version: 1, sessionId: options.sessionId, clean: false, observations: {}, invocations: {} };
        }
        write({ ...ledger, clean: false });
    }
    catch (error) {
        db.close();
        throw error;
    }
    function live() { if (disposed)
        denied('DISPOSED'); }
    function binding(input) {
        live();
        identifier(input.logicalInvocationId);
        if (typeof input.serializedBody !== 'string' || !input.serializedBody || !Array.isArray(input.observationIds) || !input.observationIds.length || input.observationIds.length > 128)
            denied('INVALID_BINDING');
        for (const id of input.observationIds)
            identifier(id);
        return { digest: createHash('sha256').update(input.serializedBody).digest('hex'), ids: [...new Set(input.observationIds)].sort() };
    }
    function existing(input) {
        const wanted = binding(input);
        const record = Object.hasOwn(ledger.invocations, input.logicalInvocationId) ? ledger.invocations[input.logicalInvocationId] : undefined;
        if (record && (record.digest !== wanted.digest || JSON.stringify(record.ids) !== JSON.stringify(wanted.ids)))
            denied('INVOCATION_REBOUND');
        return { wanted, record };
    }
    const reservation = Object.freeze({ root, sessionId: options.sessionId, maximumBytes: MAX_ROOT_BYTES });
    const port = {
        getStorageReservation() { live(); return reservation; },
        registerNewObservation(id) {
            live();
            identifier(id);
            if (Object.hasOwn(ledger.observations, id))
                denied('ALREADY_REGISTERED');
            if (poisoned)
                denied('PERSISTENCE_UNAVAILABLE');
            if (Object.keys(ledger.observations).length >= MAX_ENTRIES)
                denied('QUOTA');
            const next = structuredClone(ledger);
            next.observations[id] = 0;
            write(next);
        },
        read(id) { live(); identifier(id); if (poisoned || uncertain.has(id) || Object.values(ledger.invocations).some(record => record.state === 'pending' && record.ids.includes(id)))
            return null; return Object.hasOwn(ledger.observations, id) ? ledger.observations[id] : null; },
        prepare(input) {
            const { wanted, record } = existing(input);
            if (poisoned)
                denied('PERSISTENCE_UNAVAILABLE');
            if (record)
                return;
            if (Object.keys(ledger.invocations).length >= MAX_ENTRIES)
                denied('QUOTA');
            if (Object.values(ledger.invocations).some(record => record.state === 'pending' && record.ids.some(id => wanted.ids.includes(id))))
                denied('PENDING');
            const next = structuredClone(ledger);
            for (const id of wanted.ids)
                if (!Object.hasOwn(next.observations, id)) {
                    if (Object.keys(next.observations).length >= MAX_ENTRIES)
                        denied('QUOTA');
                    next.observations[id] = null;
                }
            next.invocations[input.logicalInvocationId] = { ...wanted, state: 'pending' };
            write(next);
        },
        confirm(input) {
            const { record } = existing(input);
            if (!record)
                denied('NOT_PREPARED');
            if (poisoned)
                denied('PERSISTENCE_UNAVAILABLE');
            if (record.state === 'confirmed')
                return;
            const next = structuredClone(ledger);
            for (const id of record.ids) {
                const count = next.observations[id];
                next.observations[id] = record.state === 'unknown' || uncertain.has(id) || count === null ? null : Math.min(2, count + 1);
            }
            next.invocations[input.logicalInvocationId].state = record.state === 'unknown' ? 'unknown' : 'confirmed';
            try {
                write(next);
            }
            catch (error) {
                for (const id of record.ids)
                    uncertain.add(id);
                throw error;
            }
        },
        markUnknown(input) {
            const { record } = existing(input);
            if (!record)
                denied('NOT_PREPARED');
            // Even a previously acknowledged attempt may later have ambiguous transport
            // completion. This cannot decrease safety by promoting an unknown count.
            const next = structuredClone(ledger);
            next.invocations[input.logicalInvocationId].state = 'unknown';
            for (const id of record.ids) {
                next.observations[id] = null;
                uncertain.add(id);
            }
            if (poisoned)
                return;
            write(next);
        },
        dispose() {
            if (disposed)
                return;
            try {
                if (!poisoned && !Object.values(ledger.invocations).some(record => record.state === 'pending'))
                    write({ ...ledger, clean: true });
            }
            finally {
                disposed = true;
                db.close();
            }
        },
    };
    return Object.freeze(port);
}
