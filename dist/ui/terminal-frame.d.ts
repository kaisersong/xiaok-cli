import type { SurfaceState } from './surface-state.js';
export interface TerminalFrame {
    lines: string[];
    cursor: {
        line: number;
        column: number;
    } | null;
}
export declare function buildTerminalFrame(state: SurfaceState): TerminalFrame;
