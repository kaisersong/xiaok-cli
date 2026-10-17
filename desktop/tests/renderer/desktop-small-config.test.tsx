import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const m = vi.hoisted(() => ({ getSkill: vi.fn(), saveSkill: vi.fn(), getConcurrency: vi.fn(), saveConcurrency: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', () => ({ api: {
  getSkillDebugConfig: m.getSkill, saveSkillDebugConfig: m.saveSkill,
  getKswarmConfig: m.getConcurrency, saveKswarmConfig: m.saveConcurrency,
  getServiceStatus: vi.fn().mockResolvedValue({ checkedAt: 1, services: [] }),
  getAccountSettings: vi.fn().mockResolvedValue({ pipeline_trace_enabled: false, prompt_cache_debug_enabled: false }),
  updateAccountSettings: vi.fn().mockResolvedValue({}),
} }));
function open() { return render(<MemoryRouter><LocaleProvider><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test';
  (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test';
  m.getSkill.mockReset().mockResolvedValue({ enabled: false }); m.saveSkill.mockReset().mockResolvedValue({ enabled: true });
  m.getConcurrency.mockReset().mockResolvedValue({ maxConcurrentTasks: 3 }); m.saveConcurrency.mockReset().mockResolvedValue({ maxConcurrentTasks: 6 });
});
afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__APP_VERSION__; delete (globalThis as Record<string, unknown>).__APP_BUILD__; });
it('keeps the last confirmed debug value while the real Settings mutation is pending', async () => {
  const save = deferred<{ enabled: boolean }>(); m.saveSkill.mockReturnValue(save.promise); open();
  const toggle = await screen.findByLabelText('切换 Stage 调试输出');
  await waitFor(() => expect(m.getSkill).toHaveBeenCalled());
  fireEvent.click(toggle);
  expect(m.saveSkill).toHaveBeenCalledExactlyOnceWith({ enabled: true });
  try { expect(toggle).not.toHaveClass('bg-[var(--c-accent)]'); }
  finally { await act(async () => { save.resolve({ enabled: true }); }); }
});
it('keeps the last confirmed concurrency while the real Settings save is pending', async () => {
  const save = deferred<{ maxConcurrentTasks: number }>(); m.saveConcurrency.mockReturnValue(save.promise); open();
  const range = await screen.findByLabelText('最大并发任务数');
  await waitFor(() => expect(range).toHaveValue('3'));
  fireEvent.change(range, { target: { value: '6' } });
  expect(m.saveConcurrency).toHaveBeenCalledExactlyOnceWith({ maxConcurrentTasks: 6 });
  try { expect(range).toHaveValue('3'); }
  finally { await act(async () => { save.resolve({ maxConcurrentTasks: 6 }); }); }
});
it('uses the actual returned configuration instead of assuming the requested value was persisted', async () => {
  m.saveSkill.mockResolvedValue({ enabled: false }); m.saveConcurrency.mockResolvedValue({ maxConcurrentTasks: 4 }); open();
  const toggle = await screen.findByLabelText('切换 Stage 调试输出'), range = await screen.findByLabelText('最大并发任务数');
  fireEvent.click(toggle); fireEvent.change(range, { target: { value: '6' } });
  await waitFor(() => expect(m.saveConcurrency).toHaveBeenCalled());
  await act(async () => {});
  expect(toggle).not.toHaveClass('bg-[var(--c-accent)]'); expect(range).toHaveValue('4');
});
it('does not let a slow initial configuration read overwrite a later confirmed user save', async () => {
  const read = deferred<{ enabled: boolean }>(); m.getSkill.mockReturnValue(read.promise); open();
  const toggle = await screen.findByLabelText('切换 Stage 调试输出');
  fireEvent.click(toggle); await waitFor(() => expect(toggle).toHaveClass('bg-[var(--c-accent)]'));
  await act(async () => { read.resolve({ enabled: false }); });
  expect(toggle).toHaveClass('bg-[var(--c-accent)]');
});
it('retains confirmed values and shows uncertainty without retrying a failed mutation', async () => {
  m.saveConcurrency.mockRejectedValue(Error('desktop_config_operation_unknown')); open();
  const range = await screen.findByLabelText('最大并发任务数');
  await waitFor(() => expect(range).toHaveValue('3'));
  fireEvent.change(range, { target: { value: '6' } });
  await screen.findByText('保存结果未确认，请重新打开设置后检查。');
  expect(range).toHaveValue('3'); expect(range).not.toBeDisabled();
  expect(m.saveConcurrency).toHaveBeenCalledTimes(1);
});
it('shows a localized initial read failure without inventing a successful read', async () => {
  m.getSkill.mockRejectedValue(Error('desktop_config_projection_unavailable')); open();
  await screen.findByText('暂时无法读取设置，请稍后重试。');
  expect(m.saveSkill).not.toHaveBeenCalled();
});
