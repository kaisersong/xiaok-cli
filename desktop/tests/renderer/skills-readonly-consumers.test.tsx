import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { SkillsSettingsContent } from '../../renderer/src/components/SkillsSettingsContent';
import { ChatInput } from '../../renderer/src/components/ChatInput';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
const mocks = vi.hoisted(() => ({ list: vi.fn(), stats: vi.fn(), on: vi.fn<(callback: () => void) => () => void>(), install: vi.fn(), uninstall: vi.fn(), discover: vi.fn() }));
vi.mock('../../renderer/src/components/ChatModelPicker', () => ({ ChatModelPicker: () => null }));
vi.mock('../../renderer/src/api/bridge', async importOriginal => {
  const actual = await importOriginal<typeof import('../../renderer/src/api/bridge')>();
  Object.assign(actual.api, { listSkills: mocks.list, getSkillStats: mocks.stats, onSkillsChanged: mocks.on, installSkill: mocks.install, uninstallSkill: mocks.uninstall,
    getSkillDebugConfig: async () => ({ enabled: false }), getKswarmConfig: async () => ({ maxConcurrentTasks: 3 }), getServiceStatus: async () => ({ services: [] }),
  });
  return { ...actual, discoverExternalSkills: mocks.discover };
});
const rows = [{ name: 'owned-skill', aliases: ['owned-alias'], description: 'Owned description', source: 'project', tier: 'project' }];
const stats = [{ skillName: 'owned-skill', totalCalls: 4, successCount: 3, errorCount: 1, avgDurationMs: 2000, p95DurationMs: 3000, totalInputTokens: 10, totalOutputTokens: 20, firstCalledAt: 1, lastCalledAt: 2 }];
function LocaleButton() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>test-locale</button>; }
function mount(kind: 'pane' | 'settings' | 'chat', submit = vi.fn()) {
  const view = render(<MemoryRouter><LocaleProvider><LocaleButton />{kind === 'pane' ? <DesktopSettings onClose={() => {}} /> : kind === 'settings' ? <SkillsSettingsContent accessToken="owned" /> : <ChatInput onSubmit={submit} />}</LocaleProvider></MemoryRouter>);
  if (kind === 'pane') fireEvent.click(screen.getByRole('button', { name: '技能管理' }));
  return view;
}
beforeEach(() => { localStorage.setItem('xiaok:locale', 'zh'); mocks.discover.mockReset().mockResolvedValue({ dirs: [] }); mocks.list.mockReset().mockResolvedValue(rows); mocks.stats.mockReset().mockResolvedValue(stats); mocks.on.mockReset().mockImplementation(() => () => {}); mocks.install.mockReset().mockResolvedValue({ success: true, message: 'owned install' }); mocks.uninstall.mockReset().mockResolvedValue({ success: true, message: 'owned uninstall' }); });
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); vi.restoreAllMocks(); });
it.each(['pane', 'settings', 'chat'] as const)('shows %s readonly list failure instead of successful empty facts', async kind => {
  mocks.list.mockRejectedValueOnce(Error('private-list')); mount(kind); expect(await screen.findByText(/无法读取技能列表/)).toBeInTheDocument(); expect(screen.queryByText('private-list')).toBeNull(); expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});
it.each(['pane', 'settings'] as const)('shows %s unavailable stats independently from a valid skill list', async kind => {
  mocks.stats.mockRejectedValue(Error('private-stats')); mount(kind); expect(await screen.findByText(/无法读取技能统计/)).toBeInTheDocument(); expect(await screen.findByText(/^\/?owned-skill$/)).toBeInTheDocument(); expect(mocks.list).toHaveBeenCalledTimes(1); expect(mocks.install).not.toHaveBeenCalled();
});
it('shares one parent stats read with the real InstalledSkillsView child', async () => {
  mount('settings'); await screen.findByText(/^\/?owned-skill$/); await waitFor(() => expect(mocks.stats).toHaveBeenCalled()); expect(mocks.stats).toHaveBeenCalledTimes(1);
});
it('preserves pane last-good list and stats when a later event refresh fails', async () => {
  mount('pane'); await screen.findByText(/^\/?owned-skill$/); mocks.list.mockRejectedValueOnce(Error('owned-later')); await act(async () => mocks.on.mock.calls[0]![0]()); expect(await screen.findByText(/无法读取技能列表/)).toBeInTheDocument(); expect(screen.getByText(/^\/?owned-skill$/)).toBeInTheDocument(); expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});
