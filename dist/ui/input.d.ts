import type { SkillMeta } from '../ai/skills/loader.js';
import type { PermissionMode } from '../ai/permissions/manager.js';
export interface InputSnapshot {
    input: string;
    cursor: number;
}
export interface InputHistoryState {
    undoStack: InputSnapshot[];
    redoStack: InputSnapshot[];
}
/** 向左找词边界（Ctrl+W / Alt+Left 用） */
export declare function wordBoundaryLeft(text: string, cursor: number): number;
/** 向右找词边界（Alt+Right 用） */
export declare function wordBoundaryRight(text: string, cursor: number): number;
export declare function getSlashCommands(skills: SkillMeta[]): Array<{
    cmd: string;
    desc: string;
}>;
export declare function truncateMenuDescription(desc: string, maxWidth: number): string;
export declare function getMenuClearSequence(lineCount: number): string;
export declare function cyclePermissionMode(mode: PermissionMode): PermissionMode;
export declare function createInputHistoryState(): InputHistoryState;
export declare function pushInputHistory(state: InputHistoryState, input: string, cursor: number): InputHistoryState;
export declare function undoInputHistory(state: InputHistoryState, currentInput: string, currentCursor: number): {
    history: InputHistoryState;
    input: string;
    cursor: number;
};
export declare function redoInputHistory(state: InputHistoryState, currentInput: string, currentCursor: number): {
    history: InputHistoryState;
    input: string;
    cursor: number;
};
export declare class InputReader {
    private history;
    private historyIdx;
    private menuOpen;
    private menuItems;
    private menuIdx;
    private skills;
    private onModeCycle?;
    setSkills(skills: SkillMeta[]): void;
    setModeCycleHandler(handler: () => PermissionMode): void;
    read(prompt: string): Promise<string | null>;
}
