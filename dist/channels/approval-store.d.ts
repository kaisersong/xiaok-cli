import type { ApprovalAction, ApprovalRequest, ApprovalRequestInput } from './types.js';
export type ApprovalWaitResult = ApprovalAction | 'expired';
export declare class InMemoryApprovalStore {
    private readonly pending;
    private nextId;
    create(input: ApprovalRequestInput): ApprovalRequest;
    get(approvalId: string): ApprovalRequest | undefined;
    waitForDecision(approvalId: string): Promise<ApprovalWaitResult | undefined>;
    resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined;
}
