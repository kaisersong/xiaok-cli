// Candidate only. Copy to desktop/tests/renderer/skills-settings-action-controls.test.tsx.
// Real SkillsSettingsContent + real installSkill adapter + real api.installSkill.
// Only unavailable marketplace/default-list boundaries and the preload port are fixtures.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SkillsSettingsContent } from '../../renderer/src/components/SkillsSettingsContent';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
import { locales } from '../../renderer/src/locales';
import type { MarketSkill, SkillPackageResponse } from '../../renderer/src/api/bridge';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';
const seams = vi.hoisted(() => ({ search: vi.fn(), imported: vi.fn(), defaults: vi.fn(), replace: vi.fn(), discover: vi.fn() }));
vi.mock('../../renderer/src/api/bridge', async load => {
  const actual = await load<typeof import('../../renderer/src/api/bridge')>();
  return { ...actual, searchMarketSkills: seams.search, importRegistrySkill: seams.imported,
    listDefaultSkills: seams.defaults, replaceDefaultSkills: seams.replace, discoverExternalSkills: seams.discover };
});
const skill: SkillPackageResponse = { skill_key: 'owned-skill', display_name: 'Owned skill', version: '1.0', source: 'official', is_platform: false, scan_status: 'clean' };
const market: MarketSkill = { skill_key: skill.skill_key, display_name: skill.display_name, version: skill.version, registry_slug: skill.skill_key, installed: false, enabled_by_default: false, scan_status: 'clean' };
const original = window.xiaokDesktop;
let port: { listSkills: ReturnType<typeof vi.fn>; getSkillStats: ReturnType<typeof vi.fn>; installSkill: ReturnType<typeof vi.fn>; uninstallSkill: ReturnType<typeof vi.fn>; onSkillsChanged: ReturnType<typeof vi.fn> };
function LocaleButton() { const { setLocale } = useLocale(); return <button onClick={() => setLocale('en')}>test-current-locale</button>; }
function mount() { return render(<MemoryRouter><LocaleProvider><LocaleButton /><SkillsSettingsContent accessToken="owned" /></LocaleProvider></MemoryRouter>); }
async function openMarketplace(locale: 'zh' | 'en' = 'zh') {
  fireEvent.click(screen.getByRole('tab', { name: locales[locale].skills.marketplaceTab }));
  await screen.findByRole('button', { name: 'Owned skill' });
  return screen.getByRole('switch', { name: locales[locale].skills.enabledByDefault + ': Owned skill' });
}
async function beginInstall(locale: 'zh' | 'en' = 'zh') {
  const toggle = await openMarketplace(locale); fireEvent.click(toggle);
  await waitFor(() => expect(port.installSkill).toHaveBeenCalledExactlyOnceWith('owned-skill'));
  return toggle;
}
function held<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  localStorage.setItem('xiaok:locale', 'zh'); _resetDesktopApiCache();
  seams.search.mockReset().mockResolvedValue([market]); seams.imported.mockReset().mockResolvedValue(skill); seams.defaults.mockReset().mockResolvedValue([]); seams.replace.mockReset().mockResolvedValue([]); seams.discover.mockReset().mockResolvedValue({ dirs: [] });
  port = { listSkills: vi.fn().mockResolvedValue([]), getSkillStats: vi.fn().mockResolvedValue([]), installSkill: vi.fn().mockResolvedValue({ success: true, message: 'owned_ok' }), uninstallSkill: vi.fn(), onSkillsChanged: vi.fn(() => () => {}) };
  window.xiaokDesktop = { ...original, ...port } as typeof window.xiaokDesktop;
});
afterEach(() => { cleanup(); window.xiaokDesktop = original; _resetDesktopApiCache(); localStorage.removeItem('xiaok:locale'); vi.restoreAllMocks(); });
it.each(['zh', 'en'] as const)('actual page %s installation business false does not enable defaults and shows localized action failure', async locale => {
  localStorage.setItem('xiaok:locale', locale); port.installSkill.mockResolvedValue({ success: false, message: 'private_owned_process_failure' }); mount(); await beginInstall(locale);
  expect(await screen.findByText(locales[locale].skills.importFailed)).toBeInTheDocument();
  expect(screen.queryByText('private_owned_process_failure')).toBeNull(); expect(seams.replace).not.toHaveBeenCalled(); expect(port.uninstallSkill).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: locales[locale].skills.enabledByDefault + ': Owned skill' })).not.toBeChecked();
});
it.each(['zh', 'en'] as const)('actual page %s transport rejection is localized and never mutates defaults', async locale => {
  localStorage.setItem('xiaok:locale', locale); port.installSkill.mockRejectedValue(Error('private_owned_transport_failure')); mount(); await beginInstall(locale);
  expect(await screen.findByText(locales[locale].skills.importFailed)).toBeInTheDocument(); expect(screen.queryByText('private_owned_transport_failure')).toBeNull(); expect(seams.replace).not.toHaveBeenCalled();
});
it('success preserves the exact slug/version and performs the existing default enable and catalog refresh once', async () => {
  mount(); await beginInstall(); await waitFor(() => expect(seams.replace).toHaveBeenCalledExactlyOnceWith('owned', [{ skill_key: 'owned-skill', version: '1.0' }]));
  await waitFor(() => expect(port.listSkills).toHaveBeenCalledTimes(2)); expect(seams.imported).toHaveBeenCalledTimes(1); expect(port.uninstallSkill).not.toHaveBeenCalled();
});
it.each(['business-false', 'reject'] as const)('held %s settles with current locale error and no default write', async failure => {
  const request = held<{ success: boolean; message: string }>(); port.installSkill.mockReturnValue(request.promise); mount(); const toggle = await beginInstall();
  expect(toggle).toBeDisabled(); expect(seams.replace).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'test-current-locale' }));
  await act(async () => { if (failure === 'reject') request.reject(Error('private_held_failure')); else request.resolve({ success: false, message: 'private_held_failure' }); });
  expect(await screen.findByText(locales.en.skills.importFailed)).toBeInTheDocument(); expect(screen.queryByText(locales.zh.skills.importFailed)).toBeNull(); expect(seams.replace).not.toHaveBeenCalled(); expect(port.installSkill).toHaveBeenCalledTimes(1);
});
it('an already visible action error follows a locale switch without another mutation or losing facts', async () => {
  port.installSkill.mockRejectedValue(Error('private_owned_failure')); mount(); await beginInstall(); await screen.findByText(locales.zh.skills.importFailed);
  fireEvent.click(screen.getByRole('button', { name: 'test-current-locale' })); expect(await screen.findByText(locales.en.skills.importFailed)).toBeInTheDocument();
  expect(screen.queryByText(locales.zh.skills.importFailed)).toBeNull(); expect(screen.getByRole('button', { name: 'Owned skill' })).toBeInTheDocument(); expect(port.installSkill).toHaveBeenCalledTimes(1); expect(seams.replace).not.toHaveBeenCalled();
});
it('a held success remains authorized across locale change and is not replayed', async () => {
  const request = held<{ success: boolean; message: string }>(); port.installSkill.mockReturnValue(request.promise); mount(); await beginInstall(); fireEvent.click(screen.getByRole('button', { name: 'test-current-locale' }));
  await act(async () => request.resolve({ success: true, message: 'owned_ok' })); await waitFor(() => expect(seams.replace).toHaveBeenCalledExactlyOnceWith('owned', [{ skill_key: 'owned-skill', version: '1.0' }]));
  expect(port.installSkill).toHaveBeenCalledTimes(1); expect(seams.imported).toHaveBeenCalledTimes(1); expect(screen.queryByText(locales.en.skills.importFailed)).toBeNull();
});
it('busy switch duplicate clicks cannot dispatch a second held installation', async () => {
  const request = held<{ success: boolean; message: string }>(); port.installSkill.mockReturnValue(request.promise); const view = mount(); const toggle = await beginInstall();
  fireEvent.click(toggle); fireEvent.click(toggle); expect(port.installSkill).toHaveBeenCalledTimes(1); expect(seams.imported).toHaveBeenCalledTimes(1); expect(seams.replace).not.toHaveBeenCalled();
  try { await act(async () => request.resolve({ success: false, message: 'owned_failure' })); await screen.findByText(locales.zh.skills.importFailed); } finally { view.unmount(); }
  expect(seams.replace).not.toHaveBeenCalled();
});
it.each(['success', 'business-false', 'reject'] as const)('unmounted held %s cannot enable defaults or refresh a successor component', async outcome => {
  const request = held<{ success: boolean; message: string }>(); port.installSkill.mockReturnValue(request.promise); const old = mount(); await beginInstall(); old.unmount();
  const fresh = mount(); await openMarketplace(); const reads = port.listSkills.mock.calls.length, defaults = seams.defaults.mock.calls.length;
  try {
    await act(async () => { if (outcome === 'reject') request.reject(Error('private_unmounted_failure')); else request.resolve({ success: outcome === 'success', message: 'private_unmounted_receipt' }); });
    expect(seams.replace).not.toHaveBeenCalled(); expect(port.listSkills).toHaveBeenCalledTimes(reads); expect(seams.defaults).toHaveBeenCalledTimes(defaults);
    expect(screen.queryByText(locales.zh.skills.importFailed)).toBeNull(); expect(screen.queryByText('private_unmounted_receipt')).toBeNull(); expect(port.installSkill).toHaveBeenCalledTimes(1);
  } finally { fresh.unmount(); }
});
