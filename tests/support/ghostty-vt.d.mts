import type { VtTerminal } from '@gkoreli/ghostty-vt-js/browser-terminal';
export function createGhosttyVt(columns?: number, rows?: number): Promise<{
  terminal: VtTerminal;
  snapshot(): { text: string; grayRows: number[]; cursor: { x: number; y: number; visible: boolean } };
}>;
