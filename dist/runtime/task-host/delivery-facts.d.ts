import type { TaskSnapshot } from './types.js';
import type { CompletionEvidenceRecord, CompletionExpectation } from '../guards/completion-evidence.js';
export declare const DELIVERY_INPUT_LIMIT = 131072;
export declare const DELIVERY_OUTPUT_LIMIT = 65536;
export declare class DeliveryVerificationError extends Error {
    readonly code: string;
    constructor(code: string);
}
export type DeliveryEventFactV1 = {
    type: 'progress_plan_reported';
    steps: Array<{
        status: string;
    }>;
} | {
    type: 'result';
    result: {
        summary: string;
    };
} | {
    type: 'artifact_recorded';
    artifactId: string;
    kind: string;
    label: string;
    filePath: string;
} | {
    type: 'canvas_file_changed';
    filePath: string;
} | {
    type: 'goal_tool_fact';
    factKind: 'file_mutation';
    invocationId: string;
    normalizedFilePaths?: string[];
} | {
    type: 'goal_tool_finished';
    invocationId: string;
    ok: boolean;
} | {
    type: 'canvas_tool_call';
    toolName: 'create_project';
} | {
    type: 'canvas_tool_result';
    toolName: 'create_project';
    ok: boolean;
    response: string;
} | {
    type: 'assistant_delta';
};
export interface DeliveryFactsV1 {
    version: 1;
    requestId: string;
    taskId: string;
    prompt: string;
    eventCount: number;
    eventFacts: Array<{
        index: number;
        event: DeliveryEventFactV1;
    }>;
    result?: {
        summary: string;
        artifacts: Array<{
            artifactId: string;
            kind: string;
            title: string;
            filePath?: string;
        }>;
    };
}
export interface DeliveryComputedFacts {
    kind: 'facts';
    planComplete: boolean;
    emptyDelivery: boolean;
    guard: {
        kind: 'skip';
    } | {
        kind: 'evaluate';
        expectation: CompletionExpectation;
        evidence: CompletionEvidenceRecord[];
    };
}
export interface DeliveryResponseV1 {
    version: 1;
    requestId: string;
    result: DeliveryComputedFacts | {
        kind: 'error';
        code: 'verifier_input_invalid' | 'verifier_internal_error' | 'validation_limit';
    };
}
export declare function validateDeliveryFactsV1(value: unknown): asserts value is DeliveryFactsV1;
export declare function encodeDeliveryFrame(value: unknown, max: number): string;
export declare function parseDeliveryFrame(frame: unknown, max: number): unknown;
/** Project incrementally before serializing; never clone an unbounded snapshot. */
export declare function buildDeliveryFactsV1(snapshot: TaskSnapshot, requestId: string): DeliveryFactsV1;
/** Only the shared CPU helpers consume this deliberately minimal snapshot. */
export declare function deliveryFactsSnapshot(facts: DeliveryFactsV1): TaskSnapshot;
export declare function validateDeliveryResponse(value: unknown, request: DeliveryFactsV1): asserts value is DeliveryResponseV1;
