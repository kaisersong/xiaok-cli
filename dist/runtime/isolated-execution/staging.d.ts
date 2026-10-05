import type { HostIssuedMountPlan, ExecutionCommand } from './execution-port.js';
export interface StagingReadAccess {
    /** The protected controller supplies actual issued-grant checks; arbitrary callbacks do not qualify a factory. */
    assertLive(grant: object): void;
    assertRead(grant: object, file: Readonly<{
        canonicalPath: string;
        expectedContentHash: string;
        byteLimit: number;
    }>): void;
}
interface FileInput {
    path: string;
    expectedContentHash: string;
    byteLimit: number;
}
interface StagedFile {
    path: string;
    contentHash: string;
    size: number;
    executable: boolean;
}
interface StagingInvocation {
    readonly sessionIdentity: string;
    readonly compoundOperationId: string;
    readonly validationInvocationId: string;
}
/** Real file freezing primitive. Only its installed controller owner may attach authorization and engine qualification. */
export declare function createInputStager(options: {
    root: string;
    access: StagingReadAccess;
    readerExecutable: string;
    maximumStagedBytes?: number;
}): Readonly<{
    prepareValidationInput(input: {
        grant: object;
        workspaceRoot: string;
        files: readonly FileInput[];
        purpose: "isolated-validation" | "isolated-command";
        editedFile?: {
            path: string;
            afterHash: string;
        };
        invocation: {
            sessionIdentity: string;
            compoundOperationId: string;
            validationInvocationId: string;
        };
        command: ExecutionCommand;
    }): Readonly<{
        materializedInput: HostIssuedMountPlan;
        command: ExecutionCommand;
        scopeDigest: string;
    }>;
    readFile(plan: HostIssuedMountPlan, path: string): Buffer;
    getManifest(plan: HostIssuedMountPlan): Readonly<{
        files: readonly StagedFile[];
        scopeDigest: string;
        command: ExecutionCommand;
        invocation: Readonly<StagingInvocation>;
    }>;
}>;
export {};
