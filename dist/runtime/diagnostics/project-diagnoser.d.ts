import type { DiagnosisReport } from './types.js';
import type { TraceTask } from '../trace/schema.js';
export declare function diagnoseProjectSnapshot(input: ProjectSnapshot): DiagnosisReport;
interface ProjectSnapshot {
    project: {
        id: string;
        name: string;
        status: string;
    };
    tasks: Array<TraceTask & {
        qualityFailureCount?: number;
    }>;
    agents?: Array<{
        id: string;
        name?: string;
        status: string;
        currentTask?: string;
    }>;
    activities?: unknown[];
    humanActions?: unknown[];
    dispatchPlan?: {
        dispatchable?: Array<{
            taskId: string;
            reason?: string;
            agentId?: string;
        }>;
        blocked?: Array<{
            taskId: string;
            reason: string;
            blockedByTaskId?: string;
        }>;
        waiting?: Array<{
            taskId: string;
            reason: string;
            agentId?: string;
        }>;
    };
    projectHealth?: {
        status: string;
        primaryBlockedTaskId?: string;
        message?: string;
    };
}
export {};
