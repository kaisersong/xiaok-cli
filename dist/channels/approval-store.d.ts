import type { ApprovalAction, ApprovalRequest, ApprovalRequestInput } from './types.js';
export declare class InMemoryApprovalStore {
    private readonly pending;
    create(input: ApprovalRequestInput): ApprovalRequest;
    get(approvalId: string): ApprovalRequest | undefined;
    resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined;
}
