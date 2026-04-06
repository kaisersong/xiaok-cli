import { describe, it, expect } from 'vitest';
import { identifyKey, resolveAction, loadKeybindingsSync } from '../../src/ui/keybindings.js';

describe('keybindings - newline support', () => {
  loadKeybindingsSync();

  describe('identifyKey - shift+enter sequences', () => {
    it('should identify VSCode terminal ESC+CR as shift+enter', () => {
      // VSCode terminal sends \x1b\r for shift+enter (when keybinding installed)
      const result = identifyKey('\x1b\r', 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('shift+enter');
      expect(result!.consumed).toBe(2);
    });

    it('should identify Kitty protocol ESC[13;2u as shift+enter', () => {
      // Kitty keyboard protocol: ESC[13;2u = Shift+Enter
      const result = identifyKey('\x1b[13;2u', 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('shift+enter');
      expect(result!.consumed).toBe(7); // ESC[13;2u = 7 bytes
    });

    it('should identify modifyOtherKeys ESC[27;2;13~ as shift+enter', () => {
      // xterm modifyOtherKeys: ESC[27;2;13~ = Shift+Enter
      const result = identifyKey('\x1b[27;2;13~', 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('shift+enter');
      expect(result!.consumed).toBe(10); // ESC[27;2;13~ = 10 bytes
    });

    it('should identify plain CR as enter', () => {
      const result = identifyKey('\r', 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('enter');
      expect(result!.consumed).toBe(1);
    });

    it('should identify LF (ctrl+j) as ctrl+j for newline fallback', () => {
      const result = identifyKey('\n', 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('ctrl+j');
      expect(result!.consumed).toBe(1);
    });

    it('should NOT identify bare ESC+CR as two separate keys', () => {
      // Ensure the sequence is consumed as one unit
      const data = '\x1b\rabc';
      const result = identifyKey(data, 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('shift+enter');
      expect(result!.consumed).toBe(2);
      // Next call should start from offset 2
      const nextResult = identifyKey(data, 2);
      expect(nextResult).toBeNull(); // 'a' is printable
    });
  });

  describe('resolveAction - newline action mapping', () => {
    it('should map shift+enter to newline action', () => {
      const action = resolveAction('shift+enter');
      expect(action).toBe('newline');
    });

    it('should map enter to submit action', () => {
      const action = resolveAction('enter');
      expect(action).toBe('submit');
    });

    it('should map ctrl+j to newline action (fallback)', () => {
      const action = resolveAction('ctrl+j');
      expect(action).toBe('newline');
    });
  });

  describe('edge cases', () => {
    it('should handle escape without following CR correctly', () => {
      const result = identifyKey('\x1b', 0);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('escape');
      expect(result!.consumed).toBe(1);
    });

    it('should handle escape followed by other key (not CR)', () => {
      const result = identifyKey('\x1b[', 0);
      // ESC[ starts CSI sequence, but with no complete sequence
      // it should fall back to escape
      expect(result).not.toBeNull();
      expect(result!.key).toBe('escape');
      expect(result!.consumed).toBe(1);
    });
  });
});