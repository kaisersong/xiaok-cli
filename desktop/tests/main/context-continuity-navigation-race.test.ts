// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ContextLinkNavigation, registerContextProtocol } from '../../electron/context-continuity/navigation.js';
import { parseContextLink } from '../../shared/context-continuity-types.js';
const link = (id: string) => `xiaok://context/v1/${id.repeat(32)}`;
const route = 'file:///app/renderer/index.html#/t/current';

it('reserves the same flush before a synchronously reentrant open callback', async () => {
  let calls = 0, nested: Promise<void> | undefined;
  const loadURL = vi.fn(async () => {});
  const navigation = new ContextLinkNavigation({
    open: () => { calls++; if (calls === 1) nested = navigation.flush(); return Promise.resolve({ getURL: () => route, loadURL }); },
    isTrusted: value => value === route,
  });
  navigation.accept(link('a'));
  const outer = navigation.flush();
  await outer;
  expect(nested).toBe(outer);
  expect(calls).toBe(1);
  expect(loadURL).toHaveBeenCalledTimes(1);
});

it('serially drains the latest accepted reference while a load is held', async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { entered = resolve; });
  const urls: string[] = [];
  const loadURL = async (url: string) => { urls.push(url); if (urls.length === 1) { entered(); await held; } };
  const open = vi.fn(async () => ({ getURL: () => route, loadURL }));
  const navigation = new ContextLinkNavigation({ open, isTrusted: value => value === route });
  navigation.accept(link('a')); const running = navigation.flush(); await first;
  expect(navigation.accept(link('b'))).toBe(true); expect(navigation.accept(link('c'))).toBe(true);
  expect(navigation.accept(link('d') + '?grant=yes')).toBe(false);
  expect(navigation.flush()).toBe(running); expect(open).toHaveBeenCalledTimes(1);
  release(); await running;
  expect(urls).toEqual([route.replace('#/t/current', '#/context/' + 'a'.repeat(32)), route.replace('#/t/current', '#/context/' + 'c'.repeat(32))]);
  expect(open).toHaveBeenCalledTimes(2); await navigation.flush(); expect(open).toHaveBeenCalledTimes(2);
});

it('keeps a failed load available for a later explicit retry', async () => {
  const failure = new Error('load_failed');
  const loadURL = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const navigation = new ContextLinkNavigation({ open: async () => ({ getURL: () => route, loadURL }), isTrusted: value => value === route });
  navigation.accept(link('a')); await expect(navigation.flush()).rejects.toBe(failure);
  await navigation.flush(); expect(loadURL).toHaveBeenCalledTimes(2);
  await navigation.flush(); expect(loadURL).toHaveBeenCalledTimes(2);
});

it('rechecks trust on retry without navigating a previously untrusted window', async () => {
  let trusted = false;
  const loadURL = vi.fn(async () => {});
  const navigation = new ContextLinkNavigation({ open: async () => ({ getURL: () => route, loadURL }), isTrusted: () => trusted });
  navigation.accept(link('a')); await expect(navigation.flush()).rejects.toThrow('untrusted_navigation');
  expect(loadURL).not.toHaveBeenCalled(); trusted = true;
  await navigation.flush(); expect(loadURL).toHaveBeenCalledTimes(1);
});

it('accepts only literal fixed-length reference links', () => {
  const id = 'aB0_-'.repeat(6) + 'xY';
  expect(parseContextLink('xiaok://context/v1/' + id)).toBe(id);
  for (const value of [link('a') + '/', link('a') + '?x=1', link('a') + '#action', ' ' + link('a'), link('a') + '\n', link('a').replace('xiaok:', 'XIAOK:'), 'xiaok://context/v1/' + 'a'.repeat(31), 'xiaok://context/v1/' + 'a'.repeat(33), link('a').replace('/v1/', '/%76%31/'), 'xiaok://context/v1/' + '%61'.repeat(32), 'xiaok://context/v1/' + '中'.repeat(32)]) {
    expect(parseContextLink(value), JSON.stringify(value)).toBeNull();
  }
});

it('preserves packaged-only association and handles existing registration or refusal', () => {
  const setAsDefaultProtocolClient = vi.fn(() => true);
  expect(registerContextProtocol({ isPackaged: true, isDefaultProtocolClient: () => false, setAsDefaultProtocolClient }, 'win32')).toBe(true);
  expect(setAsDefaultProtocolClient).toHaveBeenCalledWith('xiaok'); setAsDefaultProtocolClient.mockClear();
  expect(registerContextProtocol({ isPackaged: true, isDefaultProtocolClient: () => true, setAsDefaultProtocolClient }, 'darwin')).toBe(true);
  expect(registerContextProtocol({ isPackaged: true, setAsDefaultProtocolClient }, 'linux')).toBe(false);
  expect(registerContextProtocol({ isPackaged: false, setAsDefaultProtocolClient }, 'win32')).toBe(false);
  expect(setAsDefaultProtocolClient).not.toHaveBeenCalled();
  expect(registerContextProtocol({ isPackaged: true, setAsDefaultProtocolClient: () => { throw new Error('refused'); } }, 'darwin')).toBe(false);
});
