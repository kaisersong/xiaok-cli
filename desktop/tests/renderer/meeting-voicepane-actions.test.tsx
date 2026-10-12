// Actual DesktopSettings mounts its private VoicePane; only external preload
// dependency is replaced. These page tests do not claim real IPC/native proof.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
import { zh } from '../../renderer/src/locales/zh';
import { en } from '../../renderer/src/locales/en';
const mocks = vi.hoisted(() => ({ models: vi.fn(), asr: vi.fn(), save: vi.fn(), download: vi.fn(), uninstall: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({ meetingListModels: mocks.models, meetingGetAsrConfig: mocks.asr, meetingSaveAsrConfig: mocks.save, meetingDownloadModel: mocks.download, meetingUninstallModel: mocks.uninstall }) }));
const model = { id: 'owned-model', fileName: 'owned.pt', sizeBytes: 10, sizeLabel: '10 B', cacheDir: '/owned', path: '/owned/owned.pt', downloaded: false, status: 'not_downloaded', capability: 'asr', engineId: 'whisper', packageId: 'owned', packageType: 'single-file', packageState: 'missing', manifestTrusted: true, runtimeAutoDownloadAllowed: false };
const config = { defaultProvider: 'aliyun-asr', volcengine: { configured: false, appKeyConfigured: false, accessKeyConfigured: false, endpoint: 'wss://before.invalid', resourceId: 'owned-resource' }, aliyun: { configured: true, apiKeyConfigured: true, baseUrl: 'https://before.invalid', model: 'fun-asr' } };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
function LocaleButton() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>test-switch-locale</button>; }
function mount() {
  const view = render(<MemoryRouter><LocaleProvider><LocaleButton /><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: zh.desktopSettings.voice })); return view;
}
async function ready() { await screen.findByText('owned.pt'); await screen.findByDisplayValue('https://before.invalid'); }
const apiKeyLabel = `${zh.desktopSettings.meetingAsrAliyunTitle} ${zh.desktopSettings.meetingAsrApiKey}`;
function action(kind: 'save' | 'download' | 'uninstall') {
  fireEvent.click(screen.getByRole('button', { name: kind === 'save' ? zh.desktopSettings.meetingAsrSave : kind === 'download' ? zh.knowledge.meetingModelDownloadAria('owned.pt') : zh.knowledge.meetingModelUninstallAria('owned.pt') }));
}
function initialRows(kind: string) { if (kind === 'uninstall') mocks.models.mockResolvedValue([{ ...model, downloaded: true, status: 'downloaded', packageState: 'verified' }]); }
beforeEach(() => { localStorage.clear(); localStorage.setItem('xiaok:locale', 'zh'); mocks.models.mockReset().mockResolvedValue([model]); mocks.asr.mockReset().mockResolvedValue(config); mocks.save.mockReset().mockResolvedValue(config); mocks.download.mockReset().mockResolvedValue({ ok: true, model: { ...model, downloaded: true, status: 'downloaded', packageState: 'verified' } }); mocks.uninstall.mockReset().mockResolvedValue({ ok: true, model }); });
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
it('actual save rejection retains credentials in the draft, reports failure, and does not re-read or retry', async () => {
  mocks.save.mockRejectedValueOnce(Error('meeting_mutation_save_failed')); mount(); await ready();
  fireEvent.change(screen.getByLabelText(apiKeyLabel), { target: { value: 'owned-draft-only-key' } }); action('save');
  await screen.findByText(zh.knowledge.meetingOnlineAsrSaveFailed('meeting_mutation_save_failed'));
  expect(screen.queryByText(zh.desktopSettings.meetingAsrSaved)).toBeNull(); expect(screen.getByLabelText(apiKeyLabel)).toHaveValue('owned-draft-only-key');
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ defaultProvider: 'aliyun-asr', aliyun: { apiKey: 'owned-draft-only-key', baseUrl: 'https://before.invalid', model: 'fun-asr' } });
  expect(mocks.asr).toHaveBeenCalledTimes(1); expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.uninstall).not.toHaveBeenCalled();
});
it.each(['download', 'uninstall'] as const)('actual %s rejection stays independent of successful readonly retry', async kind => {
  initialRows(kind); mocks[kind].mockRejectedValueOnce(Error('meeting_model_busy')); mount(); await ready(); action(kind);
  await screen.findByText(zh.knowledge.meetingModelActionFailed('meeting_model_busy'));
  fireEvent.click(screen.getByRole('button', { name: zh.desktopReadonlyRetry })); await waitFor(() => expect(mocks.models).toHaveBeenCalledTimes(2));
  expect(screen.getByText(zh.knowledge.meetingModelActionFailed('meeting_model_busy'))).toBeInTheDocument(); expect(mocks[kind]).toHaveBeenCalledExactlyOnceWith('owned-model'); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(['save', 'download', 'uninstall'] as const)('late %s rejection after locale change uses current locale without repeating work', async kind => {
  initialRows(kind); const held = deferred<unknown>(); mocks[kind].mockReturnValueOnce(held.promise); mount(); await ready(); action(kind);
  fireEvent.click(screen.getByRole('button', { name: 'test-switch-locale' })); await waitFor(() => expect(mocks.asr).toHaveBeenCalledTimes(2));
  await act(async () => { held.reject(Error(kind === 'save' ? 'meeting_mutation_save_failed' : 'meeting_model_busy')); });
  const reason = kind === 'save' ? 'meeting_mutation_save_failed' : 'meeting_model_busy';
  const expected = kind === 'save' ? en.knowledge.meetingOnlineAsrSaveFailed(reason) : en.knowledge.meetingModelActionFailed(reason);
  const old = kind === 'save' ? zh.knowledge.meetingOnlineAsrSaveFailed(reason) : zh.knowledge.meetingModelActionFailed(reason);
  expect(await screen.findByText(expected)).toBeInTheDocument(); expect(screen.queryByText(old)).toBeNull(); expect(mocks[kind]).toHaveBeenCalledTimes(1);
});
it('existing save failure relocalizes after locale change without retrying the action', async () => {
  mocks.save.mockRejectedValueOnce(Error('meeting_mutation_save_failed')); mount(); await ready(); action('save');
  await screen.findByText(zh.knowledge.meetingOnlineAsrSaveFailed('meeting_mutation_save_failed'));
  fireEvent.click(screen.getByRole('button', { name: 'test-switch-locale' }));
  expect(await screen.findByText(en.knowledge.meetingOnlineAsrSaveFailed('meeting_mutation_save_failed'))).toBeInTheDocument(); expect(mocks.save).toHaveBeenCalledTimes(1);
});
it('confirmed save remains successful when the subsequent real readonly owner fails', async () => {
  const acknowledged = { ...config, aliyun: { ...config.aliyun, baseUrl: 'https://confirmed.invalid' } };
  mocks.save.mockResolvedValueOnce(acknowledged); mocks.asr.mockResolvedValueOnce(config).mockRejectedValueOnce(Error('owned-private-read-marker'));
  mount(); await ready(); fireEvent.change(screen.getByLabelText(apiKeyLabel), { target: { value: 'owned-draft-only-key' } }); action('save');
  expect(await screen.findByText(zh.desktopSettings.meetingAsrSaved)).toBeInTheDocument(); expect(screen.getByText(zh.meetingAsrReadonlyUnavailable)).toBeInTheDocument();
  expect(screen.getByLabelText(apiKeyLabel)).toHaveValue(''); expect(screen.getByDisplayValue('https://confirmed.invalid')).toBeInTheDocument();
  expect(screen.queryByText(/owned-private-read-marker/)).toBeNull(); expect(screen.queryByText(/meeting_mutation_save_failed/)).toBeNull(); expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.asr).toHaveBeenCalledTimes(2);
});
it('save failure is retained when a later readonly retry fails, without clearing last-good facts', async () => {
  mocks.save.mockRejectedValueOnce(Error('meeting_mutation_save_failed')); mount(); await ready(); action('save'); await screen.findByText(zh.knowledge.meetingOnlineAsrSaveFailed('meeting_mutation_save_failed'));
  mocks.asr.mockRejectedValueOnce(Error('owned-private-read-marker')); fireEvent.click(screen.getByRole('button', { name: zh.desktopReadonlyRetry }));
  await screen.findByText(zh.meetingAsrReadonlyUnavailable); expect(screen.getByDisplayValue('https://before.invalid')).toBeInTheDocument(); expect(screen.getByText(zh.knowledge.meetingOnlineAsrSaveFailed('meeting_mutation_save_failed'))).toBeInTheDocument(); expect(mocks.save).toHaveBeenCalledTimes(1);
});
it.each(['save', 'download', 'uninstall'] as const)('unmounted %s success cannot schedule successor reads or overwrite a fresh VoicePane', async kind => {
  initialRows(kind); const held = deferred<unknown>(); mocks[kind].mockReturnValueOnce(held.promise); const old = mount(); await ready(); action(kind); old.unmount();
  const fresh = { ...config, aliyun: { ...config.aliyun, baseUrl: 'https://fresh.invalid' } }; mocks.asr.mockResolvedValue(fresh);
  mount(); await screen.findByDisplayValue('https://fresh.invalid'); const modelsBefore = mocks.models.mock.calls.length, asrBefore = mocks.asr.mock.calls.length;
  await act(async () => { held.resolve(kind === 'save' ? { ...config, aliyun: { ...config.aliyun, baseUrl: 'https://stale.invalid' } } : { ok: true, model }); });
  expect(mocks.models).toHaveBeenCalledTimes(modelsBefore); expect(mocks.asr).toHaveBeenCalledTimes(asrBefore); expect(screen.getByDisplayValue('https://fresh.invalid')).toBeInTheDocument(); expect(screen.queryByDisplayValue('https://stale.invalid')).toBeNull(); expect(screen.queryByText(en.desktopSettings.meetingAsrSaved)).toBeNull(); expect(screen.queryByText(zh.desktopSettings.meetingAsrSaved)).toBeNull(); expect(mocks[kind]).toHaveBeenCalledTimes(1);
});
it.each(['save', 'download', 'uninstall'] as const)('unmounted %s rejection stays out of the fresh screen', async kind => {
  initialRows(kind); const held = deferred<unknown>(); mocks[kind].mockReturnValueOnce(held.promise); const old = mount(); await ready(); action(kind); old.unmount(); mount(); await ready();
  await act(async () => { held.reject(Error('owned-retired-action-marker')); }); expect(screen.queryByText(/owned-retired-action-marker/)).toBeNull(); expect(mocks[kind]).toHaveBeenCalledTimes(1);
});
it('save admits one action when two clicks occur before React publishes busy state', async () => {
  const held = deferred<unknown>(); mocks.save.mockReturnValueOnce(held.promise); mount(); await ready();
  const button = screen.getByRole('button', { name: zh.desktopSettings.meetingAsrSave });
  act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const callsBeforeReply = mocks.save.mock.calls.length;
  await act(async () => { held.resolve(config); });
  expect(callsBeforeReply).toBe(1); expect(mocks.save).toHaveBeenCalledTimes(1);
});
it.each(['download', 'uninstall'] as const)('model action %s blocks a different model action in the same JS turn', async kind => {
  const first = kind === 'download' ? model : { ...model, downloaded: true, status: 'downloaded', packageState: 'verified' };
  const other = { ...model, id: 'owned-other', fileName: 'other.pt', path: '/owned/other.pt', downloaded: kind === 'download', status: kind === 'download' ? 'downloaded' : 'not_downloaded', packageState: kind === 'download' ? 'verified' : 'missing' };
  mocks.models.mockResolvedValue([first, other]); const held = deferred<unknown>(); mocks[kind].mockReturnValueOnce(held.promise); mount(); await ready();
  const start = screen.getByRole('button', { name: kind === 'download' ? zh.knowledge.meetingModelDownloadAria('owned.pt') : zh.knowledge.meetingModelUninstallAria('owned.pt') });
  const competing = screen.getByRole('button', { name: kind === 'download' ? zh.knowledge.meetingModelUninstallAria('other.pt') : zh.knowledge.meetingModelDownloadAria('other.pt') });
  act(() => { start.dispatchEvent(new MouseEvent('click', { bubbles: true })); competing.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const firstCalls = mocks[kind].mock.calls.length, competingCalls = mocks[kind === 'download' ? 'uninstall' : 'download'].mock.calls.length;
  await act(async () => { held.resolve({ ok: true, model: first }); });
  expect(firstCalls).toBe(1); expect(competingCalls).toBe(0); expect(mocks[kind]).toHaveBeenCalledExactlyOnceWith('owned-model');
});
