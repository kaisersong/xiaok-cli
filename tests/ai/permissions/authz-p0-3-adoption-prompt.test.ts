import { expect, it } from 'vitest';
import { promptProjectRuleAdoption } from '../../../src/ui/permission-prompt.js';
import { createTtyHarness } from '../../support/tty.js';

it.each([['\r', false], ['n', false], ['y', true], ['\x1b', false]] as const)('individual rule prompt defaults to refusal: %j', async (key, expected) => {
  const harness = createTtyHarness(120, 24);
  const stdoutIsTTY = process.stdout.isTTY;
  process.stdout.isTTY = true;
  const listeners = process.stdin.listenerCount('data');
  try {
    const rule = 'bash(echo "x;y" *)';
    const pending = promptProjectRuleAdoption(rule);
    expect(harness.screen.text()).toContain(`${rule} [y/N]`);
    expect(harness.screen.text()).not.toContain('全部采纳');
    harness.send(key);
    expect(await pending).toBe(expected);
    expect(process.stdin.listenerCount('data')).toBe(listeners);
  } finally { process.stdout.isTTY = stdoutIsTTY; harness.restore(); }
});
