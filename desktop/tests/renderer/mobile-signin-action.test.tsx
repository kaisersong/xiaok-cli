import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn(), on: vi.fn<(callback: (value: unknown) => void) => () => void>() }));
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,owned') }));
vi.mock('../../renderer/src/api/bridge', () => ({ api: { getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }), getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }), getMobileRelayStatus: mocks.read, onMobileRelayStatus: mocks.on, openMobileRelaySignIn: mocks.open, getMobilePairingInfo: vi.fn().mockResolvedValue({ desktopId: 'owned', desktopName: '', gatewayURL: '', reachableURLs: [], relayRoomSecret: 'owned', deepLink: 'xiaok://mobile/pair?owned' }) } }));
const status = { running: false, connected: false, relayUrl: 'wss://owned.invalid/ws', roomId: '', lastError: null, credentialState: 'expired', requiresUserReauth: true };
function LocaleButton() { const { setLocale } = useLocale(); return <button type="button" onClick={() => setLocale('en')}>test-locale</button>; }
function mount() { const view = render(<MemoryRouter><LocaleProvider><LocaleButton /><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: '移动端' })); return view; }
beforeEach(() => { localStorage.setItem('xiaok:locale', 'zh'); mocks.open.mockReset().mockResolvedValue({ ok: true, url: 'https://owned.invalid/auth/login' }); mocks.read.mockReset().mockResolvedValue(status); mocks.on.mockReset().mockImplementation(() => () => {}); });
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); });
it.each([undefined, null, 42, {}, { ok: true }, { ok: false, error: 'relay_url_unknown' }])('shows localized failure for invalid/rejected sign-in result %s', async value => {
  mocks.open.mockResolvedValueOnce(value); mount(); fireEvent.click(await screen.findByRole('button', { name: '打开登录页面' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法打开 Relay 登录页面'); expect(mocks.open).toHaveBeenCalledTimes(1); expect(screen.getByText('relay 凭据已过期，需要重新登录')).toBeInTheDocument();
});
it('handles rejection without displaying arbitrary exception details or auto retry', async () => {
  mocks.open.mockRejectedValueOnce(Error('private-error')); mount(); fireEvent.click(await screen.findByRole('button', { name: '打开登录页面' })); await screen.findByRole('alert'); expect(screen.queryByText('private-error')).toBeNull(); expect(mocks.open).toHaveBeenCalledTimes(1);
});
it('holds one explicit action across double clicks and locale, then displays current labels', async () => {
  let fail!: (error: unknown) => void; mocks.open.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; })); mount(); const button = await screen.findByRole('button', { name: '打开登录页面' }); fireEvent.click(button); fireEvent.click(button); expect(mocks.open).toHaveBeenCalledTimes(1); expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'test-locale' })); await act(async () => fail(Error('owned'))); expect(screen.getByRole('alert')).toHaveTextContent('Unable to open the Relay sign-in page'); expect(button).not.toBeDisabled();
});
it('does not clear an action failure or open again when a status event arrives', async () => {
  mocks.open.mockResolvedValueOnce({ ok: false, error: 'relay_url_invalid' }); mount(); fireEvent.click(await screen.findByRole('button', { name: '打开登录页面' })); await screen.findByRole('alert');
  await act(async () => mocks.on.mock.calls[0]![0]({ ...status, credentialState: 'rejected' })); expect(screen.getByRole('alert')).toHaveTextContent('无法打开 Relay 登录页面'); expect(mocks.open).toHaveBeenCalledTimes(1);
});
it('does not issue another action/read or update credentials after unmount/late completion', async () => {
  let finish!: (value: unknown) => void; mocks.open.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); const view = mount(); fireEvent.click(await screen.findByRole('button', { name: '打开登录页面' })); view.unmount(); await act(async () => finish({ ok: true, url: 'https://owned.invalid/auth/login' })); expect(mocks.open).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(1);
});
it('keeps ordinary reads free of sign-in and does not claim reauthenticated after success', async () => {
  mount(); const button = await screen.findByRole('button', { name: '打开登录页面' }); expect(mocks.open).not.toHaveBeenCalled(); fireEvent.click(button); await waitFor(() => expect(button).not.toBeDisabled()); expect(screen.getByText('relay 凭据已过期，需要重新登录')).toBeInTheDocument(); expect(mocks.read).toHaveBeenCalledTimes(1);
});
