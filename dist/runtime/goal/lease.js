import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, } from 'node:fs';
import { join } from 'node:path';
export class GoalSessionLease {
    options;
    acquired = false;
    now;
    pid;
    leaseTimeoutMs;
    isAlive;
    path;
    constructor(options) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.pid = options.pid ?? process.pid;
        this.leaseTimeoutMs = options.leaseTimeoutMs ?? 30_000;
        this.isAlive = options.isProcessAlive ?? isProcessAlive;
        this.path = join(options.rootDir, `${options.sessionId}.goal.lock`);
    }
    acquire(input = {}) {
        mkdirSync(this.options.rootDir, { recursive: true });
        try {
            this.create();
            return;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        const existing = this.read();
        const expired = this.now() - existing.heartbeatAt > this.leaseTimeoutMs;
        const dead = !this.isAlive(existing.pid);
        if (!input.recoverExpired || !expired || !dead) {
            throw new Error(`Goal lease is held by ${existing.instanceId}`);
        }
        unlinkSync(this.path);
        this.create();
    }
    heartbeat() {
        this.assertOwned();
        const current = this.read();
        writeFileSync(this.path, JSON.stringify({ ...current, heartbeatAt: this.now() }), 'utf8');
    }
    assertOwned() {
        if (!this.acquired || !existsSync(this.path))
            throw new Error('Goal lease is not held');
        const current = this.read();
        if (current.instanceId !== this.options.instanceId)
            throw new Error('Goal lease owner mismatch');
    }
    release() {
        if (!this.acquired)
            return;
        try {
            this.assertOwned();
            unlinkSync(this.path);
        }
        finally {
            this.acquired = false;
        }
    }
    create() {
        const now = this.now();
        const descriptor = openSync(this.path, 'wx', 0o600);
        try {
            const document = {
                sessionId: this.options.sessionId,
                instanceId: this.options.instanceId,
                pid: this.pid,
                acquiredAt: now,
                heartbeatAt: now,
            };
            writeFileSync(descriptor, JSON.stringify(document), 'utf8');
        }
        finally {
            closeSync(descriptor);
        }
        this.acquired = true;
    }
    read() {
        return JSON.parse(readFileSync(this.path, 'utf8'));
    }
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
