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
    const pending = promptProjectRuleAdoption('bash(echo \x1b[2J\x00\x07\x9b\u202e *)');
    expect(harness.output.raw.replace(/\n/g, '')).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(harness.output.raw).toContain('\\u001b[2J');
    expect(harness.output.raw).not.toContain('\u202e');
    expect(harness.output.raw.split('\\u{202e}')).toHaveLength(3);
    expect(harness.output.raw.split('\\u001b[2J')).toHaveLength(3);
    harness.send('n');
    expect(await pending).toBe(false);
  } finally { process.stdout.isTTY = previous; harness.restore(); }
});

it.each([
  ['bash(git status)', '以后运行 `git status` 不再询问'],
  ['bash(git *)', '以后运行以 `git` 开头的命令不再询问'],
  ['bash(*)', '以后运行任何命令都不再询问'],
  ['write(src/*)', '以后写入 `src/*` 不再询问'],
  ['edit(src/*)', '以后修改 `src/*` 不再询问'],
  ['read(src/*)', '以后读取 `src/*` 不再询问'],
  ['custom(foo*)', '以后使用 custom 匹配 `foo*` 时不再询问'],
])('shows numbered meaning and original rule: %s', async (rule, meaning) => {
  const harness = createTtyHarness(200, 24);
  const previous = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    const pending = promptProjectRuleAdoption(rule, 2, 3);
    expect(harness.screen.text()).toContain('(2/3) ' + meaning);
    expect(harness.screen.text()).toContain(rule + ' [y/N]');
    harness.send('\r');
    await expect(pending).resolves.toBe(false);
  } finally { process.stdout.isTTY = previous; harness.restore(); }
});
