export class InMemoryApprovalStore {
    pending = new Map();
    create(input) {
        const request = {
            approvalId: `approval_${this.pending.size + 1}`,
            ...input,
        };
        this.pending.set(request.approvalId, request);
        return request;
    }
    get(approvalId) {
        return this.pending.get(approvalId);
    }
    resolve(approvalId, action) {
        if (!this.pending.has(approvalId)) {
            return undefined;
        }
        this.pending.delete(approvalId);
        return action;
    }
}
