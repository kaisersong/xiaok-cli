import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { showPermissionPrompt } from '../../src/ui/permission-prompt.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { createTtyHarness } from '../support/tty.js';

const summary = '● Intent: md -> 报告 · Stage 2/2 生成报告 · Working';
const status = 'gpt-terminal-e2e · 4% · project';
const cases = [
  {toolName: 'write', input: {file_path: '/fixture/report.md'}, rule: 'write(/fixture/*)'},
  {toolName: 'edit', input: {file_path: '/fixture/report.md'}, rule: 'edit(/fixture/*)'},
  {toolName: 'read', input: {file_path: '/fixture/report.md'}, rule: 'read(/fixture/*)'},
  {toolName: 'glob', input: {pattern: '*.md'}, rule: 'glob'},
  {toolName: 'grep', input: {pattern: 'report'}, rule: 'grep'},
  {toolName: 'web_fetch', input: {url: 'https://example.com/report'}, rule: 'web_fetch'},
  {toolName: 'web_search', input: {query: 'report'}, rule: 'web_search'},
  {toolName: 'skill', input: {name: 'report-creator'}, rule: 'skill'},
  {toolName: 'bash', input: {}, rule: 'bash'},
  {toolName: 'sandbox-expand:read', input: {file_path: '/fixture/report.md'}, rule: 'sandbox-expand:read(/fixture/*)'},
];

function open(toolName: string, input: Record<string, unknown>, mode: 'scroll' | 'inline' | 'direct' = 'scroll') {
  const harness = createTtyHarness(60, 24);
  const region = new ScrollRegionManager(process.stdout);
  const renderer = new ReplRenderer(process.stdout);
  const abort = new AbortController();
  renderer.setScrollRegion(region);
  try {
    if (mode === 'scroll') {
      region.begin();
      region.writeAtContentCursor('  │ cd /fixture/one\n  │ cd /fixture/two\n  │ cd /fixture/three\n');
    }
    if (mode !== 'direct') renderer.renderInput({prompt: 'Type your message...', input: 'kept', cursor: 2, overlayLines: [], footerLines: [summary, status]});
    const counts = {data: harness.emitter.listenerCount('data'), end: harness.emitter.listenerCount('end'), resize: process.stdout.listenerCount('resize'), abort: getEventListeners(abort.signal, 'abort').length};
    const pending = showPermissionPrompt(toolName, input, {renderer, signal: abort.signal});
    return {harness, region, renderer, abort, pending, counts};
  } catch (error) {
    try {region.end();} finally {harness.restore();}
    throw error;
  }
}

type Context = ReturnType<typeof open>;
async function release(context: Context) {
  try {
    context.abort.abort();
    await context.pending;
    expect(context.harness.emitter.listenerCount('data')).toBe(context.counts.data);
    expect(context.harness.emitter.listenerCount('end')).toBe(context.counts.end);
    expect(process.stdout.listenerCount('resize')).toBe(context.counts.resize);
    expect(getEventListeners(context.abort.signal, 'abort').length).toBe(context.counts.abort);
  } finally {try {context.region.end();} finally {context.harness.restore();}}
}

