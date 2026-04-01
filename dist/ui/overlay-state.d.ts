export interface SlashOverlayItem {
    cmd: string;
    desc: string;
}
export interface SlashOverlayState {
    type: 'slash';
    query: string;
    items: SlashOverlayItem[];
    selectedIndex: number;
}
export interface LineOverlayState {
    type: 'lines';
    lines: string[];
}
export type OverlayState = SlashOverlayState | LineOverlayState;
