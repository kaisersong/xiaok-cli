import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  listPluginMcpServers: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    listMCPInstalls: vi.fn().mockResolvedValue([]),
    listPluginMcpServers: mocks.listPluginMcpServers,
    createMCPInstall: vi.fn(),
    deleteMCPInstall: vi.fn(),
  },
}));

describe('DesktopSettings MCP pane', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__APP_VERSION__ = 'test-version';
    (globalThis as Record<string, unknown>).__APP_BUILD__ = 'test-build';
    mocks.listPluginMcpServers.mockReset();
    mocks.listPluginMcpServers
      .mockResolvedValueOnce([
        { name: 'report-renderer', pluginName: 'kai-report-creator', toolCount: 1, connected: true, enabled: true },
      ])
      .mockResolvedValue([
        { name: 'report-renderer', pluginName: 'kai-report-creator', toolCount: 1, connected: true, enabled: true },
        { name: 'slide-renderer', pluginName: 'kai-slide-creator', toolCount: 1, connected: true, enabled: true },
      ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__APP_VERSION__;
    delete (globalThis as Record<string, unknown>).__APP_BUILD__;
  });

  it('refreshes plugin MCP servers so late startup registrations become visible', async () => {
    render(
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>,
    );

    await screen.findByRole('button', { name: 'MCP 服务器' });
    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务器' }));

    await screen.findByText('插件 MCP 服务');
    expect(screen.getByText('report-renderer')).toBeInTheDocument();
    expect(screen.queryByText('slide-renderer')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('slide-renderer')).toBeInTheDocument();
    }, { timeout: 5_000 });
  });
});
