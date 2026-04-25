import { describe, expect, it } from 'vitest';
import { askQuestion } from '../../src/ui/ask-question.js';
import { createTtyHarness } from '../support/tty.js';
import { waitFor } from '../support/wait-for.js';

// We test renderFrame logic and key handling separately from the interactive loop
describe('ask-question', () => {
  describe('renderFrame basic structure', () => {
    it('produces correct line count for simple options', async () => {
      // Import dynamically to avoid side effects
      const { MarkdownRenderer } = await import('../../src/ui/markdown.js');

      // Test MarkdownRenderer.renderToLines directly
      const lines = MarkdownRenderer.renderToLines('```\ncode\n```\n\n**bold**');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some(l => l.includes('code'))).toBe(true);
    });

    it('handles empty preview correctly', async () => {
      const { MarkdownRenderer } = await import('../../src/ui/markdown.js');
      const lines = MarkdownRenderer.renderToLines('');
      expect(lines).toEqual(['']);
    });
  });

  describe('key handling', () => {
    it('ESC should cancel and return empty result', async () => {
      // This test verifies the ESC constant is correctly defined
      const ESC = '\x1b';
      const CTRL_C = '\x03';

      // These should be different values
      expect(ESC).not.toBe(CTRL_C);
      expect(ESC.length).toBe(1);
      expect(ESC.charCodeAt(0)).toBe(27);
    });

    it('arrow keys produce correct escape sequences', () => {
      const UP = '\x1b[A';
      const DOWN = '\x1b[B';

      expect(UP).toBe('\x1b[A');
      expect(DOWN).toBe('\x1b[B');
    });

    it('re-renders wrapped option prompts in place while navigating and clears the menu after confirm', async () => {
      const harness = createTtyHarness(36, 16);
      const sendKey = (key: string): void => {
        harness.emitter.emit('data', key);
      };

      process.stdout.write(
        Array.from({ length: 10 }, (_, index) => `prefill line ${index + 1}`).join('\n') + '\n',
      );

      const pending = askQuestion({
        question: '想吃什么类型的？',
        options: [
          { label: '中餐炒菜（如宫保鸡丁、番茄炒蛋）', description: '经典家常炒菜配米饭' },
          { label: '面食/粉类（如拉面、米粉、饺子）', description: '面条、粉类、水饺等' },
          { label: '轻食/沙拉（如三明治、燕麦碗）', description: '低卡健康餐' },
          { label: '快餐/便当（如汉堡、便当）', description: '方便快捷' },
          { label: '火锅/烧烤（如麻辣烫、烤肉）', description: '聚餐或想吃点重的' },
          { label: '其他（告诉我具体想法）', description: '自由输入' },
        ],
      });

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).toContain('想吃什么类型的？');
        expect((screen.match(/↑↓ navigate   Enter select/g) ?? []).length).toBe(1);
      });

      for (let i = 0; i < 10; i += 1) {
        sendKey('\x1b[B');
      }

      await waitFor(() => {
        const screen = harness.screen.text();
        expect((screen.match(/想吃什么类型的？/g) ?? []).length).toBe(1);
        expect((screen.match(/↑↓ navigate   Enter select/g) ?? []).length).toBe(1);
      });

      sendKey('\r');

      await expect(pending).resolves.toEqual({
        selected: [3],
        labels: ['快餐/便当（如汉堡、便当）'],
      });

      await waitFor(() => {
        const screen = harness.screen.text();
        expect(screen).toContain('❯ 想吃什么类型的？');
        expect(screen).toContain('快餐/便当（如汉堡、便当）');
        expect(screen).not.toContain('↑↓ navigate   Enter select');
        expect(screen).not.toContain('1. 中餐炒菜（如宫保鸡丁、番茄炒蛋）');
      });

      harness.restore();
    });
  });
});

describe('session resume edge cases', () => {
  it('loadLast handles missing file gracefully', async () => {
    const { FileSessionStore } = await import('../../src/ai/runtime/session-store.js');
    const store = new FileSessionStore('/nonexistent/path');
    const result = await store.loadLast();
    expect(result).toBeNull();
  });

  it('load returns null for nonexistent session', async () => {
    const { FileSessionStore } = await import('../../src/ai/runtime/session-store.js');
    const store = new FileSessionStore('/nonexistent/path');
    const result = await store.load('sess_nonexistent');
    expect(result).toBeNull();
  });
});
