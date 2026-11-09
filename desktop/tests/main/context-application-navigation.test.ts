import { describe, expect, it, vi } from 'vitest';
const modulePath = '../../electron/context-continuity/application-navigation.ts';
const A = 'a'.repeat(32), B = 'b'.repeat(32);
function fixture(argv: string[] = []) {
  let listener: ((event: { preventDefault(): void }, url: string) => void) | undefined;
  let ready = false, open = true;
  const window = { getURL: () => 'file:///app/renderer/index.html#/t/old', loadURL: vi.fn(async (_url: string) => {}) };
  const options = {
    argv, isReady: () => ready, isOpen: () => open,
    open: vi.fn(async () => window), isTrusted: (url: string) => url.startsWith('file:///app/renderer/index.html#'),
    registerProtocol: vi.fn(), unavailable: vi.fn(),
    subscribeOpenUrl: vi.fn((callback: typeof listener) => { listener = callback; return stop; }),
  };
  const stop = vi.fn(() => { listener = undefined; });
  return { options, window, stop, ready: () => { ready = true; }, close: () => { open = false; },
    event: (url: string) => { const event = { preventDefault: vi.fn() }; listener?.(event, url); return event; }, retained: () => listener };
}
async function attach(options: ReturnType<typeof fixture>['options']) {
  const module = await import(/* @vite-ignore */ modulePath);
  return module.attachContextApplicationNavigation(options);
}
describe('actual context application navigation consumer', () => {
  it('drains cold-start arguments through the existing window owner only after ready', async () => {
    const f = fixture([`xiaok://context/v1/${A}`]), owner = await attach(f.options);
    expect(f.options.open).not.toHaveBeenCalled(); f.ready(); await owner.ready(); await owner.ready();
    expect(f.options.registerProtocol).toHaveBeenCalledTimes(1); expect(f.options.open).toHaveBeenCalledTimes(1);
    expect(f.window.loadURL).toHaveBeenCalledWith(`file:///app/renderer/index.html#/context/${A}`); owner.dispose();
  });
  it('keeps a later pre-ready OS link ahead of older launch arguments', async () => {
    const f = fixture([`xiaok://context/v1/${A}`]), owner = await attach(f.options);
    expect(f.event(`xiaok://context/v1/${B}`).preventDefault).toHaveBeenCalledTimes(1);
    expect(f.options.open).not.toHaveBeenCalled(); f.ready(); await owner.ready();
    expect(f.window.loadURL).toHaveBeenCalledExactlyOnceWith(`file:///app/renderer/index.html#/context/${B}`); owner.dispose();
  });
  it('leaves malformed and unrelated protocols to the existing application handlers', async () => {
    const f = fixture(), owner = await attach(f.options); f.ready();
    for (const url of [`xiaok://context/v1/${A}?grant=1`, `xiaok://context/v1/%61${A.slice(1)}`, 'intent-broker://open']) {
      expect(owner.secondInstance([url])).toBe(false); expect(f.event(url).preventDefault).not.toHaveBeenCalled();
    }
    await owner.ready(); expect(f.options.open).not.toHaveBeenCalled(); owner.dispose();
  });
  it('routes a later valid second instance through the same navigation owner', async () => {
    const f = fixture(), owner = await attach(f.options); f.ready(); await owner.ready();
    expect(owner.secondInstance(['app', `xiaok://context/v1/${A}`])).toBe(true); await owner.ready();
    expect(f.options.open).toHaveBeenCalledTimes(1); expect(f.window.loadURL).toHaveBeenCalledTimes(1); owner.dispose();
  });
  it('seals ingress and unsubscribes once before any later window opening', async () => {
    const f = fixture(), owner = await attach(f.options), old = f.retained(); owner.dispose(); owner.dispose();
    const event = { preventDefault: vi.fn() }; old?.(event, `xiaok://context/v1/${A}`);
    expect(owner.secondInstance([`xiaok://context/v1/${B}`])).toBe(false); await owner.ready();
    expect(f.stop).toHaveBeenCalledTimes(1); expect(event.preventDefault).not.toHaveBeenCalled(); expect(f.options.open).not.toHaveBeenCalled();
  });
  it('does not navigate if application shutdown starts while the real window owner is pending', async () => {
    const f = fixture([`xiaok://context/v1/${A}`]); let resolve!: (window: typeof f.window) => void;
    f.options.open.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    const owner = await attach(f.options); f.ready(); const pending = owner.ready();
    await vi.waitFor(() => expect(f.options.open).toHaveBeenCalledTimes(1)); f.close(); resolve(f.window); await pending;
    expect(f.window.loadURL).not.toHaveBeenCalled(); expect(f.options.unavailable).toHaveBeenCalledTimes(1); owner.dispose();
  });
  it('catches a real window-opening rejection instead of producing an unhandled navigation promise', async () => {
    const f = fixture([`xiaok://context/v1/${A}`]), raw = Error('window unavailable'); f.options.open.mockRejectedValue(raw);
    const owner = await attach(f.options); f.ready(); await owner.ready();
    expect(f.options.unavailable).toHaveBeenCalledWith(raw); expect(f.window.loadURL).not.toHaveBeenCalled(); owner.dispose();
  });
  it.each(['cold launch', 'second instance'])('uses the last valid argument for %s, consistently with the bounded latest-intent policy', async mode => {
    const args = [`xiaok://context/v1/${A}`, '--ignored', `xiaok://context/v1/${B}`];
    const f = fixture(mode === 'cold launch' ? args : []), owner = await attach(f.options);
    if (mode === 'second instance') expect(owner.secondInstance(args)).toBe(true);
    f.ready(); await owner.ready();
    expect(f.window.loadURL).toHaveBeenCalledExactlyOnceWith(`file:///app/renderer/index.html#/context/${B}`); owner.dispose();
  });

});
