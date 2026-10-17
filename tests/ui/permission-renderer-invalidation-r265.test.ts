import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { showPermissionPrompt } from '../../src/ui/permission-prompt.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { ScrollRegionManager } from '../../src/ui/scroll-region.js';
import { createTtyHarness } from '../support/tty.js';

const summary = '● Intent: md -> 报告 · Stage 2/2 生成报告 · Working';
const status = 'gpt-terminal-e2e · 4% · project';

function open(mode: 'scroll' | 'inline' | 'direct' = 'scroll') {
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
    if (mode !== 'direct') renderer.renderInput({prompt: 'Type your message...', input: 'saved draft', cursor: 5, overlayLines: [], footerLines: [summary, status]});
    const counts = {data: harness.emitter.listenerCount('data'), end: harness.emitter.listenerCount('end'), resize: process.stdout.listenerCount('resize'), abort: getEventListeners(abort.signal, 'abort').length};
    const pending = showPermissionPrompt('bash', {command: 'ls /fixture/first'}, {renderer, signal: abort.signal});
    let settled = false;
    let decision: unknown;
    void pending.then(value => {settled = true; decision = value;}, error => {settled = true; decision = error;});
    return {harness, region, renderer, abort, pending, counts, isSettled: () => settled, decision: () => decision};
  } catch (error) {try {region.end();} finally {harness.restore();} throw error;}
}

type Context = ReturnType<typeof open>;
function expectReleased(context: Context) {
  expect(context.harness.emitter.listenerCount('data')).toBe(context.counts.data);
  expect(context.harness.emitter.listenerCount('end')).toBe(context.counts.end);
  expect(process.stdout.listenerCount('resize')).toBe(context.counts.resize);
  expect(getEventListeners(context.abort.signal, 'abort').length).toBe(context.counts.abort);
}
async function release(context: Context) {
  try {context.abort.abort(); await context.pending;}
  finally {try {context.region.end();} finally {context.harness.restore();}}
}

describe('R265 real renderer entry invalidation', () => {
  const mutations: Array<[string, (renderer: ReplRenderer) => void]> = [
    ['renderInput', renderer => renderer.renderInput({prompt: 'Type your message...', input: 'replacement draft', cursor: 4, footerLines: [summary, status], overlayLines: []})],
    ['clearPromptLine', renderer => renderer.clearPromptLine()],
    ['prepareBlockOutput', renderer => renderer.prepareBlockOutput()],
    ['renderOverlayAtCursor', renderer => renderer.renderOverlayAtCursor(['replacement overlay'])],
    ['clearOverlay', renderer => renderer.clearOverlay()],
    ['external closeModal / shutdown close', renderer => renderer.closeModal()],
    ['clearVisibleContent', renderer => renderer.clearVisibleContent()],
    ['prepareForInput', renderer => renderer.prepareForInput()],
    ['setScrollRegion replacement', renderer => renderer.setScrollRegion(new ScrollRegionManager(process.stdout))],
  ];
  it.each(mutations)('%s settles the actual pending deny before cleanup abort or later digits', async (_name, mutate) => {
    const context = open();
    try {
      const offset = context.harness.output.raw.length;
      mutate(context.renderer);
      await setImmediate();
      // The cleanup abort has not run. Observing the real Promise is not a fake
      // producer: the pending must have settled from the production mutation.
      expect(context.abort.signal.aborted).toBe(false);
      expect(context.isSettled()).toBe(true);
      expect(context.decision()).toEqual({action: 'deny'});
      expect(await context.pending).toEqual({action: 'deny'});
      expectReleased(context);
      expect(context.renderer.getState().modal).toBeFalsy();
      expect(context.harness.output.raw.slice(offset)).toContain('\x1b[?1049l');
      context.harness.send('1');
      await setImmediate();
      expect(context.decision()).toEqual({action: 'deny'});
      expectReleased(context);
    } finally {await release(context);}
  });

  it.each(['scroll', 'inline', 'direct'] as const)('normal %s once completes without recursive denial or an abort', async mode => {
    const context = open(mode);
    try {
      context.harness.send('1');
      await setImmediate();
      expect(context.abort.signal.aborted).toBe(false);
      expect(context.isSettled()).toBe(true);
      expect(await context.pending).toEqual({action: 'allow_once'});
      expectReleased(context);
      expect(context.renderer.getState().modal).toBeFalsy();
      if (mode === 'scroll') {
        expect(context.renderer.getState().input.value).toBe('saved draft');
        expect(context.harness.screen.text().split('\n').filter(line => line.includes('  │ cd /fixture/'))).toHaveLength(3);
      }
    } finally {await release(context);}
  });

  it('a real replacement denies the old pending; late old abort cannot close or approve the new request', async () => {
    const context = open();
    const nextAbort = new AbortController();
    let nextPending: ReturnType<typeof showPermissionPrompt> | undefined;
    try {
      nextPending = showPermissionPrompt('bash', {command: 'ls /fixture/second'}, {renderer: context.renderer, signal: nextAbort.signal});
      let nextSettled = false;
      void nextPending.then(() => {nextSettled = true;}, () => {nextSettled = true;});
      await setImmediate();
      expect(context.abort.signal.aborted).toBe(false);
      expect(context.isSettled()).toBe(true);
      expect(await context.pending).toEqual({action: 'deny'});
      expect(getEventListeners(context.abort.signal, 'abort')).toHaveLength(context.counts.abort);
      expect(context.harness.emitter.listenerCount('data')).toBe(context.counts.data + 1);
      expect(context.harness.emitter.listenerCount('end')).toBe(context.counts.end + 1);
      expect(context.harness.screen.text()).toContain('/fixture/second');
      expect(nextSettled).toBe(false);
      context.abort.abort();
      await setImmediate();
      expect(nextSettled).toBe(false);
      expect(context.renderer.getState().modal).toBeTruthy();
      expect(context.harness.screen.text()).toContain('/fixture/second');
      context.harness.send('1');
      await setImmediate();
      expect(nextAbort.signal.aborted).toBe(false);
      expect(nextSettled).toBe(true);
      expect(await nextPending).toEqual({action: 'allow_once'});
      expectReleased(context);
      expect(getEventListeners(nextAbort.signal, 'abort')).toHaveLength(0);
    } finally {
      nextAbort.abort();
      try {if (nextPending) await nextPending;}
      finally {await release(context);}
    }
  });
});
