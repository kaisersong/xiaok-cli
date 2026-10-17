/** Host-only capability installed on one tool execution context, never on model input. */
export interface ObservationCollectorPort {
    begin(input: {
        toolName: 'read' | 'bash';
        source: {
            filePath: string;
            offset: number;
            limit?: number;
        } | {
            command: string;
            workdir: string;
        };
    }): {
        append(text: string): void;
        finalize(facts: ObservationTerminalFacts): void;
    };
}
export interface ObservationTerminalFacts {
    executionState: 'terminal' | 'termination_pending';
    outcome?: 'success' | 'error' | 'timeout' | 'cancelled';
    incompleteReason?: string;
}
/** Archiving cannot alter, replay, or misreport the native operation. The owner
 * must fail closed on unpublished references, independently of tool success. */
export declare function beginToolObservation(port: ObservationCollectorPort | undefined, input: Parameters<ObservationCollectorPort['begin']>[0]): {
    append(text: string): void;
    finalize(facts: ObservationTerminalFacts): void;
};
