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
export declare class InMemoryApprovalStore implements ApprovalStore {
    protected readonly pending: Map<string, PendingApprovalRecord>;
    protected nextId: number;
    create(input: ApprovalRequestInput): ApprovalRequest;
    get(approvalId: string): ApprovalRequest | undefined;
    waitForDecision(approvalId: string): Promise<ApprovalWaitResult | undefined>;
    resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined;
    expire(approvalId: string): ApprovalWaitResult | undefined;
    listPending(): ApprovalRequest[];
    protected scheduleExpiration(request: ApprovalRequest, timeoutMs: number): ReturnType<typeof setTimeout>;
    protected finish(approvalId: string, result: ApprovalWaitResult): ApprovalWaitResult | undefined;
}
export declare class FileApprovalStore extends InMemoryApprovalStore {
    private readonly filePath;
    constructor(filePath: string);
    create(input: ApprovalRequestInput): ApprovalRequest;
    resolve(approvalId: string, action: ApprovalAction): ApprovalAction | undefined;
    expire(approvalId: string): ApprovalWaitResult | undefined;
    private load;
    private persist;
}
export {};
