import type { SkillMeta } from '../ai/skills/loader.js';
import type { PermissionMode } from '../ai/permissions/manager.js';
import type { TranscriptLogger } from './transcript.js';
import type { ReplRenderer } from './repl-renderer.js';
type MenuItem = {
    cmd: string;
    desc: string;
};
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
export declare function getSlashCommands(skills: SkillMeta[]): MenuItem[];
export declare function truncateMenuDescription(desc: string, maxWidth: number): string;
export declare function getMenuClearSequence(lineCount: number): string;
export declare function getVisibleMenuItems(items: MenuItem[], selectedIdx: number, maxVisible: number): {
    items: MenuItem[];
    selectedOffset: number;
    start: number;
};
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
    private readonly renderer?;
    private history;
    private historyIdx;
    private menuOpen;
    private menuItems;
    private menuIdx;
    private renderedMenuRows;
    private skills;
    private onModeCycle?;
    private transcriptLogger?;
    private statusLineProvider?;
    constructor(renderer?: ReplRenderer | undefined);
    setSkills(skills: SkillMeta[]): void;
    setModeCycleHandler(handler: () => PermissionMode): void;
    setTranscriptLogger(logger: TranscriptLogger | undefined): void;
    setStatusLineProvider(provider: (() => string[]) | undefined): void;
    read(prompt: string): Promise<string | null>;
}
export {};
