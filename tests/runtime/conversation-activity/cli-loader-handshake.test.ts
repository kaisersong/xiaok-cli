import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginCliConversationActivityAttachment as ENTRY } from '../../../src/runtime/conversation-activity/cli-loader.js';
type LoaderOptions = Parameters<typeof ENTRY>[0];
function options(gate: { print?: boolean; isTTY?: boolean; conversationActivity?: string } = {},
  onDebug?: (event: string, detail: string) => void): LoaderOptions {
  return {
    print: gate.print ?? false, isTTY: gate.isTTY ?? true, conversationActivity: gate.conversationActivity,
    // Disabled/import-failure controls must never consult or fabricate a platform.
    get attachOptions(): LoaderOptions['attachOptions'] { throw Error('attach_options_must_not_be_read'); },
    onDebug,
  };
}
function deferredNever() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((_yes, no) => { reject = no; });
  return { promise, reject };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([{ print: true }, { isTTY: false }, { conversationActivity: '0' }])('PUBLIC H1: disabled mode %j still exposes an awaitable settled/close', async gate => {
  let imports = 0;
  const owner = ENTRY(options(gate), {}, {
    async importCli(): Promise<never> { imports++; throw Error('disabled_must_not_import'); },
  });
  expect(await owner.initial).toBeUndefined(); expect(await owner.settled).toBeUndefined();
  const closing = owner.close(); expect(owner.close()).toBe(closing); await closing;
  expect(imports).toBe(0);
});
it('PUBLIC H2: actual wrapper import failure has an awaitable undefined completion, not a fabricated Cli', async () => {
  let imports = 0; const debug: string[] = [];
  const owner = ENTRY(options({}, event => { debug.push(event); }), {}, {
    async importCli(): Promise<never> { imports++; throw Error('import_fixture_failure'); },
  });
  expect(await owner.initial).toBeUndefined(); expect(await owner.settled).toBeUndefined(); await owner.close();
  expect(imports).toBe(1); expect(debug).toEqual(['cli_activity_sqlite_unavailable']);
});
it('PUBLIC H4/H7: default 2000ms timeout plus early cleanup waits the SAME actual public import', async () => {
  const pending = deferredNever(); let imports = 0, initialDone = false, closed = false;
  const owner = ENTRY(options(), {}, { importCli() { imports++; return pending.promise; } });
  const observedInitial = owner.initial.then(value => { initialDone = true; return value; });
  try {
    await vi.advanceTimersByTimeAsync(1999); expect(initialDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await observedInitial).toBeUndefined();
    const closing = owner.close(); expect(owner.close()).toBe(closing);
    const observedClose = closing.then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(3000); expect(closed).toBe(false); expect(imports).toBe(1);
    pending.reject(Error('import_fixture_failure')); await observedClose;
    expect(await owner.settled).toBeUndefined(); expect(closed).toBe(true); expect(imports).toBe(1);
  } finally {
    pending.reject(Error('fixture_release'));
    await Promise.allSettled([owner.initial, owner.settled, owner.close()]);
  }
});
it('PUBLIC H7: a real public debug callback rejection propagates through both settled and close', async () => {
  const failure = new Error('debug_fixture_failure');
  const owner = ENTRY(options({}, () => { throw failure; }), {}, {
    async importCli(): Promise<never> { throw Error('import_fixture_failure'); },
  });
  const outcomes = await Promise.allSettled([owner.initial, owner.settled, owner.close()]);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw Error('unexpected_fulfilled_attachment');
    expect(outcome.reason).toBe(failure);
  }
});
