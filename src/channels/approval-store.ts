import type { ApprovalAction, ApprovalRequest, ApprovalRequestInput } from './types.js';

export type ApprovalWaitResult = ApprovalAction | 'expired';

interface PendingApprovalRecord {
  request: ApprovalRequest;
  waiters: Array<(result: ApprovalWaitResult) => void>;
  timer: ReturnType<typeof setTimeout>;
}

export class InMemoryApprovalStore {
  private readonly pending = new Map<string, PendingApprovalRecord>();
  private nextId = 1;

  create(input: ApprovalRequestInput): ApprovalRequest {
    const createdAt = Date.now();
    const timeoutMs = input.timeoutMs ?? 5 * 60_000;
    const request: ApprovalRequest = {
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

  get(approvalId: string): ApprovalRequest | undefined {
    return this.pending.get(approvalId)?.request;
  }

  waitForDecision(approvalId: string): Promise<ApprovalWaitResult | undefined> {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      return Promise.resolve(undefined);
    }

    return new Promise<ApprovalWaitResult>((resolve) => {
      pending.waiters.push(resolve);
    });
  }

  resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined {
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
