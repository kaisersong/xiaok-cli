import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  getServiceStatus: vi.fn(),
  restartRelatedService: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getServiceStatus: mocks.getServiceStatus,
    restartRelatedService: mocks.restartRelatedService,
  },
}));

describe('DesktopSettings service status', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.getServiceStatus.mockReset();
    mocks.restartRelatedService.mockReset();
    mocks.getServiceStatus.mockResolvedValue({
      checkedAt: 1779545079000,
      services: [
        {
          id: 'kswarm',
          label: 'KSwarm',
          running: true,
          reachable: true,
          port: 4400,
          pid: 123,
          restartCount: 0,
          lastError: null,
          detail: 'broker connected',
        },
        {
          id: 'intent-broker',
          label: 'Intent Broker',
          running: false,
          reachable: false,
          port: 4318,
          pid: null,
          restartCount: 0,
          lastError: 'connection refused',
          detail: 'broker offline',
        },
        {
          id: 'runtime-bridge',
          label: 'Runtime Bridge',
          running: true,
          reachable: true,
          port: 0,
          pid: null,
          restartCount: 0,
          lastError: null,
          detail: '2 client(s) registered',
        },
      ],
    });
    mocks.restartRelatedService.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  it('shows related service health and can restart a service from general settings', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    await screen.findByText('服务状态');
    expect(screen.getByText('KSwarm')).toBeInTheDocument();
    expect(screen.getByText('Intent Broker')).toBeInTheDocument();
    expect(screen.getByText('Runtime Bridge')).toBeInTheDocument();
    expect(screen.getAllByText('运行中').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('不可用')).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('restart-service-intent-broker'));

    await waitFor(() => {
      expect(mocks.restartRelatedService).toHaveBeenCalledWith('intent-broker');
    });
    await waitFor(() => {
      expect(mocks.getServiceStatus).toHaveBeenCalledTimes(2);
    });
  });
});
