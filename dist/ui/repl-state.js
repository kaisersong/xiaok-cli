import { boldCyan, dim } from './render.js';
import { getDisplayWidth, sliceByDisplayColumns } from './text-metrics.js';
export const MAX_MENU_DESCRIPTION_WIDTH = 24;
function truncateMenuDescription(desc, maxWidth) {
    const singleLine = desc.replace(/\s+/g, ' ').trim();
    if (maxWidth <= 0 || singleLine.length === 0)
        return '';
    if (getDisplayWidth(singleLine) <= maxWidth)
        return singleLine;
    if (maxWidth <= 3)
        return '.'.repeat(maxWidth);
    return `${sliceByDisplayColumns(singleLine, 0, maxWidth - 3)}...`;
}
function getVisibleMenuItems(items, selectedIdx, maxVisible) {
    if (items.length === 0 || maxVisible <= 0) {
        return { items: [], selectedOffset: 0 };
    }
    const clampedSelectedIdx = Math.max(0, Math.min(selectedIdx, items.length - 1));
    const visibleCount = Math.min(maxVisible, items.length);
    const maxStart = Math.max(items.length - visibleCount, 0);
    const start = Math.min(Math.max(clampedSelectedIdx - visibleCount + 1, 0), maxStart);
    const visibleItems = items.slice(start, start + visibleCount);
    return {
        items: visibleItems,
        selectedOffset: clampedSelectedIdx - start,
    };
}
export function buildSlashMenuOverlayLines(items, selectedIdx, columns, maxVisible) {
    const visibleMenu = getVisibleMenuItems(items, selectedIdx, maxVisible);
    return visibleMenu.items.map((item, index) => {
        const isSelected = index === visibleMenu.selectedOffset;
        const prefix = isSelected ? boldCyan('\u276f') : ' ';
        const cmdStr = isSelected ? boldCyan(item.cmd) : dim(item.cmd);
        const descWidth = Math.min(Math.max(columns - getDisplayWidth(item.cmd) - 8, 0), MAX_MENU_DESCRIPTION_WIDTH);
        const desc = truncateMenuDescription(item.desc, descWidth);
        const descStr = desc ? `  ${dim(desc)}` : '';
        return `  ${prefix} ${cmdStr}${descStr}`;
    });
}
