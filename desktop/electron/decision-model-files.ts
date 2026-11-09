import {withDecisionSyncCleanup} from './decision-model-cleanup.js';
import { decisionStockMap } from './decision-model-stock.js';
import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';
import * as fs from 'node:fs';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { types } from 'node:util';
import { createRoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import { createSourceSyncCustodyContext, registerSourceSyncCustodyOwner, type SourceSyncSdkKind } from '../../src/runtime/task-host/source-sync-custody.js';
import { DecisionModelHttp, assertDecisionModelHttp } from './decision-model-http.js';
import { encodeDecisionData } from './decision-model-data.js';
import { readOwnAtomicErrorCode, writeFileAtomicallySync } from '../../src/utils/atomic-file.js';
const apply = Reflect.apply, keys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty, create = Object.create, own = Object.hasOwn;
const native = { lstat: fs.lstatSync, fstat: fs.fstatSync, realpath: fs.realpathSync, mkdir: fs.mkdirSync,
    open: fs.openSync, close: fs.closeSync, read: fs.readSync, write: fs.writeFileSync, fsync: fs.fsyncSync,
    unlink: fs.unlinkSync, readdir: fs.readdirSync, rm: fs.rmSync, rename: fs.renameSync, disk: fs.statfsSync };
const getTime = Date.prototype.getTime, httpSettle = DecisionModelHttp.prototype.settle;
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
const platform = process.platform;
const regular = BigInt(constants.S_IFREG), directory = BigInt(constants.S_IFDIR), mask = BigInt(constants.S_IFMT);
export type ModelStat = {
    dev: bigint;
    ino: bigint;
    mode: bigint;
    nlink: bigint;
    uid: bigint;
    size: bigint;
    mtimeNs: bigint;
};
/** Manager-local original IO stock. This is bookkeeping, never a Native grant. */
export class DecisionModelFiles {
    private readonly custody = createRoomTurnCustody();
    private readonly key = Object.freeze(Object.create(null));
    private readonly context: object;
    private readonly fds = decisionStockMap<number, {
        closeEntered: boolean;
    }>();
    private readonly entered = createIntrinsicSet<object>();
    private unknown?: {
        raw: unknown;
    };
    private basePath?: string;
    private sealed = false;
    private readonly sessions = createIntrinsicSet<DecisionModelHttp>();
    constructor(private readonly requestedRoot: string) {
        registerSourceSyncCustodyOwner(this, (key, kind, method, args, receiver) => {
            if (key !== this.key)
                throw Error('decision_file_owner');
            return this.invoke(kind, method, args, receiver);
        });
        this.context = createSourceSyncCustodyContext(this, this.key);
    }
    private fail(raw: unknown): void { this.unknown ??= { raw }; this.custody.inventory(raw); }
    private current(): void {
        if (this.sealed)
            throw Error('closed');
        this.custody.accepted();
        if (this.unknown)
            throw Error('decision_source_unconfirmed', { cause: this.unknown.raw });
    }
    /** Flatten only fixed Node stat metadata; all extra data/symbol tails remain
     * visible to the one original walker. No user getter is evaluated. */
    private statValue(raw: unknown): ModelStat {
        if (!raw || typeof raw !== 'object' || types.isProxy(raw)) {
            this.fail(raw);
            throw Error('decision_stat_contract', { cause: raw });
        }
        const data = create(null), names = keys(raw);
        for (const key of names) {
            const row = descriptor(raw, key);
            if (!row || !own(row, 'value')) {
                this.fail(raw);
                throw Error('decision_stat_contract');
            }
            let value = row.value;
            if (value instanceof Date) {
                const extra = create(null);
                for (const name of keys(value)) {
                    const entry = descriptor(value, name);
                    if (!entry || !own(entry, 'value')) {
                        this.fail(value);
                        throw Error('decision_stat_contract');
                    }
                    define(extra, name, { value: entry.value, enumerable: true });
                }
                this.custody.inventory(extra);
                value = apply(getTime, value, []);
            }
            define(data, key, { value, enumerable: true });
        }
        this.custody.inventory(data);
        for (const key of ['dev', 'ino', 'mode', 'nlink', 'uid', 'size', 'mtimeNs'])
            if (typeof data[key] !== 'bigint') {
                this.fail(raw);
                throw Error('decision_stat_contract', { cause: raw });
            }
        return data as ModelStat;
    }
    private invoke(kind: SourceSyncSdkKind | 'entries' | 'disk', method: Function, args: unknown[], receiver?: unknown): unknown {
        const negative = kind === 'fd-close' || kind === 'unlink-temp' || kind === 'lock-release';
        if (!negative)
            this.current();
        const root = Object.create(null);
        this.entered.add(root);
        const fd = kind === 'fd-close' ? args[0] : undefined;
        try {
            if (kind === 'fd-close') {
                if (typeof fd !== 'number' || !this.fds.has(fd))
                    throw Error('decision_fd_owner');
                const stock = this.fds.get(fd)!;
                if (stock.closeEntered)
                    throw Error('decision_fd_close_unknown');
                stock.closeEntered = true;
            }
            const raw = apply(method, receiver, args);
            if (kind === 'fd-open' || kind === 'fd-open-read') {
                if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || this.fds.has(raw)) {
                    this.fail(raw);
                    throw Error('decision_fd_contract');
                }
                this.fds.set(raw, { closeEntered: false });
                return raw;
            }
            if (kind === 'fd-close') {
                if (raw !== undefined) {
                    this.fail(raw);
                    throw Error('decision_close_contract');
                }
                this.fds.delete(fd as number);
                return undefined;
            }
            if (kind === 'stat' || kind === 'fd-stat')
                return this.statValue(raw);
            if (kind === 'disk') {
                if (!raw || typeof raw !== 'object' || types.isProxy(raw)) {
                    this.fail(raw);
                    throw Error('disk_space');
                }
                const data = create(null);
                for (const key of keys(raw)) {
                    const row = descriptor(raw, key);
                    if (!row || !own(row, 'value')) {
                        this.fail(raw);
                        throw Error('disk_space');
                    }
                    define(data, key, { value: row.value, enumerable: true });
                }
                this.custody.inventory(data);
                if (typeof data.bavail !== 'bigint' || typeof data.bsize !== 'bigint' || data.bavail < 0n || data.bsize < 1n) {
                    this.fail(raw);
                    throw Error('disk_space');
                }
                return data.bavail * data.bsize;
            }
            if (kind === 'entries') {
                this.custody.inventory(raw);
                if (types.isProxy(raw) || !Array.isArray(raw) || raw.some(x => typeof x !== 'string')) {
                    this.fail(raw);
                    throw Error('decision_directory_contract');
                }
                return raw;
            }
            if (kind === 'fd-read') {
                if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
                    this.fail(raw);
                    throw Error('decision_read_contract');
                }
                return raw;
            }
            if (kind === 'string' || kind === 'uuid') {
                if (typeof raw !== 'string') {
                    this.fail(raw);
                    throw Error('decision_string_contract');
                }
                return raw;
            }
            if (raw !== undefined) {
                this.custody.inventory(raw);
                this.fail(raw);
                throw Error('decision_void_contract');
            }
            return undefined;
        }
        catch (raw) {
            this.custody.inventory(raw);
            if (!['stat', 'fd-stat', 'entries', 'disk', 'string', 'uuid', 'current'].includes(kind))
                this.fail(raw);
            throw raw;
        }
        finally {
            this.entered.delete(root);
        }
    }
    private call(kind: SourceSyncSdkKind | 'entries' | 'disk', method: Function, args: unknown[]): unknown { return this.invoke(kind, method, args); }
    get base(): string {
        if (!this.basePath) {
            this.basePath = this.call('string', native.realpath, [resolve(this.requestedRoot)]) as string;
            this.checkDirectory(this.basePath);
        }
        return this.basePath;
    }
    get root(): string { return join(this.base, 'decision-models'); }
    stamp(path: string): ModelStat { this.safe(path); return this.stat(path); }
    private stat(path: string): ModelStat { return this.call('stat', native.lstat, [path, { bigint: true }]) as ModelStat; }
    private checkDirectory(path: string): ModelStat {
        const s = this.stat(path);
        if ((s.mode & mask) !== directory || uid !== null && s.uid !== BigInt(uid))
            throw Error('unsafe_path');
        return s;
    }
    safe(path: string, missing = false): void {
        this.current();
        const base = this.base, p = resolve(path), r = relative(base, p);
        if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r))
            throw Error('unsafe_path');
        this.checkDirectory(base);
        const parts = r ? r.split(sep) : [];
        let next = base;
        for (let i = 0; i < parts.length; i++) {
            next = join(next, parts[i]!);
            let s: ModelStat;
            try {
                s = this.stat(next);
            }
            catch (raw) {
                if (missing && readOwnAtomicErrorCode(raw) === 'ENOENT')
                    return;
                throw raw;
            }
            const dir = (s.mode & mask) === directory;
            if (uid !== null && s.uid !== BigInt(uid) || (!dir && ((s.mode & mask) !== regular || s.nlink !== 1n)) || i < parts.length - 1 && !dir)
                throw Error('unsafe_path');
        }
    }
    exists(path: string): boolean {
        try {
            this.safe(path);
            return true;
        }
        catch (raw) {
            if (readOwnAtomicErrorCode(raw) === 'ENOENT')
                return false;
            throw raw;
        }
    }
    mkdir(path: string): void {
        this.safe(dirname(path));
        this.call('void', native.mkdir, [path, { mode: 0o700 }]);
        this.safe(path);
    }
    ensureRoot(): void {
        if (!this.exists(this.root))
            this.mkdir(this.root);
        this.checkDirectory(this.root);
    }
    entries(path: string): string[] { this.safe(path); return this.call('entries', native.readdir, [path]) as string[]; }
    open(path: string, write = false): number {
        this.safe(path, write);
        const before = write ? undefined : this.stat(path);
        const flags = write ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL : constants.O_RDONLY;
        const fd = this.call(write ? 'fd-open' : 'fd-open-read', native.open, [path, flags | (constants.O_NOFOLLOW ?? 0), 0o600]) as number;
        try {
            const opened = this.call('fd-stat', native.fstat, [fd, { bigint: true }]) as ModelStat;
            const named = this.stat(path);
            if ((opened.mode & mask) !== regular || opened.nlink !== 1n || uid !== null && opened.uid !== BigInt(uid) || opened.ino !== named.ino || opened.size !== named.size || before && before.ino !== opened.ino || named.dev !== 0n && opened.dev !== named.dev)
                throw Error('unsafe_path');
            this.safe(path);
            return fd;
        }
        catch (raw) {
            try {
                this.close(fd);
            }
            catch (close) {
                throw new AggregateError([raw, close], 'decision_open_cleanup', { cause: raw });
            }
            throw raw;
        }
    }
    close(fd: number): void { this.call('fd-close', native.close, [fd]); }
    read(fd: number, buffer: Buffer, offset = 0, length = buffer.length): number {
        if (!this.fds.has(fd))
            throw Error('decision_fd_owner');
        const n = this.call('fd-read', native.read, [fd, buffer, offset, length, null]) as number;
        if (n > length) {
            this.fail(n);
            throw Error('decision_read_contract');
        }
        return n;
    }
    write(fd: number, bytes: Uint8Array | string): void {
        if (!this.fds.has(fd))
            throw Error('decision_fd_owner');
        this.call('void', native.write, [fd, bytes]);
    }
    flush(fd: number): void {
        if (!this.fds.has(fd))
            throw Error('decision_fd_owner');
        this.call('void', native.fsync, [fd]);
    }
    readText(path: string, maxBytes = 4096): string {
        const stat = this.stat(path);
        if (stat.size > BigInt(maxBytes))
            throw Error('decision_file_size');
        const fd = this.open(path);
        let primary: {
            raw: unknown;
        } | undefined;
        return withDecisionSyncCleanup(() => {
            try {
                const bytes = Buffer.alloc(Number(stat.size));
                let offset = 0;
                while (offset < bytes.length) {
                    const n = this.read(fd, bytes, offset, bytes.length - offset);
                    if (!n)
                        throw Error('decision_file_size');
                    offset += n;
                }
                const after = this.stat(path);
                if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs)
                    throw Error('decision_file_changed');
                return bytes.toString('utf8');
            }
            catch (raw) {
                primary = { raw };
                throw raw;
            }
        }, () => {
            try {
                this.close(fd);
            }
            catch (raw) {
                if (primary)
                    throw new AggregateError([primary.raw, raw], 'decision_read_close', { cause: primary.raw });
                throw raw;
            }
        });
    }
    atomic(path: string, value: unknown): void { this.safe(dirname(path)); this.safe(path, true); writeFileAtomicallySync(path, encodeDecisionData(value), { sourceContext: this.context }); this.safe(path); }
    exclusiveText(path: string, value: unknown): void { this.exclusiveBytes(path, encodeDecisionData(value)); }
    exclusiveBytes(path: string, bytes: string | Uint8Array): void {
        const fd = this.open(path, true);
        let first: {
            raw: unknown;
        } | undefined;
        withDecisionSyncCleanup(() => {
            try {
                this.write(fd, bytes);
                this.flush(fd);
            }
            catch (raw) {
                first = { raw };
                throw raw;
            }
        }, () => {
            try {
                this.close(fd);
            }
            catch (raw) {
                if (first)
                    throw new AggregateError([first.raw, raw], 'decision_write_close', { cause: first.raw });
                throw raw;
            }
        });
    }
    availableBytes(): bigint { return this.call('disk', native.disk, [this.base, { bigint: true }]) as bigint; }
    rename(from: string, to: string): void { this.safe(from); this.safe(to, true); this.call('rename-temp', native.rename, [from, to]); this.safe(to); }
    unlink(path: string): void { this.safe(path); this.call('void', native.unlink, [path]); }
    removeDirectory(path: string): void { this.safe(path); this.call('void', native.rm, [path, { recursive: true, force: false }]); }
    holdHttp(session: DecisionModelHttp): void { assertDecisionModelHttp(session); this.sessions.add(session); }
    async closeHttp(session: DecisionModelHttp): Promise<void> {
        assertDecisionModelHttp(session);
        if (!this.sessions.has(session))
            throw Error('decision_http_owner');
        const ack = await apply(httpSettle, session, []);
        if (ack !== undefined)
            throw Error('decision_http_contract');
        this.sessions.delete(session);
    }
    sealEffects(): void { this.sealed = true; }
    retain(raw: unknown): void { this.custody.inventory(raw); }
    async settle(): Promise<void> {
        const errors: unknown[] = [];
        try {
            await this.custody.waitPhysicalKnown();
        }
        catch (raw) {
            errors.push(raw);
        }
        for (const session of this.sessions.snapshot()) {
            try {
                await this.closeHttp(session);
            }
            catch (raw) {
                errors.push(raw);
            }
        }
        if (errors.length)
            throw new AggregateError(errors, 'decision_file_sessions', { cause: errors[0] });
        if (this.unknown || this.fds.size || this.entered.size)
            throw Error('decision_source_unconfirmed', { cause: this.unknown?.raw });
    }
}
