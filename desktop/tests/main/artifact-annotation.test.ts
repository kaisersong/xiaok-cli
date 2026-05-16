import { describe, expect, it } from 'vitest';
import {
  formatAnnotationForChat,
  buildAgentContext,
} from '../../renderer/src/hooks/useArtifactAnnotation';
import type { AnnotationPayload } from '../../renderer/src/components/ArtifactEditableViewer';

describe('useArtifactAnnotation', () => {
  const elementPayload: AnnotationPayload = {
    type: 'element',
    selector: 'section#kpi > div > div:nth-of-type(3) > div:nth-of-type(2)',
    text: '中国开源模型: 12',
    snapshot: 'uid=1 section#kpi\n  uid=2 div\n    uid=3 div:nth-of-type(3) "中国开源模型"\n      uid=4 div:nth-of-type(2) "12"',
    prompt: '改成 9',
  };

  const textPayload: AnnotationPayload = {
    type: 'text-selection',
    selector: 'section#intro > p',
    text: 'Anthropic以令人窒息的节奏完成了AI行业有史以来最集中的一轮突破',
    snapshot: 'uid=1 section#intro\n  uid=2 p "Anthropic以令人窒息的节奏..."',
    prompt: '改成英文',
    target: {
      type: 'text-range',
      text: 'Anthropic以令人窒息的节奏完成了AI行业有史以来最集中的一轮突破',
      start: { selector: 'p', path: [0], offset: 0 },
      end: { selector: 'p', path: [0], offset: 30 },
    },
  };

  describe('formatAnnotationForChat', () => {
    it('formats element annotation as a complete edit instruction block', () => {
      const result = formatAnnotationForChat(elementPayload, '/path/to/report.html');
      expect(result).toContain('请修改文件 /path/to/report.html：');
      expect(result).toContain('修改要求：改成 9');
      expect(result).toContain('目标元素：<section#kpi > div > div:nth-of-type(3) > div:nth-of-type(2)>');
      expect(result).toContain('元素内容：中国开源模型: 12');
      expect(result).toContain('DOM 上下文');
      expect(result).toContain('div:nth-of-type(2)');
    });

    it('formats text selection as a complete edit instruction block', () => {
      const result = formatAnnotationForChat(textPayload, '/path/to/report.html');
      expect(result).toContain('请修改文件 /path/to/report.html：');
      expect(result).toContain('修改要求：改成英文');
      expect(result).toContain('目标文字："Anthropic以令人窒息的节奏完成了AI行业有史以来最集中的一轮突破"');
      expect(result).toContain('Anthropic');
    });

    it('truncates long text selection in the target text section', () => {
      const longText: AnnotationPayload = {
        ...textPayload,
        text: 'A'.repeat(100),
      };
      const result = formatAnnotationForChat(longText, '/path/to/report.html');
      const targetLine = result.split('\n').find((line) => line.startsWith('目标文字：'));
      expect(targetLine).toBe(`目标文字："${'A'.repeat(100)}"`);
    });

    it('truncates very long text selection beyond 120 chars', () => {
      const veryLongText: AnnotationPayload = {
        ...textPayload,
        text: 'A'.repeat(130),
      };
      const result = formatAnnotationForChat(veryLongText, '/path/to/report.html');
      expect(result).toContain('...');
    });
  });

  describe('buildAgentContext', () => {
    it('builds complete context for element annotation', () => {
      const ctx = buildAgentContext(elementPayload, '/path/to/report.html', '改成 9');
      expect(ctx.action).toBe('edit-artifact');
      expect(ctx.artifact_path).toBe('/path/to/report.html');
      expect(ctx.selector).toBe(elementPayload.selector);
      expect(ctx.text).toBe(elementPayload.text);
      expect(ctx.dom_snapshot).toBe(elementPayload.snapshot);
      expect(ctx.user_intent).toBe('改成 9');
      expect(ctx.selectedText).toBeUndefined();
    });

    it('builds complete context for text selection with rangeAnchors', () => {
      const ctx = buildAgentContext(textPayload, '/path/to/report.html', '改成英文');
      expect(ctx.action).toBe('edit-artifact');
      expect(ctx.selectedText).toBe('Anthropic以令人窒息的节奏完成了AI行业有史以来最集中的一轮突破');
      expect(ctx.rangeAnchors).toBeDefined();
      expect((ctx.rangeAnchors as any).start).toBeDefined();
      expect((ctx.rangeAnchors as any).end).toBeDefined();
    });

    it('artifact_path is the provided file path', () => {
      const ctx = buildAgentContext(elementPayload, '/absolute/path/file.html', 'test');
      expect(ctx.artifact_path).toBe('/absolute/path/file.html');
    });
  });
});
