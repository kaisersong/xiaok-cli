import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../../renderer/src/locales/en';
import { HarnessOptimizationSettingsStatus } from '../../renderer/src/components/settings/HarnessOptimizationSettingsStatus';
const { getApi } = vi.hoisted(() => ({ getApi: vi.fn() }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: getApi }));
vi.mock('../../renderer/src/contexts/LocaleContext', () => ({ useLocale: () => ({ t: en }) }));
describe('D0 settings eligibility', () => {
  it('uses the main unavailable fact and provides no enable control', async () => {
    getApi.mockReturnValue({ getHarnessOptimizationConfig: async () => ({ publicStatus: 'unavailable' }) });
    render(<HarnessOptimizationSettingsStatus />);
    expect(await screen.findByText(en.desktopSettings.harnessOptimizationUnavailable)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('shows a local read error without rendering arbitrary backend error text', async () => {
    getApi.mockReturnValue({ getHarnessOptimizationConfig: async () => { throw Error('secret backend details'); } });
    render(<HarnessOptimizationSettingsStatus />);
    expect(await screen.findByText(en.desktopSettings.harnessOptimizationReadError)).toBeTruthy();
    expect(screen.queryByText('secret backend details')).toBeNull();
  });
});
