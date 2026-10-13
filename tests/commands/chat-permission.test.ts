import { expect, it, vi } from 'vitest';
import { confirmChatPermission } from '../../src/commands/chat-permission.js';

it.each(['allow_project', 'allow_global', 'allow_session'] as const)('终端获胜后才写入 %s 规则', async action => {
  const save = vi.fn(); const session = vi.fn();
  let finished = false;
  const result = await confirmChatPermission('read', { path: '/ws/file' }, {
    prompt: async () => ({ action, rule: 'read(/ws/*)' }),
    race: async terminal => {
      const decision = await terminal('read', {});
      expect(save).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled();
      finished = true; return decision;
    },
    addAllowRule: async (...args) => { expect(finished).toBe(true); save(...args); },
    addSessionRule: session,
  });
  expect(result).toBe(true);
  expect(session).toHaveBeenCalledWith('read(/ws/*)');
  if (action === 'allow_session') expect(save).not.toHaveBeenCalled();
  else expect(save).toHaveBeenCalledWith(action === 'allow_project' ? 'project' : 'global', 'read(/ws/*)');
});

it('拒绝不写规则', async () => {
  const write = vi.fn();
  await expect(confirmChatPermission('read', { path: '/ws' }, {
    prompt: async () => ({ action: 'deny' }), addAllowRule: write, addSessionRule: write,
  })).resolves.toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it('规则落盘失败仍保留本次放行，不把异常上抛成 deny', async () => {
  const session = vi.fn();
  await expect(confirmChatPermission('read', { path: '/ws' }, {
    prompt: async () => ({ action: 'allow_project', rule: 'read(/ws/*)' }),
    addAllowRule: async () => { throw new Error('disk full'); },
    addSessionRule: session,
  })).resolves.toBe(true);
  expect(session).not.toHaveBeenCalled();
});

it('channel 撤回后不写规则', async () => {
  const write = vi.fn();
  const result = await confirmChatPermission('bash', { command: 'ls' }, {
    prompt: async (_n, _i, signal) => {
      signal?.dispatchEvent(new Event('abort'));
      return { action: 'allow_project', rule: 'bash(ls *)' };
    },
    race: async terminal => {
      const controller = new AbortController();
      const pending = terminal('bash', {}, controller.signal);
      controller.abort();
      await pending;
      return true;
    },
    addAllowRule: write,
    addSessionRule: write,
  });
  expect(result).toBe(true);
  expect(write).not.toHaveBeenCalled();
});
