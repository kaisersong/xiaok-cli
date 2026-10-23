/** Host-only native phase facts. A direct child's exit is NOT proof that every
 * descendant is quiescent; only the isolated execution authority can prove that. */
export interface CompoundNativePhasePort {
    /** Synchronous last check after durable awaits, immediately before the fixed
     * native writer. This callback never creates execution authority. */
    assertBeforeFileMutation?(): void;
    /** The trusted coordinator owns staging, durable reservation, bounded collection
     * and physical receipts. Presence of a phase forbids fallback to host spawn. */
    executeIsolatedCommand?(actual: Readonly<{
        command: string;
        workdir: string;
        timeoutMs: number;
        maxChars: number;
    }>, revalidate: () => void): Promise<string>;
    beforeFileMutation?(fact: {
        filePath: string;
        beforeHash: string | null;
        afterHash: string;
    }): void | Promise<void>;
    fileMutationCommitted?(fact: {
        filePath: string;
        afterHash: string;
    }): void | Promise<void>;
    beforeCommandStart?(fact: {
        command: string;
        workdir: string;
    }): void | Promise<void>;
    commandFinished?(fact: {
        exitCode: number | null;
        terminalExited: boolean;
        outcome: 'success' | 'error' | 'cancelled' | 'timeout';
        pid: number | null;
    }): void | Promise<void>;
    rejected?(fact: {
        toolName: 'edit' | 'write' | 'bash';
        reason: 'file_missing' | 'old_string_missing' | 'old_string_ambiguous' | 'risk_policy' | 'interactive_sudo';
    }): void | Promise<void>;
}
export declare function assertCompoundFileEffectCurrent(port: CompoundNativePhasePort | undefined): void;