describe('R261 real public non-bash permission controls', () => {
  it.each(cases)('$toolName retains the five displayed choices and a real once decision', async ({toolName, input, rule}) => {
    const context = open(toolName, input);
    try {
      const text = context.harness.screen.text();
      expect(text).toContain('工具: ' + toolName);
      expect(text).not.toContain('始终允许的范围:');
      expect(text).toContain('❯ 1. 允许一次');
      expect(text).toContain('2. 本次会话始终允许 ' + rule);
      expect(text).toContain('3. 始终允许 ' + rule + ' (保存到项目)');
      expect(text).toContain('4. 始终允许 ' + rule + ' (保存到全局)');
      expect(text).toContain('5. 拒绝');
      context.harness.send('1');
      expect(context.renderer.getState().modal).toBeFalsy();
      // Abort is real and only bounds a broken ignored key: a correct synchronous
      // once decision is already settled; an ignored key truthfully yields deny.
      context.abort.abort();
      expect(await context.pending).toEqual({action: 'allow_once'});
    } finally {await release(context);}
  });

  it.each(cases)('$toolName still accepts the actual deny choice', async ({toolName, input}) => {
    const context = open(toolName, input);
    try {
      context.harness.send('5');
      expect(context.renderer.getState().modal).toBeFalsy();
      context.abort.abort();
      expect(await context.pending).toEqual({action: 'deny'});
    } finally {await release(context);}
  });

  it.each([
    ['1', {action: 'allow_once'}],
    ['2', {action: 'allow_session', rule: 'write(/fixture/*)'}],
    ['3', {action: 'allow_project', rule: 'write(/fixture/*)'}],
    ['4', {action: 'allow_global', rule: 'write(/fixture/*)'}],
    ['5', {action: 'deny'}],
  ] as const)('write choice %s returns the original public choice contract', async (key, expected) => {
    const context = open('write', {file_path: '/fixture/report.md'});
    try {
      context.harness.send(key);
      expect(context.renderer.getState().modal).toBeFalsy();
      context.abort.abort();
      expect(await context.pending).toEqual(expected);
    } finally {await release(context);}
  });

  it.each(['\x1b[999;999H', '\u0085', '\u202e'])('retains full-rule control/Cf denial for non-bash %j', async control => {
    const context = open('write', {file_path: '/fixture/evil' + control + '/report.md'});
    try {
      expect(context.harness.screen.text()).toContain('范围显示无法安全核对');
      context.harness.send('1');
      expect(context.renderer.getState().modal).toBeTruthy();
      context.abort.abort();
      expect(await context.pending).toEqual({action: 'deny'});
    } finally {await release(context);}
  });
});

describe('R261 page key and managed output controls', () => {
  it.each(['direct', 'inline'] as const)('PgUp/PgDn do not repaint a real %s prompt', async mode => {
    const context = open('read', {file_path: '/fixture/report.md'}, mode);
    try {
      const before = context.harness.output.raw;
      context.harness.send('\x1b[5~');
      context.harness.send('\x1b[6~');
      expect(context.harness.output.raw).toBe(before);
      context.abort.abort();
      expect(await context.pending).toEqual({action: 'deny'});
    } finally {await release(context);}
  });

  it('defers updateFooter facts until the real modal closes', async () => {
    const context = open('bash', {command: 'ls /fixture'});
    try {
      const before = context.harness.output.raw;
      context.region.updateFooter('Type your message...', '● Intent: md -> 报告 · Updated', 'new-model');
      expect(context.harness.output.raw).toBe(before);
      expect(context.renderer.getState().modal).toBeTruthy();
      context.abort.abort();
      expect(await context.pending).toEqual({action: 'deny'});
      expect(context.harness.screen.text()).toContain('Updated');
      expect(context.harness.screen.text()).toContain('new-model');
    } finally {await release(context);}
  });

  const writers: Array<[string, (region: ScrollRegionManager) => void]> = [
    ['renderPromptFrame', region => region.renderPromptFrame({inputValue: 'next draft', cursor: 3, placeholder: 'Type your message...', summaryLine: summary, statusLine: status, overlayLines: []})],
    ['renderInput', region => region.renderInput('next draft', 3)],
    ['clearContentArea', region => region.clearContentArea()],
    ['clearVisibleViewport', region => region.clearVisibleViewport()],
    ['writeSubmittedInput', region => region.writeSubmittedInput('NEW_SUBMITTED_INPUT\n')],
    ['positionAfterContent', region => region.positionAfterContent()],
    ['positionCursorAtContentCursor', region => region.positionCursorAtContentCursor()],
    ['prepareForContent', region => region.prepareForContent()],
    ['clearLastInput', region => region.clearLastInput()],
    ['clearOverlayPromptState', region => region.clearOverlayPromptState()],
    ['endContentStreaming', region => region.endContentStreaming()],
    ['end', region => region.end()],
  ];
  it.each(writers)('%s cancels the real pending permission before managed screen mutation', async (_name, write) => {
    const context = open('bash', {command: 'ls /fixture'});
    try {
      const before = context.harness.output.raw.length;
      write(context.region);
      // Capture/assert before our cleanup abort can mask a missing invalidation.
      expect(context.renderer.getState().modal).toBeFalsy();
      expect(context.harness.output.raw.slice(before)).toContain('\x1b[?1049l');
      expect(await context.pending).toEqual({action: 'deny'});
    } finally {await release(context);}
  });
});
