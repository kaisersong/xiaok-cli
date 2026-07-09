export interface Checkpoint {
    id: string;
    sessionId: string;
    stageId: string;
    boundary: 'stage-start' | 'stage-end';
    method: 'git-stash' | 'file-copy';
    ref: string;
    files: Record<string, string>;
    capturedAt: string;
    warnings?: string[];
}
export interface CheckpointDiff {
    path: string;
    status: 'added' | 'deleted' | 'modified';
}
export interface CaptureCheckpointOptions {
    maxFiles?: number;
}
export declare function captureCheckpoint(projectRoot: string, sessionId: string, stageId: string, boundary: Checkpoint['boundary'], options?: CaptureCheckpointOptions): Promise<Checkpoint>;
export declare function revertToCheckpoint(projectRoot: string, checkpoint: Checkpoint): Promise<{
    success: boolean;
    safetySnapshot?: Checkpoint;
    error?: string;
}>;
export declare function diffCheckpoints(from: Checkpoint, to: Checkpoint): Promise<readonly CheckpointDiff[]>;
