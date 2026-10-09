import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, statSync } from 'node:fs';
import { z } from 'zod';
import { join, isAbsolute } from 'node:path';
function birth(pid) {
    return new Promise((resolve, reject) => {
        const args = process.platform === 'win32'
            ? ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]
            : ['-p', String(pid), '-o', 'lstart='];
        execFile(process.platform === 'win32' ? 'powershell.exe' : '/bin/ps', args, { timeout: 3000 }, (error, stdout) => {
            if (error || !stdout.trim())
                reject(new Error('activity_source_birth_unavailable'));
            else
                resolve(stdout.trim());
        });
    });
}
/** Supervision is independent of UI lifetime. No unknown PID is killed or
 * taken over; durable receipts bind process birth and exact entry identity. */
export class ActivitySourceSupervisor {
    root;
    ownerEpoch;
    children = new Map();
    receipts = new Map();
    pending = new Map();
    constructor(root, ownerEpoch) {
        this.root = root;
        this.ownerEpoch = ownerEpoch;
        const ledger = join(root, 'activity-source-supervision.json');
        if (existsSync(ledger)) {
            const state = statSync(ledger);
            if (state.size > 16_384 || process.platform !== 'win32' && (state.uid !== process.getuid?.() || (state.mode & 0o077) !== 0))
                throw new Error('activity_source_ledger_not_private');
            const document = z.object({ version: z.literal(1), sources: z.array(z.object({ name: z.enum(['broker', 'kswarm']), pid: z.number().int().nonnegative(), birth: z.string().max(256), entryHash: z.string().length(64), ownerEpoch: z.string().min(1).max(256), external: z.boolean(), instanceId: z.string().max(256).optional() }).strict()).max(2) }).strict().parse(JSON.parse(readFileSync(ledger, 'utf8')));
            for (const receipt of document.sources)
                this.receipts.set(receipt.name, receipt);
        }
    }
    save() {
        const file = join(this.root, 'activity-source-supervision.json'), temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, JSON.stringify({ version: 1, sources: [...this.receipts.values()] }), { mode: 0o600 });
        renameSync(temporary, file);
    }
    async healthy(source, pid) {
        try {
            const response = await fetch(source.healthUrl, { headers: source.healthHeaders, signal: AbortSignal.timeout(1000) });
            if (!response.ok || !Object.keys(source.expectedHealth).length)
                return false;
            const payload = await response.json();
            if (pid !== undefined && payload?.service?.pid !== pid)
                return false;
            return Object.entries(source.expectedHealth).every(([path, expected]) => {
                let actual = payload;
                for (const key of path.split('.'))
                    actual = actual && typeof actual === 'object' ? actual[key] : undefined;
                return actual === expected;
            });
        }
        catch {
            return false;
        }
    }
    alive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch (error) {
            if (error.code === 'ESRCH')
                return false;
            throw new Error('activity_source_liveness_unconfirmed');
        }
    }
    ensure(source) {
        const existing = this.pending.get(source.name);
        if (existing)
            return existing;
        const pending = this.ensureSource(source).finally(() => { if (this.pending.get(source.name) === pending)
            this.pending.delete(source.name); });
        this.pending.set(source.name, pending);
        return pending;
    }
    async ensureSource(source) {
        if (!isAbsolute(source.entryPath) || !isAbsolute(source.cwd) || !existsSync(source.entryPath))
            throw new Error('activity_source_entry_invalid');
        const entryHash = createHash('sha256').update(readFileSync(source.entryPath)).digest('hex');
        const previous = this.receipts.get(source.name);
        if (previous && !previous.external) {
            if (!this.alive(previous.pid)) {
                this.receipts.delete(source.name);
                this.save();
                return this.ensureSource(source);
            }
            if (previous.entryHash !== entryHash || await birth(previous.pid) !== previous.birth)
                throw new Error('activity_source_identity_mismatch');
            if (await this.healthy(source, previous.pid)) {
                const receipt = { ...previous, ownerEpoch: this.ownerEpoch };
                this.receipts.set(source.name, receipt);
                this.save();
                return receipt;
            }
            throw new Error('activity_supervised_source_unhealthy');
        }
        if (await this.healthy(source)) {
            // A verified independent external endpoint may be observed, but it is
            // not an owned PID and cannot acquire this supervisor's kill authority.
            const receipt = { name: source.name, pid: 0, birth: '', entryHash, ownerEpoch: this.ownerEpoch, external: true };
            this.receipts.set(source.name, receipt);
            this.save();
            return receipt;
        }
        const log = openSync(join(this.root, `activity-${source.name}.log`), 'a', 0o600);
        const child = spawn(source.executable, source.args ?? [source.entryPath], { cwd: source.cwd, env: { ...process.env, ...source.env }, detached: true,
            stdio: ['ignore', log, log], windowsHide: true });
        closeSync(log);
        let failure;
        child.once('error', error => { failure = error; });
        child.unref();
        if (!child.pid)
            throw new Error('activity_source_spawn_failed');
        this.children.set(source.name, child);
        const receipt = { name: source.name, pid: child.pid, birth: await birth(child.pid), entryHash, ownerEpoch: this.ownerEpoch, external: false };
        this.receipts.set(source.name, receipt);
        this.save();
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
            if (failure || child.exitCode !== null)
                throw new Error('activity_source_start_failed');
            if (await this.healthy(source, child.pid))
                return receipt;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('activity_source_start_timeout');
    }
    async protectedPid(pid) {
        const receipt = [...this.receipts.values()].find(item => !item.external && item.pid === pid);
        return Boolean(receipt && this.alive(pid) && await birth(pid) === receipt.birth);
    }
    async stopOwned(name, expectedOwnerEpoch) {
        if (expectedOwnerEpoch !== this.ownerEpoch)
            throw new Error('activity_source_stale_lease');
        const ledger = JSON.parse(readFileSync(join(this.root, 'activity-source-supervision.json'), 'utf8'));
        if (ledger.sources.find(item => item.name === name)?.ownerEpoch !== this.ownerEpoch)
            throw new Error('activity_source_stale_lease');
        const receipt = this.receipts.get(name);
        if (!receipt || receipt.external)
            throw new Error('activity_source_stop_unconfirmed');
        if (!this.alive(receipt.pid)) {
            this.receipts.delete(name);
            this.children.delete(name);
            this.save();
            return;
        }
        if (!await this.protectedPid(receipt.pid))
            throw new Error('activity_source_stop_unconfirmed');
        process.kill(receipt.pid, 'SIGTERM');
        const deadline = Date.now() + 5000;
        while (this.alive(receipt.pid) && Date.now() < deadline)
            await new Promise(resolve => setTimeout(resolve, 50));
        if (this.alive(receipt.pid))
            throw new Error('activity_source_stop_pending');
        this.receipts.delete(name);
        this.children.delete(name);
        this.save();
    }
}
