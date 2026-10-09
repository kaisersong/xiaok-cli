import { expect, it } from 'vitest';
import { promptProjectRuleAdoption } from '../../../src/ui/permission-prompt.js';
import { createTtyHarness } from '../../support/tty.js';

it.each([['\r', false], ['n', false], ['y', true], ['\x1b', false]] as const)('only y adopts the rule: %j', async (key, expected) => {
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

it('repository control characters are escaped before display', async () => {
  const harness = createTtyHarness(200, 24);
  const previous = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const pending = promptProjectRuleAdoption('bash(echo \x1b[2J\x00\x07\x9b *)');
    expect(harness.output.raw).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(harness.output.raw).toContain('\\u001b[2J');
    harness.send('n');
    expect(await pending).toBe(false);
  } finally { process.stdout.isTTY = previous; harness.restore(); }
});
