import { describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { separateAssistantNarration } from '../../renderer/src/lib/assistant-narration';
import { MarkdownRenderer } from '../../renderer/src/components/MarkdownRenderer';
vi.mock('../../renderer/src/components/MermaidBlock', () => ({ MermaidBlock: () => null }));
afterEach(cleanup);
describe('assistant narration tool boundaries', () => {
  it('renders separate model rounds without cross-round strikethrough', () => {
    const text = separateAssistantNarration('下载工具链（~1GB）。') + '构建需要10~20分钟。';
    const { container } = render(<MarkdownRenderer content={text} />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelector('del')).toBeNull();
    expect(container.textContent).toContain('~1GB');
  });
  it('preserves chunks, existing paragraph boundaries and empty tool rounds', () => {
    expect(separateAssistantNarration('')).toBe('');
    expect(separateAssistantNarration('abc\n\n')).toBe('abc\n\n');
    expect(separateAssistantNarration(separateAssistantNarration('abc'))).toBe('abc\n\n');
    expect(separateAssistantNarration('ab' + 'c')).toBe('abc\n\n');
  });
  it('keeps lists and fenced code valid across completed rounds', () => {
    const text = separateAssistantNarration('1. 查配置\n2. 构建\n\n```sh\necho ok\n```') + '**完成**';
    const { container } = render(<MarkdownRenderer content={text} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toBe('echo ok\n');
    expect(container.querySelector('strong')?.textContent).toBe('完成');
  });
});

it('projects a matching raw result summary to the formatted narration without changing unrelated summaries', async () => {
  const { projectNarrationSummary } = await import('../../renderer/src/lib/assistant-narration');
  const events = [{ type: 'assistant_delta', delta: '先检查。' }, { type: 'canvas_tool_call' }, { type: 'assistant_delta', delta: '完成。' }];
  const result = { summary: '先检查。完成。', artifacts: ['retained'] };
  expect(projectNarrationSummary(result, '先检查。\n\n完成。', events)).toEqual({ summary: '先检查。\n\n完成。', artifacts: ['retained'] });
  expect(result.summary).toBe('先检查。完成。');
  const distinct = { ...result, summary: '独立结果总结' };
  expect(projectNarrationSummary(distinct, '先检查。\n\n完成。', events)).toBe(distinct);
});
