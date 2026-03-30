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
        const timer = setTimeout(() => {
            const pending = this.pending.get(request.approvalId);
            if (!pending) {
                return;
            }
            this.pending.delete(request.approvalId);
            for (const waiter of pending.waiters) {
                waiter('expired');
            }
        }, timeoutMs);
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
        const pending = this.pending.get(approvalId);
        if (!pending) {
            return undefined;
        }
        this.pending.delete(approvalId);
        clearTimeout(pending.timer);
        for (const waiter of pending.waiters) {
            waiter(action);
        }
        return action;
    }
}
