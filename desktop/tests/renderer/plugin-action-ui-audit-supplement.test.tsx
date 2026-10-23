import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
import { locales } from '../../renderer/src/locales';
const api = vi.hoisted(() => ({ getSkillDebugConfig: vi.fn(), getKswarmConfig: vi.fn(), listMCPInstalls: vi.fn(), listPluginMcpServers: vi.fn(), listPluginDependencyStatuses: vi.fn(), installPlugin: vi.fn(), installPluginDependency: vi.fn(), updatePluginDependency: vi.fn(), diagnosePluginDependency: vi.fn(), cancelPluginDependencyTask: vi.fn(), retryPluginComponent: vi.fn(), openPluginDependencyPermissionSettings: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', async load => ({ ...await load<typeof import('../../renderer/src/api/bridge')>(), api }));
const dependency = { pluginName: 'owned-plugin', dependencyId: 'owned-dep', displayName: 'Owned dependency', pluginInstalled: false, state: 'missing', code: 'binary_missing', canInstall: true, canUpdate: false, canDiagnose: false };
function LocaleButton() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>test-current-locale</button>; }
function held<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function open() {
  const view = render(<MemoryRouter><LocaleProvider><LocaleButton /><DesktopSettings onClose={() => {}} /></LocaleProvider></MemoryRouter>);
  await act(async () => {}); fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' })); await act(async () => {}); expect(screen.getByText('Owned dependency')).toBeInTheDocument(); return view;
}
beforeEach(() => { localStorage.setItem('xiaok:locale', 'zh'); for (const method of Object.values(api)) method.mockReset(); api.getSkillDebugConfig.mockResolvedValue({ enabled: false }); api.getKswarmConfig.mockResolvedValue({ maxConcurrentTasks: 3 }); api.listMCPInstalls.mockResolvedValue([]); api.listPluginMcpServers.mockResolvedValue([]); api.listPluginDependencyStatuses.mockResolvedValue([dependency]); api.installPlugin.mockResolvedValue({ success: true }); api.installPluginDependency.mockResolvedValue({ success: true }); api.updatePluginDependency.mockResolvedValue({ success: true }); api.diagnosePluginDependency.mockResolvedValue({ success: true }); api.cancelPluginDependencyTask.mockResolvedValue({ cancelling: true }); api.retryPluginComponent.mockResolvedValue([]); api.openPluginDependencyPermissionSettings.mockResolvedValue(undefined); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); localStorage.removeItem('xiaok:locale'); vi.restoreAllMocks(); });

// Missing combinations only. The original23 remain unchanged and are not redefined here.
it('setup waits for plugin settlement before issuing the original confirmed dependency and waits for dependency before refresh', async () => {
  const plugin = held<{ success: boolean }>(), dependent = held<{ success: boolean }>(); api.installPlugin.mockReturnValue(plugin.promise); api.installPluginDependency.mockReturnValue(dependent.promise); await open();
  fireEvent.click(screen.getByRole('button', { name: locales.zh.desktopSettings.mcpInstallAndEnable })); expect(api.installPlugin).toHaveBeenCalledExactlyOnceWith('owned-plugin'); expect(api.installPluginDependency).not.toHaveBeenCalled(); const reads = api.listPluginDependencyStatuses.mock.calls.length;
  try { await act(async () => plugin.resolve({ success: true })); expect(api.installPluginDependency).toHaveBeenCalledExactlyOnceWith({ pluginName: 'owned-plugin', dependencyId: 'owned-dep', confirmed: true }); expect(api.listPluginDependencyStatuses).toHaveBeenCalledTimes(reads); }
  finally { await act(async () => { plugin.resolve({ success: true }); dependent.resolve({ success: true }); }); }
  expect(api.listPluginDependencyStatuses).toHaveBeenCalledTimes(reads + 1);
});
const missing = [
  ...(['locale', 'unmount'] as const).flatMap(mode => (['success', 'reject'] as const).flatMap(outcome => ['setup-dependent', 'standalone'].map(scope => ({ scope, mode, outcome })))),
  ...['update', 'diagnose', 'cancel'].flatMap(scope => [{ scope, mode: 'locale' as const, outcome: 'reject' as const }, { scope, mode: 'locale' as const, outcome: 'success' as const }, { scope, mode: 'unmount' as const, outcome: 'success' as const }]),
  ...(['locale', 'unmount'] as const).map(mode => ({ scope: 'retry', mode, outcome: 'success' as const })),
  { scope: 'permission', mode: 'unmount' as const, outcome: 'reject' as const }, { scope: 'permission', mode: 'unmount' as const, outcome: 'success' as const }, { scope: 'permission', mode: 'locale' as const, outcome: 'success' as const },
];
for (const c of missing) it(c.scope + ' missing held ' + c.outcome + ' after ' + c.mode + ' cannot publish stale alert or refresh', async () => {
  const request = held<unknown>(); let label: string; let produce: ReturnType<typeof vi.fn>;
  if (c.scope === 'setup-dependent') { produce = api.installPluginDependency; label = locales.zh.desktopSettings.mcpInstallAndEnable; }
  else if (c.scope === 'standalone') { produce = api.installPluginDependency; label = locales.zh.desktopSettings.mcpInstallDriver; api.listPluginDependencyStatuses.mockResolvedValue([{ ...dependency, pluginInstalled: true }]); }
  else if (c.scope === 'update' || c.scope === 'diagnose' || c.scope === 'cancel') { produce = c.scope === 'update' ? api.updatePluginDependency : c.scope === 'diagnose' ? api.diagnosePluginDependency : api.cancelPluginDependencyTask; label = c.scope === 'update' ? locales.zh.desktopSettings.mcpUpdate : c.scope === 'diagnose' ? locales.zh.desktopSettings.mcpDiagnose : locales.zh.desktopSettings.mcpCancelTask; api.listPluginDependencyStatuses.mockResolvedValue([{ ...dependency, pluginInstalled: true, state: 'ready', code: 'ready', canInstall: false, canUpdate: true, canDiagnose: true, task: { taskId: 'owned', dependencyId: 'owned-plugin:owned-dep', state: 'running' } }]); }
  else if (c.scope === 'retry') { produce = api.retryPluginComponent; label = locales.zh.desktopSettings.mcpReconnectMcp; api.listPluginMcpServers.mockResolvedValue([{ name: 'owned-component', pluginName: 'owned-plugin', toolCount: 0, connected: false, enabled: true }]); api.listPluginDependencyStatuses.mockResolvedValue([{ ...dependency, pluginInstalled: true, state: 'ready', code: 'ready', canInstall: false }]); }
  else { produce = api.openPluginDependencyPermissionSettings; label = locales.zh.desktopSettings.mcpOpenAccessibility; api.listPluginDependencyStatuses.mockResolvedValue([{ ...dependency, pluginInstalled: true, state: 'needs_permission', code: 'permission_accessibility_missing', canInstall: false }]); }
  produce.mockReturnValue(request.promise); const view = await open(); await act(async () => fireEvent.click(screen.getByRole('button', { name: label }))); expect(produce).toHaveBeenCalledTimes(1);
  if (c.mode === 'locale') { fireEvent.click(screen.getByRole('button', { name: 'test-current-locale' })); await act(async () => {}); } else view.unmount(); const reads = api.listPluginDependencyStatuses.mock.calls.length;
  try { await act(async () => { if (c.outcome === 'reject') request.reject(Error('PRIVATE_LATE_MARKER')); else request.resolve(c.scope === 'permission' ? undefined : c.scope === 'retry' ? [] : c.scope === 'cancel' ? { cancelling: true } : { success: true }); }); expect(window.alert).not.toHaveBeenCalled(); expect(api.listPluginDependencyStatuses).toHaveBeenCalledTimes(reads); }
  finally { view.unmount(); request.resolve(c.scope === 'permission' ? undefined : c.scope === 'retry' ? [] : { success: true }); }
});
