import { describe, it, expect, vi } from 'vitest';
import { renderWelcomeScreen } from '../../src/ui/render.js';
import { getDisplayWidth } from '../../src/ui/display-width.js';

describe('bundled Punctum welcome', () => {
  it.each([80, 120])('renders the embedded glyphs without changing the welcome row geometry at %i columns', (columns) => {
    const before = process.stdout.columns;
    const tmux = process.env.TMUX;
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s = '') => lines.push(String(s)));
    process.stdout.columns = columns;
    process.env.TMUX = 'test-punctum';
    try {
      const count = renderWelcomeScreen({ model: 'test-model', cwd: '/tmp', mode: 'auto', sessionId: 'test', version: '1.5.9' });
      expect(lines.join('\n')).toContain(":   :  ':'");
      expect(count).toBe(11);
      expect(lines).toHaveLength(11);
      expect(lines.every(line => getDisplayWidth(line) <= columns)).toBe(true);
    } finally {
      spy.mockRestore();process.stdout.columns = before;
      if (tmux === undefined) delete process.env.TMUX; else process.env.TMUX = tmux;
    }
  });
  it('preserves the narrow-terminal text fallback', () => {
    const before = process.stdout.columns;
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((s = '') => lines.push(String(s)));
    process.stdout.columns = 40;
    try {
      renderWelcomeScreen({ model: 'test', cwd: '/tmp', mode: 'auto', sessionId: 'test', version: '1.5.9' });
      expect(lines.join('\n')).not.toContain(":   :  ':'");
      expect(lines.join('\n')).toContain('xiaok code');
    } finally { spy.mockRestore();process.stdout.columns = before; }
  });
});
