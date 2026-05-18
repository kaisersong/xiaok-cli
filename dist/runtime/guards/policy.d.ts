import type { TraceEvent } from '../trace/schema.js';
export type GuardMode = 'off' | 'pass' | 'warn' | 'block';
export type GuardDecision = {
    ok: true;
    mode: 'off' | 'pass';
    events: TraceEvent[];
} | {
    ok: false;
    mode: 'warn' | 'block';
    reason: string;
    action: string;
    events: TraceEvent[];
    allowOverride: boolean;
};
export interface ExecutionScope {
    kind: 'code' | 'document' | 'slide' | 'data' | 'general' | 'project' | 'unknown';
    confidence: number;
}
export declare function guardEvent(input: {
    guardId: string;
    mode: 'passed' | 'warned' | 'blocked' | 'override';
    target?: string;
    taskId?: string;
    artifactId?: string;
    category?: string;
    reason?: string;
    action?: string;
    override?: {
        actor: string;
        reason: string;
    };
}): TraceEvent;
