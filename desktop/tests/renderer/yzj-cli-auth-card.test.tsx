import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YzjCliAuthCard } from '../../renderer/src/components/settings/YzjCliAuthCard';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ getYzjCliAuthState: vi.fn(), controlYzjCliAuth: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => mocks }));
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.removeItem('xiaok:locale'); });
function state(phase: string, revision: number) { return { phase, revision }; }
function show() { render(<LocaleProvider><YzjCliAuthCard /></LocaleProvider>); }
describe('Desktop Yunzhijia CLI browser login card', () => {
 it('shows account identity, token expiration, and the recorded connection and verification times', async () => {
  mocks.controlYzjCliAuth.mockResolvedValue({ phase: 'authenticated', revision: 2, connection: { name: '张三', department: '产品部', openId: 'user-one', orgId: 'org-one', connectedAt: '2026-11-05T08:00:00.000Z', checkedAt: '2026-11-05T08:01:00.000Z', expiresAt: '2026-11-05T10:00:00.000Z', tokenStatus: 'needs_refresh' } });
  show(); await screen.findByText('张三');
  for (const text of ['产品部', 'user-one', 'org-one', '最近扫码连接', '访问凭证到期', '最近核验', '临期，调用时刷新']) expect(screen.getByText(text)).toBeInTheDocument();
  expect(document.querySelectorAll('time')).toHaveLength(3);
  expect(document.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-05T08:00:00.000Z');
 });
 it('distinguishes unrecorded connections and missing expiry from a known lifetime', async () => {
  mocks.controlYzjCliAuth.mockResolvedValue({ phase: 'authenticated', revision: 2, connection: { name: '张三', checkedAt: '2026-11-05T08:01:00.000Z' } });
  show(); await screen.findByText('张三'); expect(screen.getByText('未记录')).toBeInTheDocument(); expect(screen.getAllByText('未提供').length).toBeGreaterThan(0);
 });
 it('renders connection metadata and token state in English', async () => {
  localStorage.setItem('xiaok:locale', 'en');
  mocks.controlYzjCliAuth.mockResolvedValue({ phase: 'authenticated', revision: 2, connection: { name: 'Taylor', checkedAt: '2026-11-05T08:01:00.000Z', tokenStatus: 'expired' } });
  show(); await screen.findByText('Taylor'); expect(screen.getByText('Access token expires')).toBeInTheDocument(); expect(screen.getByText('Not recorded')).toBeInTheDocument(); expect(screen.getByText('Expired')).toBeInTheDocument();
 });
 it('removes account details once a newer check reports signed out', async () => {
  mocks.controlYzjCliAuth.mockResolvedValueOnce({ phase: 'authenticated', revision: 2, connection: { name: '旧账号', checkedAt: '2026-11-05T08:01:00.000Z' } }).mockResolvedValueOnce(state('signedOut', 3));
  show(); await screen.findByText('旧账号'); fireEvent.click(screen.getByRole('button', { name: '重新检查' })); await screen.findByText('尚未登录'); expect(screen.queryByText('旧账号')).toBeNull();
 });

 it('checks identity without auto-login, then exposes the browser scan action and cancellation', async () => {
  mocks.controlYzjCliAuth.mockResolvedValueOnce(state('signedOut', 1)).mockResolvedValueOnce(state('waiting', 2)).mockResolvedValueOnce(state('cancelled', 3));
  mocks.getYzjCliAuthState.mockResolvedValue(state('waiting', 2)); show();
  await screen.findByText('尚未登录'); expect(mocks.controlYzjCliAuth).toHaveBeenCalledWith('check');
  expect(mocks.controlYzjCliAuth).not.toHaveBeenCalledWith('login');
  fireEvent.click(screen.getByRole('button', { name: '浏览器扫码登录' })); await screen.findByText(/等待.*扫码/);
  fireEvent.click(screen.getByRole('button', { name: '取消等待' })); await screen.findByText('已取消本次登录等待');
 });
 it('shows identity verification failure with a check-again action', async () => {
  mocks.controlYzjCliAuth.mockResolvedValue(state('verificationFailed', 2)); show();
  await screen.findByText(/登录结果暂未核实/); expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled();
 });
 it('ignores an old held read after a newer cancellation receipt', async () => {
  vi.useFakeTimers(); let resolveOld: (value: any) => void = () => {};
  mocks.controlYzjCliAuth.mockResolvedValueOnce(state('waiting', 4)).mockResolvedValueOnce(state('cancelled', 6));
  mocks.getYzjCliAuthState.mockReturnValue(new Promise(resolve => { resolveOld = resolve; }));
  show(); await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  fireEvent.click(screen.getByRole('button', { name: '取消等待' })); await act(async () => { await Promise.resolve(); });
  await act(async () => { resolveOld(state('authenticated', 5)); await Promise.resolve(); });
  expect(screen.getByText('已取消本次登录等待')).toBeInTheDocument(); expect(screen.queryByText('已登录云之家')).toBeNull();
  vi.useRealTimers();
 });
 it('reports bridge failures without rendering raw error credentials', async () => {
  mocks.controlYzjCliAuth.mockRejectedValue(new Error('accessToken=secret-canary')); show();
  await screen.findByText('暂时无法读取登录状态，请重试'); expect(screen.queryByText(/secret-canary/)).toBeNull();
 });
});
