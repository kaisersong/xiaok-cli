import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApprovalAction, ApprovalRequest, ApprovalRequestInput } from './types.js';

export type ApprovalWaitResult = ApprovalAction | 'expired';

interface PendingApprovalRecord {
  request: ApprovalRequest;
  waiters: Array<(result: ApprovalWaitResult) => void>;
  timer: ReturnType<typeof setTimeout>;
}

export interface ApprovalStore {
  create(input: ApprovalRequestInput): ApprovalRequest;
  get(approvalId: string): ApprovalRequest | undefined;
  waitForDecision(approvalId: string): Promise<ApprovalWaitResult | undefined>;
  resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined;
  expire(approvalId: string): ApprovalWaitResult | undefined;
  listPending(): ApprovalRequest[];
}

export class InMemoryApprovalStore implements ApprovalStore {
  protected readonly pending = new Map<string, PendingApprovalRecord>();
  protected nextId = 1;

  create(input: ApprovalRequestInput): ApprovalRequest {
    const createdAt = Date.now();
    const timeoutMs = input.timeoutMs ?? 5 * 60_000;
    const request: ApprovalRequest = {
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
    return this.finish(approvalId, action) as ApprovalAction | undefined;
  }

  expire(approvalId: string): ApprovalWaitResult | undefined {
    return this.finish(approvalId, 'expired');
  }

  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  protected scheduleExpiration(request: ApprovalRequest, timeoutMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.expire(request.approvalId);
    }, timeoutMs);
  }

  protected finish(approvalId: string, result: ApprovalWaitResult): ApprovalWaitResult | undefined {
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

interface ApprovalStoreDocument {
  schemaVersion: 1;
  approvals: ApprovalRequest[];
}

export class FileApprovalStore extends InMemoryApprovalStore {
  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  override create(input: ApprovalRequestInput): ApprovalRequest {
    const request = super.create(input);
    this.persist();
    return request;
  }

  override resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined {
    const result = super.resolve(approvalId, action);
    if (result) {
      this.persist();
    }
    return result;
  }

  override expire(approvalId: string): ApprovalWaitResult | undefined {
    const result = super.expire(approvalId);
    if (result) {
      this.persist();
    }
    return result;
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as ApprovalStoreDocument;
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
    } catch {
      return;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const doc: ApprovalStoreDocument = {
      schemaVersion: 1,
      approvals: this.listPending(),
    };
    writeFileSync(this.filePath, JSON.stringify(doc, null, 2), 'utf8');
  }
}
