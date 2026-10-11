import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({ pairing: vi.fn(), relay: vi.fn(), signIn: vi.fn(), qr: vi.fn(), copy: vi.fn(), off: vi.fn(), onStatus: vi.fn<(listener: (status: unknown) => void) => () => void>() }));
vi.mock('qrcode', () => ({ toDataURL: mocks.qr }));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }), getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
  getMobilePairingInfo: mocks.pairing, getMobileRelayStatus: mocks.relay, onMobileRelayStatus: mocks.onStatus, openMobileRelaySignIn: mocks.signIn,
} }));
const pairing = (id: string) => ({ desktopId: id, desktopName: 'Owned', gatewayURL: '', reachableURLs: [], relayRoomSecret: 'owned-surrogate-secret', deepLink: 'xiaok://mobile/pair?desktopId=' + id });
const relay = (state = 'ok') => ({ running: true, connected: true, relayUrl: 'wss://owned.invalid/ws', roomId: 'owned', lastError: null, credentialState: state, requiresUserReauth: state !== 'ok' });
function held<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function LocaleControl() { const { setLocale } = useLocale(); return <button type="button" onClick={() => setLocale('en')}>test-locale</button>; }
function mount() {
  const view = render(<MemoryRouter><LocaleProvider><LocaleControl /><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '移动端' })); return view;
}
beforeEach(() => {
  localStorage.setItem('xiaok:locale', 'zh'); vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.pairing.mockResolvedValue(pairing('first')); mocks.relay.mockResolvedValue(relay()); mocks.qr.mockImplementation(async (link: string) => 'data:image/png;base64,' + btoa(link));
  mocks.onStatus.mockImplementation(() => mocks.off); mocks.copy.mockResolvedValue(undefined);
  mocks.signIn.mockResolvedValue({ ok: true, url: 'https://owned.invalid/auth/login' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } });
});
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); });

describe('actual MobilePane atomic presentation and readonly recovery', () => {
  it('provides localized initial pairing failure and a read-only retry', async () => {
    mocks.pairing.mockRejectedValueOnce(Error('private-owned-error')); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('读取移动端配对信息失败。'); expect(screen.queryByText('private-owned-error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新连接信息' }));
    expect(await screen.findByText('first')).toBeInTheDocument(); expect(mocks.pairing).toHaveBeenCalledTimes(2); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it.each(['reader', 'qr'])('keeps the last good pairing and QR after %s failure', async failure => {
    mount(); const image = await screen.findByRole('img', { name: '移动端配对二维码' }); const previous = image.getAttribute('src');
    if (failure === 'reader') mocks.pairing.mockRejectedValueOnce(Error('private-refresh'));
    else { mocks.pairing.mockResolvedValueOnce(pairing('second')); mocks.qr.mockRejectedValueOnce(Error('private-qr')); }
    fireEvent.click(screen.getByRole('button', { name: '刷新连接信息' })); await screen.findByRole('alert');
    expect(screen.getByRole('img', { name: '移动端配对二维码' })).toHaveAttribute('src', previous); expect(screen.getByText('first')).toBeInTheDocument(); expect(screen.queryByText('second')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制链接' })); await waitFor(() => expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(pairing('first').deepLink)); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('keeps the old QR and copied link together until the new QR resolves, with single-flight refresh', async () => {
    mount(); const image = await screen.findByRole('img', { name: '移动端配对二维码' }), previous = image.getAttribute('src');
    const qr = held<string>(); mocks.pairing.mockResolvedValueOnce(pairing('second')); mocks.qr.mockReturnValueOnce(qr.promise);
    const refresh = screen.getByRole('button', { name: '刷新连接信息' }); fireEvent.click(refresh); fireEvent.click(refresh);
    await waitFor(() => expect(mocks.qr).toHaveBeenCalledTimes(2)); expect(mocks.pairing).toHaveBeenCalledTimes(2); expect(refresh).toBeDisabled();
    expect(screen.getByText('first')).toBeInTheDocument(); expect(image).toHaveAttribute('src', previous);
    fireEvent.click(screen.getByRole('button', { name: '复制链接' })); await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(pairing('first').deepLink));
    await act(async () => qr.resolve('data:image/png;base64,owned-new-qr'));
    expect(screen.getByText('second')).toBeInTheDocument(); expect(image).toHaveAttribute('src', 'data:image/png;base64,owned-new-qr');
    fireEvent.click(screen.getByRole('button', { name: '复制链接' })); await waitFor(() => expect(mocks.copy).toHaveBeenLastCalledWith(pairing('second').deepLink)); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('invalidates an old held QR after a locale effect generation changes', async () => {
    const qr = held<string>(); mocks.qr.mockReturnValueOnce(qr.promise); mount(); await waitFor(() => expect(mocks.qr).toHaveBeenCalledTimes(1));
    mocks.pairing.mockResolvedValueOnce(pairing('new-locale')); fireEvent.click(screen.getByRole('button', { name: 'test-locale' }));
    expect(await screen.findByText('new-locale')).toBeInTheDocument();
    const src = screen.getByRole('img').getAttribute('src'); await act(async () => qr.resolve('data:image/png;base64,obsolete'));
    expect(screen.getByRole('img')).toHaveAttribute('src', src); expect(screen.getByText('new-locale')).toBeInTheDocument(); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('does not start QR work when a held pairing read settles after unmount', async () => {
    const read = held<ReturnType<typeof pairing>>(); mocks.pairing.mockReturnValueOnce(read.promise); const view = mount(); view.unmount();
    await act(async () => read.resolve(pairing('obsolete'))); expect(mocks.qr).not.toHaveBeenCalled(); expect(mocks.off).toHaveBeenCalledTimes(1); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])('keeps a newer relay event after a held initial read %s', async finish => {
    const read = held<ReturnType<typeof relay>>(); mocks.relay.mockReturnValueOnce(read.promise); mount(); await screen.findByText('first');
    const listener = mocks.onStatus.mock.calls[0]![0]; await act(async () => listener(relay('expired')));
    expect(screen.getByText('relay 凭据已过期，需要重新登录')).toBeInTheDocument();
    await act(async () => { if (finish === 'resolve') read.resolve(relay()); else read.reject(Error('private-held')); });
    expect(screen.getByText('relay 凭据已过期，需要重新登录')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull(); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('shows relay read unavailable and retries only the readonly status', async () => {
    mocks.relay.mockRejectedValueOnce(Error('private-relay')); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取移动端连接状态。');
    fireEvent.click(screen.getByRole('button', { name: '重新读取连接状态' })); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.relay).toHaveBeenCalledTimes(2); expect(mocks.pairing).toHaveBeenCalledTimes(1); expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it('ignores a retired relay subscription callback after remount', async () => {
    const view = mount(); await screen.findByText('first'); const old = mocks.onStatus.mock.calls[0]![0];
    fireEvent.click(screen.getByRole('button', { name: '通用设置' })); fireEvent.click(screen.getByRole('button', { name: '移动端' })); await screen.findByText('first');
    await act(async () => old(relay('expired'))); expect(screen.queryByText('relay 凭据已过期，需要重新登录')).toBeNull(); expect(mocks.off).toHaveBeenCalledTimes(1); view.unmount();
  });
  it('preserves the explicit user sign-in button as an independent action', async () => {
    mocks.relay.mockResolvedValueOnce(relay('expired')); mount(); const button = await screen.findByRole('button', { name: '打开登录页面' });
    expect(mocks.signIn).not.toHaveBeenCalled(); await act(async () => fireEvent.click(button)); expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });
});
