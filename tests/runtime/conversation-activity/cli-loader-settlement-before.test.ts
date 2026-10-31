import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachCliConversationActivitiesWithinBudget as ENTRY } from '../../../src/runtime/conversation-activity/cli-loader.js';
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

it.each([{ print: true }, { isTTY: false }, { conversationActivity: '0' }])('BEFORE: original disabled mode %j does not invoke onSettled', async gate => {
  let imports = 0, settles = 0;
  const result = await ENTRY(options(gate), { onSettled() { settles++; } }, {
    async importCli(): Promise<never> { imports++; throw Error('disabled_must_not_import'); },
  });
  expect(result).toBeUndefined(); expect(imports).toBe(0); expect(settles).toBe(0);
});
it('BEFORE: original fast import failure returns undefined without a universal settlement callback', async () => {
  let imports = 0, settles = 0;
  const result = await ENTRY(options(), { onSettled() { settles++; } }, {
    async importCli(): Promise<never> { imports++; throw Error('import_fixture_failure'); },
  });
  expect(result).toBeUndefined(); expect(imports).toBe(1); expect(settles).toBe(0);
});
it('BEFORE: original timeout returns while the same import is pending; settlement callback comes only later', async () => {
  const pending = deferredNever(); let imports = 0, settles = 0, late = 0;
  const result = ENTRY(options(), { onLate() { late++; }, onSettled() { settles++; } }, {
    importCli() { imports++; return pending.promise; },
  });
  try {
    await vi.advanceTimersByTimeAsync(2000); expect(await result).toBeUndefined();
    expect(imports).toBe(1); expect(settles).toBe(0); expect(late).toBe(0);
    pending.reject(Error('import_fixture_failure')); await vi.advanceTimersByTimeAsync(0);
    expect(settles).toBe(1); expect(late).toBe(0); expect(imports).toBe(1);
  } finally { pending.reject(Error('fixture_release')); await result; await vi.advanceTimersByTimeAsync(0); }
});
