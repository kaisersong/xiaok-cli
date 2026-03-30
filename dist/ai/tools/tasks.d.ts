import type { Tool } from '../../types.js';
import { SessionTaskBoard } from '../../runtime/tasking/board.js';
export interface TaskToolOptions {
    board: SessionTaskBoard;
    sessionId: string;
}
export declare function createTaskTools(options: TaskToolOptions): Tool[];
