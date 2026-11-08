import { describe, expect, it, vi } from 'vitest';
import { createTtyHarness } from '../support/tty.js';
import { StatusBar } from '../../src/ui/statusbar.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { selectStatuslineFields } from '../../src/ui/statusline-selector.js';
import { DEFAULT_STATUSLINE_FIELDS } from '../../src/ui/statusline-preferences.js';
import { getDisplayWidth } from '../../src/ui/text-metrics.js';

async function withMenu(
  check: (h: ReturnType<typeof createTtyHarness>, pending: ReturnType<typeof selectStatuslineFields>, bar: StatusBar, renderer: ReplRenderer, region: ScrollRegionManager) => Promise<void>,
  columns = 80, rows = 24,
) {
  const h = createTtyHarness(columns, rows);
  const region = new ScrollRegionManager(process.stdout);
  const renderer = new ReplRenderer(process.stdout); renderer.setScrollRegion(region);
  const bar = new StatusBar(); bar.init('example-model', 'sess_example', '/projects/demo', 'auto');
  bar.setFields(['model', 'project']);
  region.begin();
  const pending = selectStatuslineFields(bar.getEditableFields(), {renderer, preview: fields => bar.getStatusLineForFields(fields)});
  try { await check(h, pending, bar, renderer, region); }
  finally { h.send('\x1b'); await pending.catch(() => undefined); region.end(); h.restore(); }
}

describe('statusline selector', () => {
  it('starts with current ordered fields checked and shows actual preview values', async () => {
    await withMenu(async (h, pending) => {
      expect(h.screen.text()).toContain('自定义状态栏');
      expect(h.screen.text()).toContain('❯ 1. [x] 模型名称');
      expect(h.screen.text()).toContain('2. [x] 项目名称');
      expect(h.screen.text()).toContain('example-model · demo');
      h.send('\r'); expect(await pending).toEqual(['model', 'project']);
      expect(h.emitter.listenerCount('data')).toBe(0);
      expect(h.screen.text()).not.toContain('自定义状态栏');
    });
  });
  it('toggles fields and reorders them with a live, non-mutating preview', async () => {
    await withMenu(async (h, pending, bar) => {
      h.send('\x1b[C');
      expect(h.screen.text()).toContain('demo · example-model');
      expect(bar.getFields()).toEqual(['model', 'project']);
      h.send(' ');
      expect(h.screen.text()).toContain('❯ 2. [ ] 模型名称');
      h.send('\r'); expect(await pending).toEqual(['project']);
      expect(bar.getFields()).toEqual(['model', 'project']);
    });
  });
  it.each(['\x1b', '\x03', '\x04', 'EOF'])('cancels on %j without changing live fields or leaving listeners', async key => {
    await withMenu(async (h, pending, bar) => {
      h.send(' ');
      if (key === 'EOF') h.emitter.emit('end'); else h.send(key);
      expect(await pending).toBeNull();
      expect(bar.getFields()).toEqual(['model', 'project']);
      expect(h.emitter.listenerCount('data')).toBe(0);
      expect(h.emitter.listenerCount('end')).toBe(0);
    });
  });
  it.each([
    [9, DEFAULT_STATUSLINE_FIELDS], [10, []], [11, ['model', 'project']], [12, null],
  ])('activates action index %s from the menu', async (index, result) => {
    await withMenu(async (h, pending) => {
      h.send('\x1b[B'.repeat(Number(index)) + '\r');
      expect(await pending).toEqual(result);
    });
  });
  it('handles batched arrows, toggles and enhanced Enter exactly once', async () => {
    await withMenu(async (h, pending) => {
      h.send('\x1b[B \x1b[13u');
      expect(await pending).toEqual(['model']);
      expect(h.emitter.listenerCount('data')).toBe(0);
    });
  });
  it('stops consuming a confirmed batch and releases the resize listener', async () => {
    await withMenu(async (h, pending) => {
      const during = process.stdout.listenerCount('resize');
      h.send('\x1b[C\rTRAILING_INPUT');
      const next = vi.fn(); h.emitter.on('data', next);
      expect(await pending).toEqual(['project', 'model']);
      expect(process.stdout.listenerCount('resize')).toBe(during - 1);
      expect(next).not.toHaveBeenCalled();
      h.emitter.removeListener('data', next);
    });
  });
  it('ignores unrelated Unicode even when its bytes arrive in separate chunks', async () => {
    await withMenu(async (h, pending) => {
      const text = Buffer.from('中文😀');
      for (const byte of text) h.emitter.emit('data', Buffer.from([byte]));
      h.send('\r'); expect(await pending).toEqual(['model', 'project']);
    });
  });
  it.each(['\x1b[B', '\x1bOB', '\x1b[13u'])('retains split key sequence %j across stdin chunks', async key => {
    await withMenu(async (h, pending) => {
      for (const byte of Buffer.from(key)) h.emitter.emit('data', Buffer.from([byte]));
      if (key.endsWith('B')) h.send(' \r');
      expect(await pending).toEqual(key.endsWith('B') ? ['model'] : ['model', 'project']);
    });
  });
  it('still accepts cancellation after an incomplete escape sequence', async () => {
    await withMenu(async (h, pending) => {
      h.send('\x1b['); h.send('\x03'); expect(await pending).toBeNull();
    });
  });
  it('shows a one-row preview for wide values and a placeholder for an empty choice', async () => {
    await withMenu(async (h, pending, bar, renderer) => {
      const spy = vi.spyOn(renderer, 'renderInput');
      bar.updateModel('很长的模型'.repeat(30));
      h.send('\x1b[B');
      const lines = spy.mock.calls.at(-1)![0].overlayLines!;
      const preview = lines.find(line => line.startsWith('预览：'))!;
      expect(preview).toContain('…'); expect(getDisplayWidth(preview)).toBeLessThanOrEqual(34);
      h.send(' \x1b[A ');
      expect(h.screen.text()).toContain('（已关闭）');
      h.send('\r'); expect(await pending).toEqual([]);
    }, 36, 16);
  });
  it('retains the selected last action and hint while scrolling a short terminal and resizing', async () => {
    await withMenu(async (h, pending, _bar, _renderer, region) => {
      h.send('\x1b[B'.repeat(12));
      expect(h.screen.text()).toContain('❯ 13. 取消');
      expect(h.screen.text()).toContain('Esc');
      h.resize(40, 14);
      region.updateSize(14, 40); process.stdout.emit('resize');
      expect(h.screen.text()).toContain('❯ 13. 取消');
      expect(h.screen.text().split('自定义状态栏').length - 1).toBe(1);
      h.send('\r'); expect(await pending).toBeNull();
    }, 36, 12);
  });
  it('releases input ownership when rendering throws during navigation', async () => {
    await withMenu(async (h, pending, _bar, renderer) => {
      const rejection = expect(pending).rejects.toThrow('render failure');
      vi.spyOn(renderer, 'renderInput').mockImplementationOnce(() => { throw Error('render failure'); });
      h.send('\x1b[B'); await rejection;
      expect(h.emitter.listenerCount('data')).toBe(0);
    });
  });
});
