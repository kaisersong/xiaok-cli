import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const locale = vi.hoisted(() => ({ value: 'zh' as 'zh' | 'en' }));
vi.mock('../../renderer/src/contexts/LocaleContext', async () => {
  const { zh } = await import('../../renderer/src/locales/zh'); const { en } = await import('../../renderer/src/locales/en');
  return { useLocale: () => ({ locale: locale.value, t: locale.value === 'zh' ? zh : en }) };
});
const model = (state = 'ready') => ({ id: 'clef-flash-mlx-4bit', source: 'fixed-source', revision: 'fixed-revision', sizeBytes: 1024, sizeLabel: '1 KiB', supported: true, verified: state === 'ready', state, reason: null, downloadedBytes: 0, currentFile: null, availableDiskBytes: 4096, codeHash: 'fixed-code-hash', runtime: 'clef-mlx', endpoint: null, selected: false, automaticMemoryRerank: 'not-qualified-r12' });
let views: ReturnType<typeof model>[], listener: ((value: typeof views) => void) | undefined;
let backend: { decisionModelsList: ReturnType<typeof vi.fn>; decisionModelsDownload: ReturnType<typeof vi.fn>; decisionModelsCancel: ReturnType<typeof vi.fn>; decisionModelsRemove: ReturnType<typeof vi.fn>; decisionModelsStart: ReturnType<typeof vi.fn>; decisionModelsStop: ReturnType<typeof vi.fn>; decisionModelsUse: ReturnType<typeof vi.fn>; onDecisionModelsChanged: ReturnType<typeof vi.fn>; memory: { setConfig: ReturnType<typeof vi.fn> } };
const unsubscribe = vi.fn();
beforeEach(() => {
  locale.value = 'zh'; views = [model()]; listener = undefined; unsubscribe.mockClear();
  backend = { decisionModelsList: vi.fn(async () => views), decisionModelsDownload: vi.fn(async () => {}), decisionModelsCancel: vi.fn(async () => {}), decisionModelsRemove: vi.fn(async () => {}), decisionModelsStart: vi.fn(async () => {}), decisionModelsStop: vi.fn(async () => {}), decisionModelsUse: vi.fn(async (id: string) => { views = views.map(value => ({ ...value, selected: value.id === id })); return { version: 1, modelId: id, revision: 'fixed-revision', automaticMemoryRerank: 'not-qualified-r12' }; }), onDecisionModelsChanged: vi.fn(handler => { listener = handler; return unsubscribe; }), memory: { setConfig: vi.fn() } };
  Object.assign(window, { xiaokDesktop: backend });
});
afterEach(cleanup);
const componentPath = '../../renderer/src/components/settings/DecisionModelSettings';
const component = () => import(componentPath);

it('prefers a Main event over an older initial list and saves selection without enabling memory', async () => {
  let resolve!: (value: typeof views) => void; backend.decisionModelsList.mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  expect(backend.onDecisionModelsChanged).toHaveBeenCalledTimes(1);
  act(() => listener?.([model()]));
  await act(async () => resolve([model('not_installed')]));
  fireEvent.click(await screen.findByRole('button', { name: '选择模型' }));
  await waitFor(() => expect(backend.decisionModelsUse).toHaveBeenCalledWith('clef-flash-mlx-4bit'));
  expect(backend.memory.setConfig).not.toHaveBeenCalled();
  expect(await screen.findByText('配置已保存，自动记忆重排未启用。')).toBeTruthy();
});

it('excludes duplicate download clicks in the same turn and keeps cancel available', async () => {
  views = [model('not_installed')]; let release!: () => void; backend.decisionModelsDownload.mockReturnValue(new Promise<void>(value => { release = value; }));
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  const download = await screen.findByRole('button', { name: '下载' });
  fireEvent.click(download); fireEvent.click(download); expect(backend.decisionModelsDownload).toHaveBeenCalledTimes(1);
  act(() => listener?.([model('downloading')]));
  fireEvent.click(screen.getByRole('button', { name: '取消下载' }));
  await waitFor(() => expect(backend.decisionModelsCancel).toHaveBeenCalledTimes(1));
  await act(async () => release());
});

