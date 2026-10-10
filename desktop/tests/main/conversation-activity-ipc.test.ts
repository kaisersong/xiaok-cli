import { describe, expect, it, vi } from 'vitest';
import { registerConversationActivityIpc } from '../../electron/conversation-activity-ipc.js';

function fixture(authorized = true) {
  const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
  const list = vi.fn(async () => []);
  const service = { mcpAnswer: vi.fn(async () => {}), unread: vi.fn(() => []), read: vi.fn(), overview: vi.fn(() => vi.fn()), list, subscribe: vi.fn(() => vi.fn()), reporting: vi.fn(async () => 'bad output'), stop: vi.fn(async () => 'bad output'), getWork: vi.fn(async () => 'bad output') };
  const event = { sender: { id: 1, send: vi.fn(), isDestroyed: () => false, once: vi.fn(), removeListener: vi.fn() } };
  const cleanup = registerConversationActivityIpc({ handle: (channel, handler) => { handlers.set(channel, handler as never); } }, service, () => authorized ? { actorId: 'user' } : null);
  return { handlers, service, event, cleanup };
}
describe('activity semantic IPC boundary', () => {
  it('refuses untrusted frames before reading private activity', async () => {
    const f = fixture(false);
    await expect(f.handlers.get('desktop:activity:list')!(f.event, { threadId: 'thread' })).rejects.toThrow('activity_actor_forbidden');
    expect(f.service.list).not.toHaveBeenCalled(); f.cleanup();
  });
  it('rejects actor spoofing, unknown fields, and invalid page sizes before service dispatch', async () => {
    const f = fixture();
    for (const input of [{ threadId: 'thread', actorId: 'evil' }, { threadId: 'thread', limit: 201 }, { threadId: 'thread', afterLocalSeq: -1 }]) {
      await expect(f.handlers.get('desktop:activity:list')!(f.event, input)).rejects.toThrow();
    }
    expect(f.service.list).not.toHaveBeenCalled(); f.cleanup();
  });
  it('routes the watch separately from the strict MCP answer envelope', async () => {
    const f = fixture(); const answer = { inputId: 'format', expectedDigest: 'digest', action: 'accept', content: { format: 'pdf' } };
    await f.handlers.get('desktop:activity:mcpAnswer')!(f.event, { watchId: 'watch', ...answer });
    expect(f.service.mcpAnswer).toHaveBeenCalledWith('watch', answer, { actorId: 'user', requestSource: 'user' }); f.cleanup();
  });
  it('validates the returned watch contract instead of admitting an arbitrary result', async () => {
    const f = fixture();
    await expect(f.handlers.get('desktop:activity:stop')!(f.event, { watchId: 'watch', expectedPolicyRevision: 0 })).rejects.toThrow();
    f.cleanup();
  });
  it('keeps subscriptions owned by sender and disposes them without stopping work', async () => {
    const f = fixture();
    await f.handlers.get('desktop:activity:subscribe')!(f.event, { threadId: 'thread', subscriptionId: 'subscription' });
    const stop = f.service.subscribe.mock.results[0].value;
    await f.handlers.get('desktop:activity:unsubscribe')!({ sender: { id: 2 } }, { subscriptionId: 'subscription' });
    expect(stop).not.toHaveBeenCalled();
    f.cleanup(); expect(stop).toHaveBeenCalledTimes(1);
    expect(f.service.stop).not.toHaveBeenCalled();
  });
  it('does not leak a subscription if its view closes while trusted identity is being prepared', async () => {
    const f = fixture();
    let resolve!: (stop: () => void) => void;
    f.service.subscribe.mockImplementation(() => new Promise<() => void>(done => { resolve = done; }) as never);
    const pending = f.handlers.get('desktop:activity:subscribe')!(f.event, { threadId: 'new-thread', subscriptionId: 'pending' });
    await vi.waitFor(() => expect(typeof resolve).toBe('function'));
    f.event.sender.isDestroyed = () => true;
    const stop = vi.fn(); resolve(stop); await pending;
    expect(stop).toHaveBeenCalledOnce(); f.cleanup(); expect(stop).toHaveBeenCalledOnce();
  });
});
