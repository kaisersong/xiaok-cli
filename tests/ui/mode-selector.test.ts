import { describe, expect, it } from 'vitest';
import { selectPermissionMode } from '../../src/ui/mode-selector.js';
import { createTtyHarness } from '../support/tty.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { waitFor } from '../support/wait-for.js';

describe('mode selector', () => {
  it.each(['default', 'auto', 'plan', 'yolo'] as const)('starts on the current %s mode and confirms it', async current => {
    const h = createTtyHarness(110, 30);
    const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout); renderer.setScrollRegion(region);
    try {
      region.begin(); renderer.renderInput({ prompt: 'Type your message...', input: '', cursor: 0, footerLines: ['MODEL'], overlayLines: [] });
      const before = h.emitter.listenerCount('data');
      const pending = selectPermissionMode(current, { renderer });
      expect(h.screen.text()).toContain(`选择权限模式（当前：${current}）`);
      expect(h.screen.text()).toContain(`❯ ${['default','auto','plan','yolo'].indexOf(current)+1}. ${current}`);
      h.send('\r'); expect(await pending).toBe(current);
      expect(h.emitter.listenerCount('data')).toBe(before);
      expect(h.screen.text()).not.toContain('选择权限模式');
    } finally { region.end(); h.restore(); }
  });
  it('navigates with arrows and returns the selected mode only on confirmation', async () => {
    const h = createTtyHarness(110, 30); const renderer = new ReplRenderer(process.stdout);
    try {
      renderer.renderInput({ prompt: 'Type your message...', input: '', cursor: 0, footerLines: [], overlayLines: [] });
      const pending = selectPermissionMode('auto', { renderer });
      h.send('\x1b[B'); h.send('\x1b[B');
      expect(h.screen.text()).toContain('❯ 4. yolo');
      h.send('\r'); expect(await pending).toBe('yolo');
    } finally { h.restore(); }
  });
  it.each(['\x1b', '\x03', 'EOF'])('cancels on %j and releases input listeners', async key => {
    const h = createTtyHarness(110, 30); const renderer = new ReplRenderer(process.stdout);
    try {
      const pending = selectPermissionMode('auto', { renderer });
      if (key === 'EOF') h.emitter.emit('end'); else h.send(key);
      expect(await pending).toBeNull();
      expect(h.emitter.listenerCount('data')).toBe(0);
      expect(h.emitter.listenerCount('end')).toBe(0);
    } finally { h.restore(); }
  });
  it('never selects a mode automatically without a TTY', async () => {
    const h = createTtyHarness(80, 24);
    try {
      process.stdin.isTTY = false;
      expect(await selectPermissionMode('yolo', { renderer: new ReplRenderer(process.stdout) })).toBeNull();
      expect(h.emitter.listenerCount('data')).toBe(0);
    } finally { h.restore(); }
  });
  it('handles batched arrow and enhanced Enter keys without losing selection', async () => {
    const h = createTtyHarness(110, 30);
    let pending: Promise<unknown> | undefined;
    try {
      let chosen: unknown = 'waiting';
      pending = selectPermissionMode('auto', { renderer: new ReplRenderer(process.stdout) });
      void pending.then(value => { chosen = value; });
      h.send('\x1b[B\x1b[B\x1b[13u');
      await waitFor(() => expect(chosen).toBe('yolo'));
    } finally { h.send('\x1b'); await pending; h.restore(); }
  });
  it('keeps the selected choice visible in a 12-row terminal', async () => {
    const h = createTtyHarness(40, 12); const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout); renderer.setScrollRegion(region);
    let pending: Promise<unknown> | undefined;
    try {
      region.begin(); pending = selectPermissionMode('default', { renderer });
      expect(h.screen.text()).toContain('❯ 1. default');
      h.send('\x1b[A');
      expect(h.screen.text()).toContain('❯ 4. yolo');
    } finally { h.send('\x1b'); await pending; region.end(); h.restore(); }
  });
});
