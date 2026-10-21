import type { DirectOperationRecord, DirectOperationAdvance } from './compound-direct-operation.js';
import type { IsolatedExecutionPort, HostIssuedMountPlan, ExecutionCommand } from '../isolated-execution/execution-port.js';
import type { CompoundOperationRecord, CompoundAdvance } from './compound-operation.js';
import type { ToolExecutionContext } from '../../types.js';
/** Host deployment port, never model arguments. Staging grants and the qualified
 * engine are issued by the protected product factory, not by this consumer. */
export interface CompoundValidationBackend {
    execution: IsolatedExecutionPort;
    prepareDirectInput?(input: {
        sessionIdentity: string;
        operationId: string;
        validationInvocationId: string;
        command: Readonly<{
            command: string;
            workdir: string;
        }>;
        signal?: AbortSignal;
    }): Promise<{
        materializedInput: HostIssuedMountPlan;
        command: ExecutionCommand;
        scopeDigest: string;
    }>;
    prepareValidationInput(input: {
        sessionIdentity: string;
        compoundOperationId: string;
        validationInvocationId: string;
        editedFile: NonNullable<CompoundOperationRecord['file']>;
        command: Readonly<{
            command: string;
            workdir: string;
        }>;
        signal?: AbortSignal;
    }): Promise<{
        materializedInput: HostIssuedMountPlan;
        command: ExecutionCommand;
        scopeDigest: string;
    }>;
}
type PreparedInput = Awaited<ReturnType<CompoundValidationBackend['prepareValidationInput']>>;
type CommandActual = Readonly<{
    command: string;
    workdir: string;
    timeoutMs: number;
    maxChars: number;
}>;
export declare function executeCompoundValidation(input: {
    backend: CompoundValidationBackend;
    preparedInput: PreparedInput;
    record: CompoundOperationRecord;
    actual: CommandActual;
    context?: ToolExecutionContext;
    assertCurrent(): void;
    persist(change: CompoundAdvance): Promise<unknown>;
}): Promise<string>;
export declare function executeDirectIsolatedCommand(input: {
    backend: CompoundValidationBackend;
    preparedInput: PreparedInput;
    record: DirectOperationRecord;
    validationInvocationId: string;
    finalInputHash: string;
    actual: CommandActual;
    context?: ToolExecutionContext;
    assertCurrent(): void;
    persist(change: DirectOperationAdvance): Promise<unknown>;
}): Promise<string>;
export {};
