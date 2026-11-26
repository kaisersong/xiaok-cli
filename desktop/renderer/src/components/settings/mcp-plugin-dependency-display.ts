import type { PluginDependencyStatusDto } from '../../../../shared/plugin-catalog-ipc-contract';
import type { LocaleStrings } from '../../locales/index';

export type PluginDependencyStatus = PluginDependencyStatusDto;

export function formatPluginDependencyTitle(dependency: PluginDependencyStatus): string {
  if (dependency.pluginName === 'cua-computer-use') return 'Computer Use for Mac';
  return dependency.pluginName;
}

export function formatPluginDependencyStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (dependency.code === 'binary_missing') return ts.mcpDepNeedsInstall(dependency.displayName);
  if (dependency.code === 'permission_accessibility_missing') return ts.mcpDepNeedsAccessibility;
  if (dependency.code === 'permission_screen_missing') return ts.mcpDepNeedsScreenRecording;
  if (dependency.code === 'version_too_old') return ts.mcpDepNeedsUpdate;
  if (dependency.pluginName === 'cua-computer-use' && dependency.state === 'ready' && server?.connected === false) return ts.mcpDepNotEnabled;
  if (dependency.state === 'ready') return ts.mcpDepAvailable;
  if (dependency.state === 'unsupported') return ts.mcpDepUnsupported;
  return ts.mcpDepNeedsAttention;
}

export function formatPluginDependencyLayerRows(
  dependency: PluginDependencyStatus,
  pluginInstalled: boolean,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): Array<{ label: string; value: string }> {
  return [
    { label: ts.mcpLayerPlugin, value: pluginInstalled ? ts.mcpLayerInstalled : ts.mcpLayerNotInstalled },
    { label: dependency.displayName, value: formatDriverLayerStatus(dependency, ts) },
    { label: ts.mcpLayerPermission, value: formatPermissionLayerStatus(dependency, server, ts) },
    { label: dependency.pluginName === 'cua-computer-use' ? ts.mcpLayerServiceConn : 'MCP', value: formatMcpLayerStatus(dependency, server, ts) },
    { label: ts.mcpLayerTools, value: formatToolLayerStatus(dependency, server, ts) },
  ];
}

function formatDriverLayerStatus(dependency: PluginDependencyStatus, ts: LocaleStrings['desktopSettings']): string {
  if (dependency.state === 'unsupported') return ts.mcpDriverUnsupported;
  if (dependency.code === 'binary_missing') return ts.mcpDriverNotInstalled;
  if (dependency.code === 'version_too_old') return dependency.version ? `${dependency.version}，${ts.mcpDriverNeedsUpdate}` : ts.mcpDriverNeedsUpdate;
  if (dependency.state === 'ready') return dependency.version || ts.mcpLayerInstalled;
  if (dependency.resolvedBinary) return ts.mcpDriverInstalledUnavailable;
  return ts.mcpDriverUnconfirmed;
}

function formatPermissionLayerStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (dependency.code === 'permission_accessibility_missing') return ts.mcpPermAccessibilityMissing;
  if (dependency.code === 'permission_screen_missing') return ts.mcpPermScreenMissing;
  if (dependency.pluginName === 'cua-computer-use' && dependency.state === 'ready' && server?.connected === false) return ts.mcpPermVerifyAfterEnable;
  if (dependency.state === 'ready') return ts.mcpPermGranted;
  if (dependency.state === 'missing' || dependency.state === 'unsupported') return ts.mcpPermNotChecked;
  return ts.mcpPermUnconfirmed;
}

function formatMcpLayerStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (!dependency.pluginInstalled && dependency.state === 'missing') return ts.mcpLayerNotInstalled;
  if (!server) return ts.mcpLayerNotRegistered;
  return server.connected ? ts.mcpConnected : ts.mcpDisconnected;
}

function formatToolLayerStatus(
  dependency: PluginDependencyStatus,
  server: { connected: boolean; toolCount: number } | undefined,
  ts: LocaleStrings['desktopSettings'],
): string {
  if (dependency.state !== 'ready') return ts.mcpToolUnavailable;
  if (!server) return ts.mcpToolWaitRegister;
  if (!server.connected) return dependency.pluginName === 'cua-computer-use' ? ts.mcpToolWaitEnable : ts.mcpToolMcpDisconnected;
  if (dependency.pluginName === 'cua-computer-use' && server.toolCount === 1) return ts.mcpToolWrapperRegistered;
  if (dependency.pluginName === 'cua-computer-use') return ts.mcpToolRawNotHidden;
  return `${server.toolCount} tools`;
}

export function pluginDependencyBadgeClass(state: PluginDependencyStatus['state']): string {
  if (state === 'ready') return 'bg-green-100 text-green-700';
  if (state === 'missing' || state === 'needs_permission') return 'bg-yellow-100 text-yellow-700';
  if (state === 'unsupported') return 'bg-gray-100 text-gray-600';
  return 'bg-red-100 text-red-700';
}