it('coalesces held pane list events and explicit manual rereads without a mutation', async () => {
  let finish!: (value: unknown) => void; mocks.list.mockReturnValueOnce(new Promise(yes => { finish = yes; })); const view = mount('pane');
  try {
    await act(async () => { mocks.on.mock.calls[0]![0](); mocks.on.mock.calls[0]![0](); });
    expect(mocks.list).toHaveBeenCalledTimes(1);
  } finally { await act(async () => finish(rows)); }
  await screen.findByText(/^\/?owned-skill$/); expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.install).not.toHaveBeenCalled(); view.unmount();
});
it('does not let late unmounted pane reads or events relaunch work', async () => {
  let finish!: (value: unknown) => void; mocks.list.mockReturnValueOnce(new Promise(yes => { finish = yes; })); const view = mount('pane'); const callback = mocks.on.mock.calls[0]![0]; view.unmount(); await act(async () => { callback(); finish(rows); }); expect(mocks.list).toHaveBeenCalledTimes(1); expect(mocks.install).not.toHaveBeenCalled();
});
it('keeps ordinary ChatInput submission usable when skill discovery is unavailable', async () => {
  mocks.list.mockRejectedValue(Error('owned-list')); const submit = vi.fn(); mount('chat', submit); await screen.findByText(/无法读取技能列表/); const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value: 'ordinary task' } }); fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); await waitFor(() => expect(submit).toHaveBeenCalled()); expect(mocks.install).not.toHaveBeenCalled();
});
it('renders current locale read failure labels after a held request settles', async () => {
  let reject!: (error: unknown) => void; mocks.list.mockReturnValueOnce(new Promise((_yes, no) => { reject = no; })).mockRejectedValueOnce(Error('owned-current-locale')); mount('pane'); fireEvent.click(screen.getByRole('button', { name: 'test-locale' })); await act(async () => reject(Error('owned-list'))); expect(await screen.findByText(/Unable to read skills/)).toBeInTheDocument(); expect(mocks.install).not.toHaveBeenCalled();
});

it('keeps actual external skill names and renders Windows instruction basenames', async () => {
  mocks.discover.mockResolvedValue({ dirs: [{ path: 'C:\\owned', skills: [
    { name: 'owned-external-one', instruction_path: 'C:\\owned\\one\\SKILL.md' },
    { name: 'owned-external-two', instruction_path: 'C:\\owned\\two\\AGENTS.md' },
  ] }] });
  mount('settings');
  expect(await screen.findByText('owned-external-one')).toBeInTheDocument();
  expect(screen.getByText('owned-external-two')).toBeInTheDocument();
  expect(screen.getByText('SKILL.md')).toBeInTheDocument();
  expect(screen.getByText('AGENTS.md')).toBeInTheDocument();
  expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});
it('keeps historical nonfinite stats unknown in actual weekly summary and detail', async () => {
  mocks.stats.mockResolvedValue([{ ...stats[0], totalCalls: 6, avgDurationMs: NaN, lastCalledAt: Date.now() }]);
  mount('settings'); await screen.findByText(/^\/?owned-skill$/);
  await waitFor(() => expect(screen.queryAllByText(/统计值未知/).length).toBeGreaterThan(0));
  expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'owned-skill' }));
  expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  expect(screen.getAllByText(/统计值未知/).length).toBeGreaterThan(1);
});

it('keeps settings last-good facts after a failed manual retry without mutations', async () => {
  mount('settings'); await screen.findByText(/^\/?owned-skill$/);
  mocks.list.mockRejectedValueOnce(Error('owned-list-failure')); mocks.stats.mockRejectedValueOnce(Error('owned-stats-failure'));
  fireEvent.click(screen.getByRole('button', { name: '刷新技能信息' }));
  expect(await screen.findByText(/无法读取技能列表/)).toBeInTheDocument();
  expect(await screen.findByText(/无法读取技能统计/)).toBeInTheDocument();
  expect(screen.getByText(/^\/?owned-skill$/)).toBeInTheDocument();
  expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});

