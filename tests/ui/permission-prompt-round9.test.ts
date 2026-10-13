import { it, expect } from 'vitest';
import { showPermissionPrompt, formatPermissionPromptLines } from '../../src/ui/permission-prompt.js';
import { createTtyHarness } from '../support/tty.js';
it.each(['git reset --hard', 'git -c core.pager=viewer log', 'git push origin :branch'])('offers only individual approval for risk: %s', async command => {
  const harness = createTtyHarness(140, 30);
  try {
    const pending = showPermissionPrompt('bash', { command });
    const screen = harness.screen.text();
    expect(screen).toContain('这个操作有风险，每次都会询问');
    expect(screen).not.toContain('始终允许');
    expect(screen).toContain('2. 拒绝');
    harness.send('2');
    await expect(pending).resolves.toEqual({ action: 'deny' });
  } finally { harness.restore(); }
});
it('displays escaped file targets separately', () => {
  const lines = formatPermissionPromptLines('bash', { command: 'git log --output "result\u001b.txt"' }, []);
  expect(lines.join('\n')).toContain('写入文件：result\\u001b.txt');
});
