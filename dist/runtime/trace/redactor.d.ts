import type { TraceRedaction } from './schema.js';
interface RedactionAccumulator {
    value: string;
    redactions: TraceRedaction[];
}
export declare function redactString(input: string, fieldPath?: string): RedactionAccumulator;
export declare function redactTraceValue(input: unknown, fieldPath?: string): {
    value: unknown;
    redactions: TraceRedaction[];
};
export {};
