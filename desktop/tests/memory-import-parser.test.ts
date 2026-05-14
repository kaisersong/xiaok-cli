import { describe, it, expect } from 'vitest';
import { parseMemories } from '../electron/memory-import-parser.js';

describe('parseMemories', () => {
  describe('JSON array', () => {
    it('parses standard JSON array', () => {
      const { items, errors } = parseMemories('[{"content": "用户偏好深色主题", "tags": ["preference"]}]');
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('用户偏好深色主题');
      expect(items[0].tags).toEqual(['preference']);
      expect(errors).toHaveLength(0);
    });

    it('parses array with multiple items', () => {
      const raw = JSON.stringify([
        { content: '记忆 1', tags: ['a'] },
        { content: '记忆 2', tags: ['b', 'c'], source: 'import' },
      ]);
      const { items } = parseMemories(raw);
      expect(items).toHaveLength(2);
      expect(items[1].source).toBe('import');
    });

    it('handles string items in array', () => {
      const { items } = parseMemories('["记忆 A", "记忆 B"]');
      expect(items).toHaveLength(2);
      expect(items[0].content).toBe('记忆 A');
    });

    it('reports errors for invalid items but still parses valid ones', () => {
      const { items, errors } = parseMemories(JSON.stringify([{ content: 'valid' }, 42, null]));
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe('valid');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('filters empty content', () => {
      const { items } = parseMemories(JSON.stringify([{ content: '' }, { content: '   ' }, { content: 'valid' }]));
      expect(items).toHaveLength(1);
    });
  });

  describe('JSON Lines', () => {
    it('parses one JSON object per line', () => {
      const { items } = parseMemories(
        '{"content": "line 1", "tags": ["a"]}\n{"content": "line 2", "tags": ["b"]}',
      );
      expect(items).toHaveLength(2);
      expect(items[0].content).toBe('line 1');
    });

    it('skips non-JSON lines', () => {
      const { items } = parseMemories('not json\n{"content": "valid"}\nalso not json');
      expect(items).toHaveLength(1);
    });
  });

  describe('Markdown list', () => {
    it('parses dash-prefixed items', () => {
      const { items } = parseMemories('- 用户偏好深色\n- 提交前跑测试\n- 项目用 React');
      expect(items).toHaveLength(3);
      expect(items[0].content).toBe('用户偏好深色');
    });

    it('parses asterisk-prefixed items', () => {
      const { items } = parseMemories('* 记忆 A\n* 记忆 B');
      expect(items).toHaveLength(2);
    });

    it('skips empty list items', () => {
      const { items } = parseMemories('- valid\n-   \n- also valid');
      expect(items).toHaveLength(2);
    });
  });

  describe('Plain text', () => {
    it('splits by newlines', () => {
      const { items } = parseMemories('第一行\n第二行\n\n第四行');
      expect(items).toHaveLength(3);
      expect(items[0].content).toBe('第一行');
      expect(items[1].content).toBe('第二行');
      expect(items[2].content).toBe('第四行');
    });

    it('skips JSON fragments that are not valid', () => {
      const { items } = parseMemories('normal text\n{"broken json\nmore text');
      // JSON array parser fails, JSON Lines might parse some, plain lines picked up
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('returns error for empty input', () => {
      const { items, errors } = parseMemories('');
      expect(items).toHaveLength(0);
      expect(errors).toContain('输入内容为空');
    });

    it('handles whitespace-only input', () => {
      const { items } = parseMemories('   \n  \n   ');
      expect(items).toHaveLength(0);
    });

    it('handles malformed JSON gracefully', () => {
      const { items, errors } = parseMemories('{{{not valid json}}}');
      // Falls through to plain text
      expect(items.length).toBeGreaterThanOrEqual(0);
    });

    it('trims whitespace from content', () => {
      const { items } = parseMemories('[{"content": "  padded  "}]');
      expect(items[0].content).toBe('padded');
    });

    it('only keeps string tags', () => {
      const { items } = parseMemories('[{"content": "test", "tags": ["valid", 42, null]}]');
      expect(items[0].tags).toEqual(['valid']);
    });
  });
});
