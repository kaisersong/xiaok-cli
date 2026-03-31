import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export class InMemoryApprovalStore {
    pending = new Map();
    nextId = 1;
    create(input) {
        const createdAt = Date.now();
        const timeoutMs = input.timeoutMs ?? 5 * 60_000;
        const request = {
            ...input,
            approvalId: `approval_${this.nextId++}`,
            createdAt,
            expiresAt: createdAt + timeoutMs,
        };
        const timer = this.scheduleExpiration(request, timeoutMs);
        this.pending.set(request.approvalId, {
            request,
            waiters: [],
            timer,
        });
        return request;
    }
    get(approvalId) {
        return this.pending.get(approvalId)?.request;
    }
    waitForDecision(approvalId) {
        const pending = this.pending.get(approvalId);
        if (!pending) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve) => {
            pending.waiters.push(resolve);
        });
    }
    resolve(approvalId, action) {
        return this.finish(approvalId, action);
    }
    expire(approvalId) {
        return this.finish(approvalId, 'expired');
    }
    listPending() {
        return [...this.pending.values()].map((entry) => entry.request);
    }
    scheduleExpiration(request, timeoutMs) {
        return setTimeout(() => {
            this.expire(request.approvalId);
        }, timeoutMs);
    }
    finish(approvalId, result) {
        const pending = this.pending.get(approvalId);
        if (!pending) {
            return undefined;
        }
        this.pending.delete(approvalId);
        clearTimeout(pending.timer);
        for (const waiter of pending.waiters) {
            waiter(result);
        }
        return result;
    }
}
export class FileApprovalStore extends InMemoryApprovalStore {
    filePath;
    constructor(filePath) {
        super();
        this.filePath = filePath;
        this.load();
    }
    create(input) {
        const request = super.create(input);
        this.persist();
        return request;
    }
    resolve(approvalId, action) {
        const result = super.resolve(approvalId, action);
        if (result) {
            this.persist();
        }
        return result;
    }
    expire(approvalId) {
        const result = super.expire(approvalId);
        if (result) {
            this.persist();
        }
        return result;
    }
    load() {
        if (!existsSync(this.filePath)) {
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.approvals)) {
                return;
            }
            const now = Date.now();
            let maxId = 0;
            for (const request of parsed.approvals) {
                if (!request?.approvalId || request.expiresAt <= now) {
                    continue;
                }
                const timeoutMs = Math.max(1, request.expiresAt - now);
                const timer = this.scheduleExpiration(request, timeoutMs);
                this.pending.set(request.approvalId, {
                    request,
                    waiters: [],
                    timer,
                });
                const seq = Number(request.approvalId.replace(/^approval_/, ''));
                if (Number.isFinite(seq) && seq > maxId) {
                    maxId = seq;
                }
            }
            this.nextId = maxId + 1;
            this.persist();
        }
        catch {
            return;
        }
    }
    persist() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const doc = {
            schemaVersion: 1,
            approvals: this.listPending(),
        };
        writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
}
