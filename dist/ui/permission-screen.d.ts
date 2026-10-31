import type { PermissionModalState } from './modal-state.js';
import type { ScrollPromptFrame } from './scroll-region.js';
/** Draw only in a caller-owned alternate screen; never mutate the transcript. */
export declare class PermissionScreen {
    private readonly stream;
    private pageIndex;
    private pages;
    private layoutKey;
    private reviewed;
    private fits;
    constructor(stream: NodeJS.WriteStream);
    page(delta: number): void;
    canApprove(): boolean;
    render(modal: PermissionModalState, frame: ScrollPromptFrame): void;
}
