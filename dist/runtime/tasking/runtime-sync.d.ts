import type { RuntimeHooks } from '../hooks.js';
import type { SessionTaskBoard } from './board.js';
export interface RuntimeSyncOptions {
    hooks: RuntimeHooks;
    board: SessionTaskBoard;
    sessionId: string;
    getActiveTaskId(): string | undefined;
}
export declare function wireTaskBoardToRuntimeSync(options: RuntimeSyncOptions): () => void;
