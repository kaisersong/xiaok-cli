import { describe, expect, it } from 'vitest';
import { createGhosttyVt } from '../support/ghostty-vt.mjs';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';

// This is the Ghostty VT engine, not our text-only TTY fixture. The physical
// terminal reflows BEFORE SIGWINCH reaches the production manager.
async function harness() {
  const { terminal, snapshot } = await createGhosttyVt();
  const stream = {
    columns: 110, rows: 40, isTTY: true,
    write(bytes: string) {
      // Match the PTY's ONLCR output processing without touching VT escapes.
      terminal.write(bytes.replace(/(?<!\r)\n/g, '\r\n'));
      return true;
    },
  } as NodeJS.WriteStream;
  const manager = new ScrollRegionManager(stream);
  return {
    terminal, manager, stream,
    text: () => snapshot().text,
    snapshot,
    resize(cols: number, rows: number) {
      terminal.resize(cols, rows);
      stream.columns = cols; stream.rows = rows;
      manager.updateSize(rows, cols);
    },
    close() { manager.end(); terminal.dispose(); },
  };
}

describe('Ghostty physical footer reflow from the first resize', () => {
  it.each(['', 'Thinking', 'Child 1\nChild 2\nThinking'])('retains history, one draft and subsequent output (activity=%s)', async activity => {
    const h = await harness();
    const history = Array.from({ length: 75 }, (_, i) => `HISTORY_${String(i).padStart(3, '0')}`);
    const longAnswer = 'LONG_' + 'reflow-word-'.repeat(36) + '_END';
    try {
      h.manager.begin();
      h.manager.writeAtContentCursor(history.join('\n') + '\n' + longAnswer + '\nANSWER_END\n');
      h.manager.renderPromptFrame({ inputValue: 'DRAFT_中文', cursor: 5, placeholder: '', statusLine: 'MODEL', owner: 'input' });
      if (activity) h.manager.renderActivity(activity);
      for (const [cols, rows] of [[65, 24], [110, 40], [40, 20], [100, 34], [55, 24], [110, 40]]) {
        h.resize(cols, rows);
        const screen = h.text();
        for (const marker of history) expect(screen.split(marker)).toHaveLength(2);
        expect(screen.replaceAll('\n', '')).toContain(longAnswer);
        expect(screen).toContain('ANSWER_END');
        expect(screen.split('DRAFT_中文')).toHaveLength(2);
        const { grayRows } = h.snapshot();
        expect(grayRows).toHaveLength(3);
        expect(grayRows).toEqual([grayRows[0], grayRows[0] + 1, grayRows[0] + 2]);
        h.manager.renderInput('DRAFT_中文X', 10);
        expect(h.text().split('DRAFT_中文X')).toHaveLength(2);
        h.manager.renderInput('DRAFT_中文', 5);
        expect(h.snapshot().cursor.x).toBe(7);
      }
      h.manager.writeAtContentCursor('NEXT_OUTPUT\n');
      expect(h.text()).toContain('ANSWER_END');
      expect(h.text()).toContain('NEXT_OUTPUT');
      expect(h.text().split('DRAFT_中文')).toHaveLength(2);
    } finally { h.close(); }
  });

  it.each(['question', 'permission', 'queued'] as const)('retains %s ownership through width and height changes', async kind => {
    const h = await harness();
    try {
      h.manager.begin(); h.manager.writeAtContentCursor('ANSWER_END\n');
      h.manager.renderPromptFrame({ inputValue: 'DRAFT', cursor: 3, placeholder: '', statusLine: 'MODEL',
        overlayLines: ['CHOICE_WAITING'], overlayKind: kind, owner: 'renderer' });
      for (const [cols, rows] of [[65, 24], [110, 40], [40, 20]]) {
        h.resize(cols, rows);
        expect(h.text()).toContain('ANSWER_END');
        expect(h.text().split('CHOICE_WAITING')).toHaveLength(2);
        expect(h.text().split('DRAFT')).toHaveLength(2);
        expect(h.manager.hasActiveOverlayPrompt()).toBe(true);
      }
    } finally { h.close(); }
  });

  it.each([
    [[65, 40], [110, 40], [40, 40]],
    [[110, 24], [110, 60], [110, 20]],
  ])('handles width-only and height-only geometry: %j', async (...sizes) => {
    const h = await harness();
    try {
      h.manager.begin(); h.manager.writeAtContentCursor('ANSWER_END\n');
      h.manager.renderInput('DRAFT', 3);
      for (const [cols, rows] of sizes) {
        h.resize(cols, rows);
        expect(h.text().split('DRAFT')).toHaveLength(2);
        expect(h.text()).toContain('ANSWER_END');
        expect(h.snapshot().grayRows).toHaveLength(3);
      }
    } finally { h.close(); }
  });

  it('handles coalesced geometry that returns to its original size', async () => {
    const h = await harness();
    try {
      h.manager.begin(); h.manager.writeAtContentCursor('ANSWER_END\n'); h.manager.renderInput('DRAFT', 3);
      h.terminal.resize(40, 20); h.terminal.resize(110, 40);
      h.manager.updateSize(40, 110);
      expect(h.text().split('DRAFT')).toHaveLength(2);
      expect(h.text()).toContain('ANSWER_END');
      expect(h.snapshot().grayRows).toHaveLength(3);
    } finally { h.close(); }
  });

  it('retains the final column of a full-width answer', async () => {
    const h = await harness();
    const answer = 'X'.repeat(109) + 'Z';
    try {
      h.manager.begin(); h.manager.writeAtContentCursor(answer); h.manager.renderInput('DRAFT', 3);
      h.resize(65, 24); h.resize(110, 40);
      expect(h.text().replaceAll('\n', '')).toContain(answer);
      expect(h.text().split('DRAFT')).toHaveLength(2);
    } finally { h.close(); }
  });

  it('keeps the footer singular when a resize arrives during output streaming', async () => {
    const h = await harness();
    try {
      h.manager.begin(); h.manager.renderInput('DRAFT', 3);
      h.manager.beginContentStreaming();
      h.manager.writeAtContentCursor('STREAM_PART_ONE\n');
      h.resize(65, 24); h.resize(110, 40);
      h.manager.writeAtContentCursor('STREAM_PART_TWO\n');
      h.manager.endContentStreaming();
      expect(h.text()).toContain('STREAM_PART_ONE');
      expect(h.text()).toContain('STREAM_PART_TWO');
      expect(h.text().split('DRAFT')).toHaveLength(2);
      expect(h.snapshot().grayRows).toHaveLength(3);
    } finally { h.close(); }
  });
});
