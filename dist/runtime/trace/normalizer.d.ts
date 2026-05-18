import type { RuntimeEvent } from '../events.js';
import type { TraceAgent, TraceEvent, TraceTask } from './schema.js';
export declare function normalizeRuntimeEvent(event: RuntimeEvent): TraceEvent[];
export declare function normalizeDesktopRuntimeEvent(event: unknown): TraceEvent[];
export declare function normalizeKSwarmProjectDetail(detail: KSwarmProjectDetailLike): {
    tasks: TraceTask[];
    agents: TraceAgent[];
    events: TraceEvent[];
    summary: Record<string, unknown>;
};
interface KSwarmProjectDetailLike {
    project: {
        id: string;
        name: string;
        status: string;
    };
    tasks?: Array<{
        id: string;
        title: string;
        status: string;
        assignedAgent?: string;
        dependencies?: string[];
        phase?: string | number;
        failureClass?: string;
        failureCount?: number;
        qualityFailureCount?: number;
        blockedReason?: string;
        artifacts?: Array<{
            name: string;
            path?: string;
            url?: string;
        }>;
    }>;
    agents?: Array<{
        id: string;
        name?: string;
        status: string;
        currentTask?: string;
    }>;
    activities?: unknown[];
    humanActions?: unknown[];
    workspace?: unknown;
    plan?: unknown;
    planProgress?: unknown;
    dispatchPlan?: {
        dispatchable?: Array<{
            taskId: string;
            agentId?: string;
            reason?: string;
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
