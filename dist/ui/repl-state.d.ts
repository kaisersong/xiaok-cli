export interface ReplInputFrame {
    prompt: string;
    input: string;
    overlayLines: string[];
    footerLines?: string[];
    cursor: number;
}
export declare const MAX_MENU_DESCRIPTION_WIDTH = 24;
export declare function buildSlashMenuOverlayLines(items: Array<{
    cmd: string;
    desc: string;
}>, selectedIdx: number, columns: number, maxVisible: number): string[];
