import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginsSettings } from '../../renderer/src/components/settings/PluginsSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const reads = { servers: vi.fn(), available: vi.fn(), install: vi.fn() };
beforeEach(() => { reads.servers.mockReset().mockRejectedValue(Error('plugin_catalog_projection_unavailable')); reads.available.mockReset().mockResolvedValue([]); reads.install.mockReset(); window.xiaokDesktop = { listPluginMcpServers: reads.servers, listAvailablePlugins: reads.available, installPlugin: reads.install } as never; });
afterEach(cleanup);
it('shows localized catalog failure and recovers by explicit reread without installing', async () => {
  render(<LocaleProvider><PluginsSettings /></LocaleProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('插件目录暂时不可用');
  reads.servers.mockResolvedValue([{ name: 'owned-server', pluginName: 'owned', toolCount: 2, connected: true, enabled: true }]);
  fireEvent.click(screen.getByRole('button', { name: '重新读取插件目录' }));
  expect(await screen.findByText('owned-server')).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull(); expect(reads.install).not.toHaveBeenCalled();
});
it('queues one explicit reread after a held read settles without starting parallel catalog reads', async () => {
  render(<LocaleProvider><PluginsSettings /></LocaleProvider>);
  await screen.findByRole('alert');
  let release!: (value: unknown[]) => void; let held = true;
  reads.servers.mockReturnValueOnce(new Promise(resolve => { release = value => { held = false; resolve(value); }; })).mockImplementation(async () => {
    expect(held).toBe(false); return [{ name: 'owned-new-result', pluginName: 'owned', toolCount: 2, connected: true, enabled: true }];
  });
  fireEvent.click(screen.getByRole('button', { name: '重新读取插件目录' }));
  fireEvent.click(screen.getByRole('button', { name: '重新读取插件目录' }));
  expect(reads.servers).toHaveBeenCalledTimes(2);
  release([{ name: 'owned-held-result', pluginName: 'owned', toolCount: 1, connected: true, enabled: true }]);
  expect(await screen.findByText('owned-new-result')).toBeInTheDocument(); expect(reads.servers).toHaveBeenCalledTimes(3);
});
