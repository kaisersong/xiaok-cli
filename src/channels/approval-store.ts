import type { ApprovalAction, ApprovalRequest, ApprovalRequestInput } from './types.js';

export class InMemoryApprovalStore {
  private readonly pending = new Map<string, ApprovalRequest>();

  create(input: ApprovalRequestInput): ApprovalRequest {
    const request: ApprovalRequest = {
      approvalId: `approval_${this.pending.size + 1}`,
      ...input,
    };
    this.pending.set(request.approvalId, request);
    return request;
  }

  get(approvalId: string): ApprovalRequest | undefined {
    return this.pending.get(approvalId);
  }

  resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined {
    if (!this.pending.has(approvalId)) {
      return undefined;
    }

    this.pending.delete(approvalId);
    return action;
  }
}
