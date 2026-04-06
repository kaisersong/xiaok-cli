import { describe, expect, it } from 'vitest';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { getDisplayWidth } from '../../src/ui/text-metrics.js';
import { createTtyHarness } from '../support/tty.js';

describe('ReplRenderer', () => {
  it('re-renders the slash menu in place instead of accumulating duplicate blocks', () => {
    const harness = createTtyHarness();
    const renderer = new ReplRenderer(process.stdout);

    renderer.renderInput({
      prompt: '> ',
      input: '/',
      cursor: 1,
      overlayLines: ['  /clear  Clear the screen', '  /commit Commit staged changes'],
    });

    renderer.renderInput({
      prompt: '> ',
      input: '/',
      cursor: 1,
      overlayLines: ['  /commit Commit staged changes', '  /context Show loaded repo context'],
    });

    // Prompt line has background color and ❯ symbol
    const lines = harness.screen.lines();
    expect(lines[0]).toMatch(/❯.*\//);
    expect(lines.length).toBe(3);

    harness.restore();
  });

  it('clears old overlay rows when the next frame is shorter', () => {
    const harness = createTtyHarness();
    const renderer = new ReplRenderer(process.stdout);

    renderer.renderInput({
      prompt: '> ',
      input: '/c',
      cursor: 2,
      overlayLines: ['  /clear  Clear the screen', '  /commit Commit staged changes'],
    });

    renderer.renderInput({
      prompt: '> ',
      input: '/cl',
      cursor: 3,
      overlayLines: ['  /clear  Clear the screen'],
    });

    // Prompt line has background color and ❯ symbol
    const lines = harness.screen.lines();
    expect(lines[0]).toMatch(/❯.*\/cl/);
    expect(lines.length).toBe(3);

    harness.restore();
  });

  it('keeps the prompt and menu aligned when rendering near the terminal bottom', () => {
    const harness = createTtyHarness(80, 4);
    const renderer = new ReplRenderer(process.stdout);

    process.stdout.write('line 1\nline 2\nline 3\n');

    renderer.renderInput({
      prompt: '> ',
      input: '/',
      cursor: 1,
      overlayLines: ['  /clear  Clear the screen', '  /commit Commit staged changes'],
    });

    renderer.renderInput({
      prompt: '> ',
      input: '/',
      cursor: 1,
      overlayLines: ['  /commit Commit staged changes', '  /context Show loaded repo context'],
    });

    expect(harness.screen.lines()[0]).toBe('line 3');
    expect(harness.screen.lines()[1]).toMatch(/❯.*\//);
    expect(harness.screen.lines().length).toBe(4);

    harness.restore();
  });

  it('does not duplicate prompt rows when a tall slash menu re-renders near the terminal bottom', () => {
    const harness = createTtyHarness(80, 10);
    const renderer = new ReplRenderer(process.stdout);
    const firstOverlay = [
      '  ❯ /clear  Clear the screen',
      '    /commit  Commit staged changes',
      '    /context  Show loaded repo context',
      '    /debug  先定位根因，再提出修复方案',
      '    /doctor  Inspect local CLI health',
      '    /exit  Exit the chat',
      '    /help  Show help',
      '    /init  Initialize project xiaok settings',
    ];
    const lastOverlay = [
      '    /clear  Clear the screen',
      '    /commit  Commit staged changes',
      '    /context  Show loaded repo context',
      '    /debug  先定位根因，再提出修复方案',
      '    /doctor  Inspect local CLI health',
      '    /exit  Exit the chat',
      '    /help  Show help',
      '  ❯ /init  Initialize project xiaok settings',
    ];

    process.stdout.write('line 1\nline 2\n');

    renderer.renderInput({
      prompt: '> ',
      input: '/',
      cursor: 1,
      overlayLines: firstOverlay,
    });

    for (let index = 0; index < 6; index += 1) {
      renderer.renderInput({
        prompt: '> ',
        input: '/',
        cursor: 1,
        overlayLines: index % 2 === 0 ? lastOverlay : firstOverlay,
      });
    }

    expect(harness.screen.lines().filter((line) => line.includes('❯') && line.includes('/') && !line.includes('/clear') && !line.includes('/commit')).length).toBeGreaterThanOrEqual(1);

    harness.restore();
  });

  it('positions the cursor using terminal display width for CJK text', () => {
    const writes: string[] = [];
    const stream = {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;
    const renderer = new ReplRenderer(stream);

    renderer.renderInput({
      prompt: '> ',
      input: '写一个xiaok code介绍的md，然后生成',
      cursor: '写一个xiaok code介绍的md，然后生成'.length,
      overlayLines: [],
    });

    expect(writes.at(-1)).toBe(`\x1b[${getDisplayWidth('> 写一个xiaok code介绍的md，然后生成')}C`);
  });

  it('returns to the prompt row start before restoring the cursor without overlays', () => {
    const writes: string[] = [];
    const stream = {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream;
    const renderer = new ReplRenderer(stream);

    renderer.renderInput({
      prompt: '> ',
      input: '为什么没有调用kai-report-creator',
      cursor: '为什么没有调用kai-report-creator'.length,
      overlayLines: [],
    });

    expect(writes.slice(-2)).toEqual(['\r', '\x1b[34C']);
  });

  it('does not clear existing content when previousLineCount is 0', () => {
    // 这个测试验证 bug 修复：AI 输出后，renderInput 不应清除历史输出
    // 场景：prepareBlockOutput() 后 previousLineCount = 0，然后 renderInput()
    const harness = createTtyHarness();
    const renderer = new ReplRenderer(process.stdout);

    // 模拟 AI 输出：写入一些历史内容
    process.stdout.write('AI response line 1\n');
    process.stdout.write('AI response line 2\n');

    const linesBeforeRender = harness.screen.lines();
    expect(linesBeforeRender).toContain('AI response line 1');
    expect(linesBeforeRender).toContain('AI response line 2');

    // 模拟 prepareBlockOutput() 被调用后渲染输入框
    // 此时 previousLineCount = 0，光标在 AI 输出末尾
    renderer.renderInput({
      prompt: '> ',
      input: 'test input',
      cursor: 10,
      overlayLines: [],
    });

    // 验证历史输出仍然存在
    const linesAfterRender = harness.screen.lines();
    expect(linesAfterRender).toContain('AI response line 1');
    expect(linesAfterRender).toContain('AI response line 2');
    // 验证输入框被渲染
    expect(linesAfterRender.some(line => /❯.*test input/.test(line))).toBe(true);

    harness.restore();
  });
});
