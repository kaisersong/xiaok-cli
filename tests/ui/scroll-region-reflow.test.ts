import { describe, expect, it } from 'vitest';
import xterm from '@xterm/headless';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';

function terminalHarness(columns = 110, rows = 40) {
  const terminal = new xterm.Terminal({ cols: columns, rows, scrollback: 2000, convertEol: true, allowProposedApi: true });
  // A real VT parser owns reflow and CPR. Its synchronous adapter models the
  // production transport's serialized resize/query frame, without copying it.
  const write = (text: string) => (terminal as unknown as { _core: { writeSync(text: string): void } })._core.writeSync(text);
  const stream = { rows, columns, write: (text: string) => { write(text); return true; } } as unknown as NodeJS.WriteStream;
  let requests = 0;
  const readCursor = (_stream: NodeJS.WriteStream, restore: string) => {
    requests++;
    let reply = '';
    const listener = terminal.onData(data => { reply += data; });
    write(restore + '\x1b[6n');
    listener.dispose();
    const report = /\x1b\[(\d+);(\d+)R/.exec(reply);
    return report ? { row: Number(report[1]), column: Number(report[2]), rows: terminal.rows, columns: terminal.cols } : null;
  };
  const manager = new ScrollRegionManager(stream, undefined, readCursor);
  const text = (viewportOnly = false) => {
    const buffer = terminal.buffer.active;
    return Array.from({ length: viewportOnly ? terminal.rows : buffer.length }, (_, i) =>
      buffer.getLine(i + (viewportOnly ? buffer.viewportY : 0))?.translateToString(true) ?? '').join('\n');
  };
  const resize = (cols: number, height: number) => {
    terminal.resize(cols, height); // Physical reflow must precede the host handler.
    stream.columns = cols; stream.rows = height;
    manager.updateSize(height, cols);
  };
  return { terminal, stream, manager, text, resize, requests: () => requests };
}

describe('footer on a terminal that actually reflows columns', () => {
  it.each(['', 'Thinking', 'Child 1\nChild 2\nThinking'])('keeps one editable footer and the full transcript (activity=%s)', activity => {
    const h = terminalHarness();
    try {
      h.manager.begin();
      const history = Array.from({ length: 75 }, (_, i) => `HISTORY_${String(i).padStart(3, '0')}`);
      const longAnswer = 'LONG_' + 'reflow-word-'.repeat(36) + '_END';
      h.manager.writeAtContentCursor(history.join('\n') + '\n' + longAnswer + '\nANSWER_END\n');
      h.manager.renderPromptFrame({ inputValue: 'DRAFT_中文', cursor: 5, placeholder: 'Type your message...', statusLine: 'MODEL', owner: 'input' });
      if (activity) h.manager.renderActivity(activity);
      for (const [cols, rows] of [[65, 24], [110, 40], [40, 20], [100, 34], [55, 24], [110, 40]]) {
        h.resize(cols, rows);
        for (const marker of history) expect(h.text().split(marker)).toHaveLength(2);
        expect(h.text().replaceAll('\n', '')).toContain(longAnswer);
        expect(h.text()).toContain('ANSWER_END');
        expect(h.text(true).split('DRAFT_中文')).toHaveLength(2);
        expect(h.text().split('DRAFT_中文')).toHaveLength(2);
        h.manager.renderInput('DRAFT_中文X', 10);
        expect(h.text(true)).toContain('DRAFT_中文X');
        h.manager.renderInput('DRAFT_中文', 5);
        expect(h.terminal.buffer.active.cursorX).toBe(7);
      }
      expect(h.requests()).toBe(6);
    } finally { h.manager.end(); h.terminal.dispose(); }
  });

  it.each(['question', 'permission'] as const)('retains the %s owner and draft through column reflow', kind => {
    const h = terminalHarness();
    try {
      h.manager.begin(); h.manager.writeAtContentCursor('ANSWER_END\n');
      h.manager.renderPromptFrame({ inputValue: 'DRAFT', cursor: 3, placeholder: '', statusLine: 'MODEL',
        overlayLines: ['CHOICE_WAITING'], overlayKind: kind, owner: 'renderer' });
      h.resize(65, 24);
      expect(h.text()).toContain('ANSWER_END');
      expect(h.text(true).split('CHOICE_WAITING')).toHaveLength(2);
      expect(h.text(true).split('DRAFT')).toHaveLength(2);
      expect(h.manager.hasActiveOverlayPrompt()).toBe(true);
    } finally { h.manager.end(); h.terminal.dispose(); }
  });

  it('repairs coalesced resizes even when the final dimensions equal the cached size', () => {
    const h = terminalHarness();
    try {
      h.manager.begin();
      h.manager.writeAtContentCursor('ANSWER_END\n');
      h.manager.renderInput('KEEP_DRAFT', 4);
      h.terminal.resize(65, 24);
      h.terminal.resize(110, 40);
      h.manager.updateSize(40, 110);
      expect(h.requests()).toBe(1);
      expect(h.text().split('KEEP_DRAFT')).toHaveLength(2);
      expect(h.text()).toContain('ANSWER_END');
    } finally { h.manager.end(); h.terminal.dispose(); }
  });

  it('invalidates old anchors during streaming and after end/begin', () => {
    const h = terminalHarness();
    try {
      h.manager.begin(); h.manager.writeAtContentCursor('OLD_ANSWER\n');
      h.manager.renderInput('DRAFT', 3);
      h.manager.beginContentStreaming();
      h.resize(65, 24);
      expect(h.requests()).toBe(0);
      h.manager.end(); h.manager.begin();
      h.resize(110, 40);
      expect(h.requests()).toBe(0);
    } finally { h.manager.end(); h.terminal.dispose(); }
  });

  it('does not erase the last character of a full-width answer', () => {
    const h = terminalHarness(80, 24);
    const answer = 'X'.repeat(79) + 'Z';
    try {
      h.manager.begin(); h.manager.writeAtContentCursor(answer);
      h.manager.renderFooter({ inputPrompt: 'Type your message...', statusLine: 'MODEL' });
      h.resize(100, 30);
      expect(h.text().replaceAll('\n', '')).toContain(answer);
      expect(h.requests()).toBe(1);
    } finally { h.manager.end(); h.terminal.dispose(); }
  });
});
