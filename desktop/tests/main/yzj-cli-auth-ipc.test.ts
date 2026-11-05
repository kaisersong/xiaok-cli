// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { registerYzjCliAuthIpc, isYzjCliAuthSenderAllowed } from '../../electron/yzj-cli-auth-typed-ipc.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPreloadApi } from '../../electron/preload-api.js';
function fixture() {
 const handlers = new Map<string, Function>();
 const service = { getState: vi.fn(() => ({ phase: 'idle', revision: 0 })), control: vi.fn(async () => ({ phase: 'waiting', revision: 1 })) };
 registerYzjCliAuthIpc({ handle: (name, callback) => { handlers.set(name, callback); } }, service as any, event => (event as any).trusted === true);
 return { handlers, service };
}
describe('Yunzhijia CLI auth IPC', () => {
 it('accepts only the current trusted main frame and rejects iframes, foreign windows, navigation, and destroyed windows', () => {
  const rendererFile = resolve('dist/renderer/index.html'); const frame = { url: pathToFileURL(rendererFile).href };
  const contents = { mainFrame: frame }; const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  const allowed = (next: unknown, win: unknown = window) => isYzjCliAuthSenderAllowed(next as any, win as any, { rendererFile });
  expect(allowed(event)).toBe(true);
  expect(allowed({ ...event, senderFrame: { ...frame } })).toBe(false);
  expect(allowed({ ...event, sender: {} })).toBe(false);
  expect(allowed(event, { ...window, isDestroyed: () => true })).toBe(false);
  frame.url = 'https://evil.example/'; expect(allowed(event)).toBe(false);
 });
 it('derives user source in Main and exposes only fixed semantic actions', async () => {
  const f = fixture(); const invoke = vi.fn((channel: string, ...args: unknown[]) => f.handlers.get(channel)!({ trusted: true }, ...args));
  const api = createPreloadApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as any);
  expect(await api.getYzjCliAuthState()).toEqual({ phase: 'idle', revision: 0 });
  await api.controlYzjCliAuth('login'); expect(f.service.control).toHaveBeenCalledWith('login', 'user');
 });
 it('rejects unauthorized senders and argument injection before calling the service', async () => {
  const f = fixture(); const control = f.handlers.get('desktop:controlYzjCliAuth')!;
  await expect(control({ trusted: false }, 'login')).rejects.toThrow('yzj_cli_auth_sender_forbidden');
  for (const args of [['logout'], ['login', { requestSource: 'user' }], [{ action: 'login', command: 'evil' }]]) {
   await expect(control({ trusted: true }, ...args)).rejects.toThrow();
  }
  expect(f.service.control).not.toHaveBeenCalled();
 });
 it('rejects untrusted get-state callers and nonempty read payloads', async () => {
  const f = fixture(); const get = f.handlers.get('desktop:getYzjCliAuthState')!;
  await expect(get({ trusted: false })).rejects.toThrow(); await expect(get({ trusted: true }, 'extra')).rejects.toThrow();
  expect(f.service.getState).not.toHaveBeenCalled();
 });
 it('passes safe connection details through preload and rejects nested credentials', async () => {
  const f = fixture(); const connection = { name: '张三', openId: 'user-one', orgId: 'org-one', checkedAt: '2026-11-05T08:00:00.000Z', expiresAt: '2026-11-05T10:00:00.000Z', tokenStatus: 'valid' };
  f.service.getState.mockReturnValue({ phase: 'authenticated', revision: 2, connection } as any);
  const api = createPreloadApi({ invoke: (channel: string) => f.handlers.get(channel)!({ trusted: true }), on: vi.fn(), removeListener: vi.fn() } as any);
  expect(await api.getYzjCliAuthState()).toMatchObject({ connection });
  f.service.getState.mockReturnValue({ phase: 'authenticated', revision: 2, connection: { ...connection, accessToken: 'secret' } } as any);
  await expect(api.getYzjCliAuthState()).rejects.toThrow();
 });
 it('rejects unexpected secret-bearing output instead of projecting it', async () => {
  const f = fixture(); f.service.getState.mockReturnValue({ phase: 'idle', revision: 0, token: 'secret' } as any);
  await expect(f.handlers.get('desktop:getYzjCliAuthState')!({ trusted: true })).rejects.toThrow();
 });
});
