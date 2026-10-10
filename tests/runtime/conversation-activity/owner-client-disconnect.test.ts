import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConversationActivityOwnerClient } from '../../../src/runtime/conversation-activity/owner-client.js';
import { ACTIVITY_OWNER_PROTOCOL } from '../../../src/runtime/conversation-activity/owner-protocol.js';
const wire = vi.hoisted(() => ({ socket: undefined as any }));
vi.mock('node:net', () => ({ createConnection: () => wire.socket }));
vi.mock('../../../src/runtime/conversation-activity/owner-protocol.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/runtime/conversation-activity/owner-protocol.js')>(),
  readActivityOwnerCredentials: () => ({ producer: 'secret' }),
}));
beforeEach(() => {
  wire.socket = Object.assign(new EventEmitter(), { setEncoding: vi.fn(), write: vi.fn(), destroy: vi.fn(() => { wire.socket.emit('close'); }) });
});
async function connected() {
  const client = new ConversationActivityOwnerClient('/tmp/activity-disconnect-test', 'producer');
  const listener = vi.fn(); client.onDisconnect(listener);
  const pending = client.connect();
  wire.socket.emit('connect');
  wire.socket.emit('data', JSON.stringify({ type: 'hello', protocol: ACTIVITY_OWNER_PROTOCOL, rootHash: client.address.rootHash, ownerEpoch: 'epoch' }) + '\n');
  await pending;
  return { client, listener };
}
it('reports only one authenticated unexpected close, preserving the disconnected epoch', async () => {
  const { client, listener } = await connected();
  wire.socket.emit('error', new Error('lost')); wire.socket.emit('close');
  expect(listener).toHaveBeenCalledExactlyOnceWith('epoch'); expect(client.ownerEpoch).toBeUndefined(); client.dispose();
});
it.each(['close', 'dispose'] as const)('does not notify on intentional %s', async method => {
  const { client, listener } = await connected(); client[method](); expect(listener).not.toHaveBeenCalled();
});
it('does not notify before authentication', async () => {
  const client = new ConversationActivityOwnerClient('/tmp/activity-disconnect-test', 'producer'); const listener = vi.fn(); client.onDisconnect(listener);
  const rejection = expect(client.connect()).rejects.toThrow('activity_owner_connection_lost');
  wire.socket.emit('close'); await rejection; expect(listener).not.toHaveBeenCalled(); client.dispose();
});
it('removes listeners when unsubscribed', async () => {
  const { client, listener } = await connected(); const removed = vi.fn(); client.onDisconnect(removed)();
  wire.socket.emit('close'); expect(listener).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled(); client.dispose();
});
