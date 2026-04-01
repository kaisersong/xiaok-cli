import type { SurfaceState } from './surface-state.js';
export declare class TerminalRenderer {
    private readonly stream;
    private previousLineCount;
    constructor(stream?: NodeJS.WriteStream);
    render(state: SurfaceState): void;
}
