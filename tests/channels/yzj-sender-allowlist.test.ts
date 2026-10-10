import { describe, expect, it, vi } from 'vitest';
import { checkSenderAllowed, SenderAllowlistGuard } from '../../src/channels/sender-allowlist.js';

describe('发送人白名单', () => {
  it.each([undefined, []])('缺省或空名单拒绝全部发送人 %j', list => {
    expect(checkSenderAllowed('owner', list).allowed).toBe(false);
  });
  it.each([undefined, null, 1, {}, '', '   '])('拒绝无效发送人 %j', sender => {
    expect(checkSenderAllowed(sender as string, ['owner']).allowed).toBe(false);
  });
  it.each(['Owner', ' owner', 'owner ', 'other'])('严格相等且不归一化 %s', sender => {
    expect(checkSenderAllowed(sender, ['owner']).allowed).toBe(false);
  });
  it('放行名单内多个发送人', () => {
    for (const sender of ['owner', 'member']) expect(checkSenderAllowed(sender, ['owner', 'member']).allowed).toBe(true);
  });
  it('拒绝回复按发送人限速，日志只有 ID 和原因', async () => {
    let now = 0;
    const log = vi.fn();
    const reply = vi.fn();
    const guard = new SenderAllowlistGuard([], log, () => now);
    const message = { operatorOpenid: 'other', content: 'private body' };
    expect(await guard.accept(message.operatorOpenid, reply)).toBe(false);
    await guard.accept('other', reply);
    await guard.accept('second', reply);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledWith('你没有权限使用这个助手。');
    now = 60_000;
    await guard.accept('other', reply);
    expect(reply).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.flat().join(' ')).not.toContain(message.content);
    expect(log.mock.calls[0][0]).toContain('other');
  });
  it('允许的发送人不写拒绝日志或发送拒绝回复', async () => {
    const log = vi.fn(); const reply = vi.fn();
    expect(await new SenderAllowlistGuard(['owner'], log).accept('owner', reply)).toBe(true);
    expect(log).not.toHaveBeenCalled(); expect(reply).not.toHaveBeenCalled();
  });
});

it('配置只保留 trim 后非空字符串并保留大小写', async () => {
  const { resolveYZJConfig } = await import('../../src/channels/yzj.js');
  const config = { channels: { yzj: { webhookUrl: 'https://example.invalid/ws', allowedSenders: [' Owner ', '', '  ', 1, 'member'] } } } as any;
  expect(resolveYZJConfig(config).allowedSenders).toEqual(['Owner', 'member']);
  expect(resolveYZJConfig(config, { allowedSenders: [] }).allowedSenders).toEqual([]);
});
