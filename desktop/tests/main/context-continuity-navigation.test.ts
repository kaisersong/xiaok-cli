// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { ContextLinkNavigation, registerContextProtocol } from '../../electron/context-continuity/navigation.js';
it('queues only strict references, opens a trusted app route, and carries no grant or execution action', async () => {
  const loadURL = vi.fn(async () => {}), open = vi.fn(async () => ({ getURL: () => 'file:///Applications/xiaok.app/renderer/index.html#/t/current', loadURL }));
  const navigation = new ContextLinkNavigation({ open, isTrusted: url => url.startsWith('file:///Applications/xiaok.app/') });
  expect(navigation.accept(`xiaok://context/v1/${'a'.repeat(32)}?grant=yes`)).toBe(false); expect(open).not.toHaveBeenCalled();
  expect(navigation.accept(`xiaok://context/v1/${'a'.repeat(32)}`)).toBe(true); expect(open).not.toHaveBeenCalled();
  await navigation.flush(); expect(loadURL).toHaveBeenCalledWith(`file:///Applications/xiaok.app/renderer/index.html#/context/${'a'.repeat(32)}`);
  await navigation.flush(); expect(loadURL).toHaveBeenCalledOnce();
});
it('does not navigate an untrusted window and never changes the OS association from a development run', async () => {
  const loadURL = vi.fn(async () => {}), navigation = new ContextLinkNavigation({ open: async () => ({ getURL: () => 'https://foreign.example', loadURL }), isTrusted: () => false });
  navigation.accept(`xiaok://context/v1/${'a'.repeat(32)}`); await expect(navigation.flush()).rejects.toThrow('untrusted_navigation'); expect(loadURL).not.toHaveBeenCalled();
  const app = { isPackaged: false, setAsDefaultProtocolClient: vi.fn(() => true) };
  expect(registerContextProtocol(app, 'darwin')).toBe(false); expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  expect(registerContextProtocol({ ...app, isPackaged: true }, 'win32')).toBe(true); expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('xiaok');
});