it('requires explicit source confirmation before starting community runtime code', async () => {
  views = [{ ...model('installed'), verified: true }];
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  fireEvent.click(await screen.findByRole('button', { name: '启动' }));
  expect(backend.decisionModelsStart).not.toHaveBeenCalled(); expect(screen.getByText('fixed-source')).toBeTruthy(); expect(screen.getByText('fixed-code-hash')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认启动' }));
  await waitFor(() => expect(backend.decisionModelsStart).toHaveBeenCalledWith({ modelId: 'clef-flash-mlx-4bit', approveCommunityCode: true }));
});

it('rejects an old confirmation after the received source revision changes', async () => {
  views = [{ ...model('installed'), verified: true }];
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  fireEvent.click(await screen.findByRole('button', { name: '启动' }));
  act(() => listener?.([{ ...views[0], revision: 'changed' }]));
  fireEvent.click(screen.getByRole('button', { name: '确认启动' }));
  expect(backend.decisionModelsStart).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('模型信息已变化');
});

it('requires a separate removal confirmation and permits stopping a loading runtime', async () => {
  views = [{ ...model('loading'), verified: true }];
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  fireEvent.click(await screen.findByRole('button', { name: '停止' }));
  await waitFor(() => expect(backend.decisionModelsStop).toHaveBeenCalledTimes(1));
  act(() => listener?.([{ ...model('installed'), verified: true }]));
  fireEvent.click(screen.getByRole('button', { name: '删除' })); expect(backend.decisionModelsRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(backend.decisionModelsRemove).toHaveBeenCalledWith('clef-flash-mlx-4bit'));
});

it('ignores old callbacks after unmount and reloads the authoritative Main snapshot on reopen', async () => {
  let resolve!: (value: typeof views) => void; backend.decisionModelsList.mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const { DecisionModelSettings } = await component(); const mounted = render(<DecisionModelSettings />); const oldListener = listener; mounted.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  views = [model('downloading')]; render(<DecisionModelSettings />);
  expect(await screen.findByRole('button', { name: '取消下载' })).toBeTruthy();
  await act(async () => { resolve([model()]); oldListener?.([model()]); });
  expect(screen.getByRole('button', { name: '取消下载' })).toBeTruthy(); expect(backend.decisionModelsUse).not.toHaveBeenCalled();
});

it('localizes rerenders without dispatching actions or creating duplicate subscriptions', async () => {
  const { DecisionModelSettings } = await component(); const mounted = render(<DecisionModelSettings />);
  await screen.findByRole('button', { name: '选择模型' }); locale.value = 'en'; mounted.rerender(<DecisionModelSettings />);
  expect(screen.getByRole('button', { name: 'Select model' })).toBeTruthy(); expect(backend.onDecisionModelsChanged).toHaveBeenCalledTimes(1);
  expect(backend.decisionModelsUse).not.toHaveBeenCalled(); expect(backend.decisionModelsStart).not.toHaveBeenCalled(); expect(backend.decisionModelsDownload).not.toHaveBeenCalled();
});

it('keeps an interrupted download retryable and reports list failure instead of empty success', async () => {
  backend.decisionModelsList.mockRejectedValueOnce(new Error('not_available'));
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  views = [model('interrupted')]; fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  fireEvent.click(await screen.findByRole('button', { name: '重新下载' }));
  await waitFor(() => expect(backend.decisionModelsDownload).toHaveBeenCalledWith('clef-flash-mlx-4bit'));
});

it('discards a failed stale initial list after receiving a current Main event', async () => {
  let reject!: (reason: Error) => void; backend.decisionModelsList.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  act(() => listener?.([model()])); await act(async () => reject(new Error('old_read_failed')));
  expect(screen.getByRole('button', { name: '选择模型' })).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
});

it('checks the latest received state before dispatch even when React has not rendered it yet', async () => {
  views = [model('not_installed')]; const { DecisionModelSettings } = await component(); render(<DecisionModelSettings />);
  const download = await screen.findByRole('button', { name: '下载' });
  act(() => { listener?.([model('downloading')]); fireEvent.click(download); });
  expect(backend.decisionModelsDownload).not.toHaveBeenCalled();
});
