import { describe, expect, it } from 'vitest';
import { PermissionScreen } from '../../src/ui/permission-screen.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { buildPermissionPromptOptions, deriveRule, formatPermissionPromptLines, showPermissionPrompt } from '../../src/ui/permission-prompt.js';
import { getUiCopy } from '../../src/ui/locale.js';
import { createTtyHarness } from '../support/tty.js';

const scopes = ['cd', 'cat', 'ls', 'find', 'sort', 'printf', 'sleep'];
const request = {
  toolName: 'bash',
  reviewScopes: scopes.map(command => `bash(${command} *)`),
  targetLines: ['本次执行命令: cd /fixture && cat /fixture/a && sleep 1',
    ...scopes.map(command => `始终允许的范围: bash(${command} *)（* 表示任意参数，参数变化无需重复确认）`)],
  options: ['允许一次', '本次会话始终允许', '保存到项目', '保存到全局', '拒绝'],
};

describe('R250 permission display isolation', () => {
  it('shows all seven scopes at the original 60x24 with the real Intent summary', async () => {
    const harness = createTtyHarness(60, 24);
    const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout);
    renderer.setScrollRegion(region);
    try {
      region.begin();
      region.writeAtContentCursor('  │ cd /fixture/one\n  │ cd /fixture/two\n  │ cd /fixture/three\n');
      renderer.renderInput({prompt: 'Type your message...', input: 'saved draft', cursor: 5, overlayLines: [], footerLines: ['● Intent: md -> 报告 · Stage 2/2 生成报告 · Working', 'model']});
      const frame = region.getPromptFrameState();
      const contentRows = region.maxContentRows;
      const offset = harness.output.raw.length;
      const command = "cd '/fixture' && cat '/fixture/source-a.md' >/dev/null && "
        + "ls -la '/fixture' >/dev/null && find '/fixture' -maxdepth 2 -type f | sort >/dev/null && "
        + 'printf "E2E_STRESS_RAN_1" && sleep 1';
      const pending = showPermissionPrompt('bash', {command}, {renderer});
      expect(region.getPromptFrameState()).toEqual(frame);
      expect(region.maxContentRows).toBe(contentRows);
      expect(harness.output.raw.slice(offset)).toContain('\x1b[?1049h');
      expect(harness.screen.text()).toContain('xiaok 想要执行以下操作');
      expect(harness.screen.text()).toContain('工具: bash');
      for (const scope of scopes) expect(harness.screen.text()).toContain(`bash(${scope} *)`);
      expect(harness.screen.text()).toContain('5. 拒绝');
      expect(harness.screen.text()).toContain('● Intent: md -> 报告');
      expect(renderer.canApprovePermissionModal()).toBe(true);
      harness.send('1');
      expect(await pending).toEqual({action: 'allow_once'});
      expect(harness.output.raw.slice(offset)).toContain('\x1b[?1049l');
      expect(harness.screen.text().match(/  │ cd /g)).toHaveLength(3);
      expect(renderer.getState().input.value).toBe('saved draft');
      expect(region.getPromptFrameState().inputValue).toBe('saved draft');
    } finally { renderer.closeModal(); region.end(); harness.restore(); }
  });

  it('requires all pages after resize before an allow and permits cancellation throughout', () => {
    const writes: string[] = [];
    const stream = { rows: 16, columns: 60, write: (value: string) => { writes.push(value); return true; } } as NodeJS.WriteStream;
    const screen = new PermissionScreen(stream);
    const modal = { ...request, type: 'permission' as const, selectedIndex: 0 };
    const frame = {inputValue: '', cursor: 0, placeholder: 'Type your message...', summaryLine: '', statusLine: 'model'};
    screen.render(modal, frame);
    expect(screen.canApprove()).toBe(false);
    for (let i = 0; i < 20; i++) { screen.page(1); screen.render(modal, frame); }
    expect(screen.canApprove()).toBe(true);
    stream.columns = 50;
    screen.render(modal, frame);
    expect(screen.canApprove()).toBe(false);
    stream.rows = 8;
    screen.render(modal, frame);
    expect(screen.canApprove()).toBe(false);
    expect(writes.join('')).toContain('Esc');
  });

  it('restores the real renderer after AbortSignal and ignores late decision input', async () => {
    const harness = createTtyHarness(60, 32);
    const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout);
    renderer.setScrollRegion(region);
    const abort = new AbortController();
    try {
      region.begin();
      renderer.renderInput({prompt: 'Type your message...', input: 'kept', cursor: 2, overlayLines: []});
      const pending = showPermissionPrompt('bash', {command: 'ls /fixture'}, {renderer, signal: abort.signal});
      abort.abort();
      expect(await pending).toEqual({action: 'deny'});
      harness.send('1');
      expect(renderer.getState().modal).toBeFalsy();
      expect(renderer.getState().input.value).toBe('kept');
      expect(harness.output.raw).toContain('\x1b[?1049l');
    } finally { renderer.closeModal(); region.end(); harness.restore(); }
  });
  it('denies and releases the alternate screen when opening it fails', async () => {
    const harness = createTtyHarness(60, 32);
    const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout);
    renderer.setScrollRegion(region);
    try {
      region.begin();
      renderer.renderInput({prompt: 'Type your message...', input: 'kept', cursor: 2, overlayLines: []});
      const listeners = harness.emitter.listenerCount('data');
      harness.failNextStdoutWrite(new Error('write failed'));
      expect(await showPermissionPrompt('bash', {command: 'ls /fixture'}, {renderer})).toEqual({action: 'deny'});
      expect(harness.emitter.listenerCount('data')).toBe(listeners);
      expect(harness.output.raw).toContain('\x1b[?1049l');
    } finally { renderer.closeModal(); region.end(); harness.restore(); }
  });

  it('keeps non-TTY permission requests default-deny without opening a screen', async () => {
    const harness = createTtyHarness(60, 32);
    try {
      process.stdin.isTTY = false;
      const offset = harness.output.raw.length;
      expect(await showPermissionPrompt('bash', {command: 'ls /fixture'})).toEqual({action: 'deny'});
      expect(harness.output.raw.slice(offset)).not.toContain('\x1b[?1049h');
    } finally { harness.restore(); }
  });

  it('presents the complete real producer long scope across physical pages before allowing', async () => {
    const harness = createTtyHarness(60, 24);
    const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout);
    renderer.setScrollRegion(region);
    const command = 'custom_' + 'long_scope_segment_'.repeat(30) + 'UNIQUE_SCOPE_FINAL_TOKEN --check';
    const rule = deriveRule('bash', {command});
    const options = buildPermissionPromptOptions(rule, 'bash', {command});
    const formatted = formatPermissionPromptLines('bash', {command}, options.map((option, index) => ({label: option.label, selected: index === 0})));
    try {
      region.begin();
      renderer.renderInput({prompt: 'Type your message...', input: 'kept', cursor: 2, overlayLines: [], footerLines: ['● Intent: md -> 报告 · Stage 2/2 生成报告 · Working', 'model']});
      expect(options).toHaveLength(5);
      const pending = showPermissionPrompt('bash', {command}, {renderer});
      expect(renderer.canApprovePermissionModal()).toBe(false);
      expect(harness.screen.text()).not.toContain('UNIQUE_SCOPE_FINAL_TOKEN');
      harness.send('1');
      expect(renderer.getState().modal).toBeTruthy();
      let presented = '';
      for (let page = 0; page < 30; page++) {
        presented += harness.screen.text();
        if (renderer.canApprovePermissionModal()) break;
        harness.send('\x1b[6~');
      }
      expect(renderer.canApprovePermissionModal()).toBe(true);
      // A tail unique to the actual long identity must be physically reachable.
      expect(presented.replace(/\s/g, '')).toContain('UNIQUE_SCOPE_FINAL_TOKEN');
      expect(formatted.join('\n')).toContain(rule);
      harness.send('1');
      expect(await pending).toEqual({action: 'allow_once'});
      expect(renderer.getState().input.value).toBe('kept');
    } finally { renderer.closeModal(); region.end(); harness.restore(); }
  });

  it('does not treat tiny columns or escaped control scopes as review eligibility', () => {
    const writes: string[] = [];
    const stream = {rows: 24, columns: 4, write: (value: string) => {writes.push(value); return true;}} as NodeJS.WriteStream;
    const screen = new PermissionScreen(stream);
    const frame = {inputValue: '', cursor: 0, placeholder: 'Type your message...', summaryLine: '', statusLine: 'model'};
    screen.render({...request, type: 'permission', selectedIndex: 0}, frame);
    expect(screen.canApprove()).toBe(false);
    stream.columns = 60;
    const malicious = 'bash(prefix\x1b[2J\u202etail *)';
    const full = getUiCopy('zh-CN').commandApprovalScope(malicious);
    const before = writes.length;
    const modal = {...request, type: 'permission' as const, selectedIndex: 0, reviewScopes: [malicious], targetLines: [full]};
    for (let i = 0; i < 10; i++) {screen.render(modal, frame); screen.page(1);}
    expect(screen.canApprove()).toBe(false);
    expect(writes.slice(before).join('')).toContain('\\u001b');
    expect(writes.slice(before).join('')).toContain('\\u{202e}');
  });

  it('defers footer writers and denies before asynchronous body writes reach the main buffer', async () => {
    const harness = createTtyHarness(60, 24);
    const region = new ScrollRegionManager(process.stdout);
    const renderer = new ReplRenderer(process.stdout);
    renderer.setScrollRegion(region);
    try {
      region.begin();
      region.writeAtContentCursor('  │ cd /fixture/one\n  │ cd /fixture/two\n  │ cd /fixture/three\n');
      renderer.renderInput({prompt: 'Type your message...', input: 'kept', cursor: 2, overlayLines: [], footerLines: ['● Intent: md -> 报告 · Working', 'old-model']});
      const pending = showPermissionPrompt('bash', {command: 'ls /fixture'}, {renderer});
      const before = harness.output.raw.length;
      region.renderFooter({summaryLine: '● Intent: md -> 报告 · Updated', statusLine: 'new-model'});
      region.updateStatusLine('new-model');
      region.renderActivity('Working');
      region.clearActivity();
      region.clearActivityLine();
      expect(harness.output.raw.length).toBe(before);
      region.writeAtContentCursor('ASYNC_REAL_BODY\n');
      expect(await pending).toEqual({action: 'deny'});
      expect(renderer.canApprovePermissionModal()).toBe(false);
      expect(harness.screen.text()).toContain('ASYNC_REAL_BODY');
      expect(harness.screen.text().match(/  │ cd /g)).toHaveLength(3);
      expect(harness.screen.text()).toContain('new-model');
      expect(harness.screen.text()).toContain('Updated');
      expect(renderer.getState().input.value).toBe('kept');
      harness.send('1');
      expect(renderer.getState().modal).toBeFalsy();
    } finally {renderer.closeModal(); region.end(); harness.restore();}
  });

});