it.each(['pane', 'settings'] as const)('coalesces held %s manual catalog/stats retries into one successor', async kind => {
  mount(kind); await screen.findByText(/^\/?owned-skill$/);
  let listDone!: (value: typeof rows) => void, statsDone!: (value: typeof stats) => void;
  mocks.list.mockReturnValueOnce(new Promise(resolve => { listDone = resolve; })); mocks.stats.mockReturnValueOnce(new Promise(resolve => { statsDone = resolve; }));
  const retry = screen.getByRole('button', { name: '刷新技能信息' });
  fireEvent.click(retry); fireEvent.click(retry); fireEvent.click(retry);
  expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.stats).toHaveBeenCalledTimes(2);
  await act(async () => { listDone(rows); statsDone(stats); });
  await waitFor(() => { expect(mocks.list).toHaveBeenCalledTimes(3); expect(mocks.stats).toHaveBeenCalledTimes(3); });
  expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});
it.each(['settings', 'chat'] as const)('late unmounted %s list and queued events cannot restart reads', async kind => {
  let release!: (value: typeof rows) => void; mocks.list.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const view = mount(kind), callback = mocks.on.mock.calls[0]![0];
  await act(async () => callback()); view.unmount(); await act(async () => { callback(); release(rows); });
  expect(mocks.list).toHaveBeenCalledTimes(1); expect(mocks.install).not.toHaveBeenCalled();
});
it('keeps ordinary ChatInput submission usable during a held discovery request', async () => {
  let release!: (value: typeof rows) => void; mocks.list.mockReturnValueOnce(new Promise(resolve => { release = resolve; })); const submit = vi.fn(), view = mount('chat', submit);
  try { const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value: 'ordinary held task' } }); fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); await waitFor(() => expect(submit).toHaveBeenCalled()); }
  finally { view.unmount(); await act(async () => release(rows)); }
  expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});

it('preserves explicit successful pane install and its readonly refresh with original arguments', async () => {
  mount('pane'); await screen.findByText(/^\/?owned-skill$/); fireEvent.click(screen.getByRole('button', { name: '安装技能' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  owned-new-skill  ' } }); fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
  await waitFor(() => expect(mocks.install).toHaveBeenCalledExactlyOnceWith('owned-new-skill'));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); expect(mocks.uninstall).not.toHaveBeenCalled();
});
it('keeps original uninstall confirmation and successful readonly refresh', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); mount('pane'); await screen.findByText(/^\/?owned-skill$/);
  fireEvent.click(screen.getByTitle('卸载')); expect(confirm).toHaveBeenCalledExactlyOnceWith('确定卸载技能 "owned-skill"？'); expect(mocks.uninstall).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByTitle('卸载'));
  await waitFor(() => expect(mocks.uninstall).toHaveBeenCalledExactlyOnceWith('owned-skill')); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); expect(mocks.install).not.toHaveBeenCalled();
});
it('readonly refresh never clears the existing explicit install failure', async () => {
  mocks.install.mockResolvedValue({ success: false, message: 'owned-action-failure' }); mount('pane'); await screen.findByText(/^\/?owned-skill$/);
  fireEvent.click(screen.getByRole('button', { name: '安装技能' })); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'owned-new-skill' } }); fireEvent.click(screen.getByRole('button', { name: '确认安装' }));
  expect(await screen.findByText('owned-action-failure')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '刷新技能信息' }));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); expect(screen.getByText('owned-action-failure')).toBeInTheDocument(); expect(mocks.install).toHaveBeenCalledTimes(1);
});

it('shows initial unknown ChatInput skill facts until its held discovery settles', async () => {
  let release!: (value: typeof rows) => void; mocks.list.mockReturnValueOnce(new Promise(resolve => { release = resolve; })); const view = mount('chat');
  try { expect(screen.getByText('技能信息未知')).toBeInTheDocument(); expect(mocks.install).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled(); }
  finally { await act(async () => release(rows)); }
  expect(screen.queryByText('技能信息未知')).toBeNull(); view.unmount();
});
