import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { createTtyHarness } from '../support/tty.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';

describe('terminal return geometry', () => {
  it.each([false, true])('shifts content and chrome into the resized viewport (busy=%s)', busy => {
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    let output = ''; stream.on('data', data => { output += data.toString(); });
    const manager = new ScrollRegionManager(stream, { footerHeight: 3, gapHeight: 3, rows: 60, columns: 110 });
    manager.begin(); manager.setContentCursor(20); manager.writeAtContentCursor('TRANSCRIPT_TAIL');
    manager.renderInput('KEEP_DRAFT', 4);
    if (busy) manager.renderActivity('Thinking');
    output = '';
    manager.updateSize(24, 65);
    expect((manager as any)._cursorRow).toBe(1);
    expect(manager.getContentCursor()).toBe(20);
    const cursorRows = [...output.matchAll(/\x1b\[(\d+);\d+H/g)].map(match => Number(match[1]));
    expect(cursorRows.every(row => row <= 24)).toBe(true);
    expect(output).toContain('KEEP_DRAFT');
    manager.end();
  });
  it.each(['question', 'permission'] as const)('keeps the active %s owner and choices while resizing', kind => {
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    let output = ''; stream.on('data', data => { output += data.toString(); });
    const manager = new ScrollRegionManager(stream, { footerHeight: 3, gapHeight: 3, rows: 24, columns: 80 });
    manager.begin();
    manager.renderPromptFrame({ inputValue: 'DRAFT', cursor: 3, placeholder: '', statusLine: 'MODEL',
      overlayLines: ['CHOICE_WAITING'], overlayKind: kind, owner: 'renderer' });
    output = ''; manager.updateSize(30, 100);
    expect(output).toContain('CHOICE_WAITING');
    expect(manager.hasActiveOverlayPrompt()).toBe(true);
    manager.end();
  });

  it('does not erase the response tail when resize clips rows below the editor cursor', () => {
    const h = createTtyHarness(110, 60);
    const manager = new ScrollRegionManager(process.stdout);
    try {
      manager.begin(); manager.setContentCursor(53); manager.writeAtContentCursor('FINAL_RESPONSE');
      manager.renderInput('DRAFT', 3);
      h.resize(65, 24);
      expect(h.screen.text()).toContain('FINAL_RESPONSE');
      manager.updateSize(24, 65);
      expect(h.screen.text()).toContain('FINAL_RESPONSE');
      expect(h.screen.text()).toContain('DRAFT');
    } finally { manager.end(); h.restore(); }
  });

});
