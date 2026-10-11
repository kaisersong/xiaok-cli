import { describe, expect, it } from 'vitest';
import { buildSlashMenuOverlayLines } from '../../src/ui/repl-state.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { createTtyHarness } from '../support/tty.js';

const commands = Array.from({ length: 8 }, (_, index) => ({
  cmd: `/command-${index}`, desc: `Command ${index}`,
}));

describe('slash menu transcript spacing', () => {
  it.each([24, 12].flatMap(rows => [false, true].flatMap(trailingNewline =>
    (['generic', 'permission', 'question', 'feedback', 'queued'] as const).map(kind => ({ rows, trailingNewline, kind })))))(
    'separates $kind menu in $rows rows (trailing newline: $trailingNewline) without repeated scrolling', ({ rows, trailingNewline, kind }) => {
    const harness = createTtyHarness(80, rows);
    const manager = new ScrollRegionManager(process.stdout);
    try {
      manager.begin();
      const transcript = Array.from({ length: manager.maxContentRows }, (_, index) =>
        index === manager.maxContentRows - 1 ? 'LAST_TRANSCRIPT_LINE' : `transcript ${index}`).join('\n');
      manager.writeAtContentCursor(transcript + (trailingNewline ? '\n' : ''));
      const render = (selected: number) => manager.renderPromptFrame({
        inputValue: '/', cursor: 1, placeholder: 'Type your message...',
        statusLine: 'MODEL_STATUS', overlayLines: buildSlashMenuOverlayLines(commands, selected, 80, 8),
        overlayKind: kind, owner: 'renderer',
      });
      render(0);
      const before = harness.screen.lines();
      const transcriptIndex = before.findIndex(line => line.includes('LAST_TRANSCRIPT_LINE'));
      const menuIndex = before.findIndex(line => line.includes('/command-'));
      expect(transcriptIndex).toBeGreaterThanOrEqual(0);
      expect(menuIndex).toBeGreaterThan(transcriptIndex + 1);
      expect(before[menuIndex - 1]).toBe('');
      for (let selected = 0; selected < 8; selected += 1) render(selected);
      const after = harness.screen.lines();
      expect(after.findIndex(line => line.includes('LAST_TRANSCRIPT_LINE'))).toBe(transcriptIndex);
      manager.renderPromptFrame({
        inputValue: 'KEEP_DRAFT', cursor: 4, placeholder: 'Type your message...',
        statusLine: 'MODEL_STATUS', overlayLines: [],
        owner: 'renderer',
      });
      const closed = harness.screen.lines();
      expect(closed.some(line => line.includes('/command-'))).toBe(false);
      expect(closed.filter(line => line.includes('KEEP_DRAFT'))).toHaveLength(1);
      expect(closed.filter(line => line.includes('MODEL_STATUS'))).toHaveLength(1);
      expect(closed.some(line => line.includes('LAST_TRANSCRIPT_LINE'))).toBe(true);
    } finally {
      harness.restore();
    }
  });

  it('does not leave an empty overlay when there are no candidates', () => {
    expect(buildSlashMenuOverlayLines([], 0, 80, 8)).toEqual([]);
  });

  it('keeps a command visible when the terminal can fit only one overlay row', () => {
    const harness = createTtyHarness(80, 8);
    const manager = new ScrollRegionManager(process.stdout);
    try {
      manager.begin();
      manager.renderPromptFrame({
        inputValue: '/', cursor: 1, placeholder: 'Type your message...', statusLine: '',
        overlayLines: buildSlashMenuOverlayLines(commands, 7, 80, 8),
      });
      expect(harness.screen.lines().some(line => line.includes('/command-7'))).toBe(true);
    } finally {
      harness.restore();
    }
  });
});
