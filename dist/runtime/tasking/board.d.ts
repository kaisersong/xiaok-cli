import type { BaseTaskRecord, TaskStatus } from './types.js';
export interface WorkflowTaskRecord extends BaseTaskRecord {
    title: string;
    details?: string;
    owner?: string;
    source: string;
    notes: string[];
}
export interface CreateWorkflowTaskInput {
    sessionId: string;
    title: string;
    details?: string;
    owner?: string;
    source: string;
}
export interface UpdateWorkflowTaskInput {
    title?: string;
    details?: string;
    owner?: string;
    status?: TaskStatus;
    note?: string;
    latestEvent?: string;
}
export interface ListWorkflowTasksInput {
    status?: TaskStatus;
    limit?: number;
}
export declare class SessionTaskBoard {
    private readonly defaultSource;
    private readonly store;
    constructor(defaultSource?: string);
    create(sessionId: string, input: Omit<CreateWorkflowTaskInput, 'sessionId' | 'source'> & {
        source?: string;
    }): WorkflowTaskRecord;
    get(sessionId: string, taskId: string): WorkflowTaskRecord | undefined;
    list(sessionId: string, options?: ListWorkflowTasksInput): WorkflowTaskRecord[];
    update(sessionId: string, taskId: string, patch: UpdateWorkflowTaskInput): WorkflowTaskRecord | undefined;
}
