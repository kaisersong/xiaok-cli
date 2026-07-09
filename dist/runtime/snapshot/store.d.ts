import type { Checkpoint } from './checkpoint.js';
export declare function getCheckpointRoot(projectRoot: string): string;
export declare function getCheckpointDir(projectRoot: string, sessionId: string): string;
export declare function appendCheckpoint(projectRoot: string, checkpoint: Checkpoint): void;
export declare function listCheckpoints(projectRoot: string): Checkpoint[];
