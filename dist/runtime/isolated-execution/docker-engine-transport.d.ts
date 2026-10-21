import { type AttachedOutputCapture } from './docker-attached-output.js';
import { buildDockerWorkerRequest } from './docker-request.js';
import { buildDockerMountedRequest, type VolumeProposal } from './docker-volume-request.js';
/** Fixed local IPC transport. Its existence is not a qualified engine binding. No env/context fallback. */
export declare class DockerEngineTransport {
    private readonly socketPath;
    constructor(options: {
        socketPath: string;
    });
    private call;
    private id;
    /** Private staging phase only. Durable runner must deny this method after sealing input. */
    populateInputFile(holderId: string, input: {
        path: string;
        bytes: Buffer;
        executable: boolean;
    }, signal?: AbortSignal): Promise<void>;
    createVolume(proposal: VolumeProposal): Promise<void>;
    private assertVolume;
    inspectVolume(proposal: VolumeProposal): Promise<void>;
    /** Private exact cleanup only. Upper owner must retain its qualified engine epoch and resource identity. */
    removeVolume(proposal: VolumeProposal): Promise<void>;
    isVolumeAbsent(proposal: VolumeProposal): Promise<boolean>;
    isContainerAbsent(id: string): Promise<boolean>;
    createMounted(body: ReturnType<typeof buildDockerMountedRequest>): Promise<{
        Id: string;
    }>;
    /** Reconciliation lookup only. Never creates or starts a replacement container. */
    findMountedAttempt(attemptId: string): Promise<{
        Id: string;
    }>;
    private approvedRequest;
    create(body: ReturnType<typeof buildDockerWorkerRequest>): Promise<{
        Id: string;
    }>;
    /** Identity lookup only. Missing containers remain unknown; this neither starts nor proves quiescence. */
    recoverAttempt(body: ReturnType<typeof buildDockerWorkerRequest>): Promise<{
        Id: string;
    }>;
    attachOutput(id: string, options?: {
        timeoutMs?: number;
        maximumBytes?: number;
        signal?: AbortSignal;
        stdin?: Buffer;
    }): Promise<AttachedOutputCapture>;
    start(id: string): Promise<void>;
    wait(id: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<{
        StatusCode: number;
    }>;
    inspect(id: string): Promise<{
        Id: string;
        State: {
            Running: boolean;
            Pid: number;
            ExitCode: number;
            Status: string;
        };
        HostConfig: Record<string, unknown>;
        Config: Record<string, unknown>;
        Image: string;
    }>;
    kill(id: string): Promise<void>;
    logs(id: string): Promise<string>;
    /** Untrusted archive bytes only. Installed caller separately holds the worker's
     * exact physical receipt and opaque output-volume/holder binding before/after export. */
    readArtifactArchive(id: string, relativePath: string, options?: {
        signal?: AbortSignal;
        maxBytes?: number;
    }): Promise<Buffer>;
    /** Private input-sealing verification, never a model-selected container read. */
    readInputArchive(id: string, relativePath: string, options?: {
        signal?: AbortSignal;
    }): Promise<Buffer>;
    private readMountedArchive;
    remove(id: string): Promise<void>;
}
