import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { showPermissionPrompt } from '../../src/ui/permission-prompt.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { createTtyHarness } from '../support/tty.js';

// Use only entry points present in the source-before graph. No PermissionScreen
// import, capability probe, dynamic skip, or new renderer method is permitted.
const draft = '用户原始 draft';
const draftCursor = 5;
const summary = '● Intent: md -> 报告 · Stage 2/2 生成报告 · Working';
const status = 'gpt-terminal-e2e · 4% · project';
const transcript = [
  '  │ cd /fixture/one',
  '  │ cd /fixture/two',
  '  │ cd /fixture/three',
];
const scopes = [
  'bash(cd *)', 'bash(cat *)', 'bash(ls *)', 'bash(find *)',
  'bash(sort *)', 'bash(printf *)', 'bash(sleep *)',
];
const command = "cd '/fixture' && cat '/fixture/source-a.md' >/dev/null && "
  + "ls -la '/fixture' >/dev/null && find '/fixture' -maxdepth 2 -type f | sort >/dev/null && "
  + 'printf "E2E_STRESS_RAN_1" && sleep 1';

function openPublicPrompt() {
  const harness = createTtyHarness(60, 24);
  const region = new ScrollRegionManager(process.stdout);
  const renderer = new ReplRenderer(process.stdout);
  const abort = new AbortController();
  renderer.setScrollRegion(region);
  try {
    region.begin();
    region.writeAtContentCursor(transcript.join('\n') + '\n');
    renderer.renderInput({
      prompt: 'Type your message...', input: draft, cursor: draftCursor,
      overlayLines: [], footerLines: [summary, status],
    });
    // Establish that all three real output rows exist before the modal opens.
    for (const line of transcript) expect(harness.screen.text()).toContain(line);
    expect(renderer.getState().input.value).toBe(draft);
    const listeners = {
      data: harness.emitter.listenerCount('data'),
      end: harness.emitter.listenerCount('end'),
      abort: getEventListeners(abort.signal, 'abort').length,
      resize: process.stdout.listenerCount('resize'),
    };
    const pending = showPermissionPrompt('bash', {command}, {renderer, signal: abort.signal});
    return {harness, region, renderer, abort, listeners, pending};
  } catch (error) {
    try {region.end();} finally {harness.restore();}
    throw error;
  }
}

type PublicPrompt = ReturnType<typeof openPublicPrompt>;

async function releasePublicPrompt(context: PublicPrompt): Promise<void> {
  // Abort the actual production promise even if a preceding visible assertion
  // failed. Do not send allow/deny keys or close/redraw the renderer by hand.
  try {
    context.abort.abort();
    expect(await context.pending).toEqual({action: 'deny'});
    // Check before harness.restore() removes listeners, so teardown cannot hide
    // a production listener leak. AbortSignal and stdout resize are real emitters.
    expect(context.harness.emitter.listenerCount('data')).toBe(context.listeners.data);
    expect(context.harness.emitter.listenerCount('end')).toBe(context.listeners.end);
    expect(getEventListeners(context.abort.signal, 'abort').length).toBe(context.listeners.abort);
    expect(process.stdout.listenerCount('resize')).toBe(context.listeners.resize);
  } finally {
    try {context.region.end();} finally {context.harness.restore();}
  }
}

describe('permission source-before/public-entry controls R260', () => {
  it('renders the real title and every policy scope at 60x24 with the existing Intent summary', async () => {
    const context = openPublicPrompt();
    try {
      const text = context.harness.screen.text();
      expect(text).toContain('xiaok 想要执行以下操作');
      expect(text).toContain('工具: bash');
      expect(text).toContain('本次执行命令: cd');
      const scopeRows = text.split('\n').filter(line => line.trim().startsWith('始终允许的范围:'));
      expect(scopeRows).toHaveLength(7);
      for (const scope of scopes) expect(scopeRows.some(line => line.includes(scope))).toBe(true);
      expect(text).toContain('❯ 1. 允许一次');
      expect(text).toContain('5. 拒绝');
      expect(text).toContain('数字直选');
      expect(text).toContain('● Intent: md -> 报告');
      expect(text).toContain(status);
    } finally {
      await releasePublicPrompt(context);
    }
  });

  it('restores the original draft, cursor and all three real transcript rows after AbortSignal', async () => {
    const context = openPublicPrompt();
    try {
      // Deliberately independent of the menu test: missing title must not stop
      // this second control from exercising the real abort/cleanup path.
      context.abort.abort();
      expect(await context.pending).toEqual({action: 'deny'});
      expect(context.renderer.getState().modal).toBeFalsy();
      expect(context.renderer.getState().input.value).toBe(draft);
      expect(context.renderer.getState().input.cursorOffset).toBe(draftCursor);
      expect(context.region.getPromptFrameState().inputValue).toBe(draft);
      expect(context.region.getPromptFrameState().cursor).toBe(draftCursor);
      const text = context.harness.screen.text();
      for (const line of transcript) expect(text).toContain(line);
      expect(text.split('\n').filter(line => line.includes('  │ cd /fixture/'))).toHaveLength(3);
      expect(text).toContain(draft);
      expect(text).toContain('● Intent: md -> 报告');
      expect(text.split('\n').filter(line => line.includes(status))).toHaveLength(1);
      expect(text).not.toContain('xiaok 想要执行以下操作');
      expect(text).not.toContain('始终允许的范围:');
    } finally {
      await releasePublicPrompt(context);
    }
  });
});
