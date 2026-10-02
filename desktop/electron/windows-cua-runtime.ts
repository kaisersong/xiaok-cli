import { win32 } from 'node:path';
import type { ExternalPluginDependency } from './plugin-dependency-service.js';
import type { McpToolSchema } from '../../src/ai/mcp/client.js';
import type { McpRuntimeToolResult } from '../../src/ai/mcp/runtime/client.js';
import { verifyBackendAbi, type BackendOperationSchema } from '../../src/platform/computer-use/cua-action-contract.js';
import { WINDOWS_CUA_ABI_PROFILE } from '../../src/platform/computer-use/windows-cua-profile.js';
import { WindowsCuaObservationStore } from '../../src/platform/computer-use/windows-cua-observation.js';
import { WINDOWS_CUA_RELEASE } from './cua-release-install.js';

export function createWindowsCuaDependency(localAppData: string, privateBinary?: string | null): ExternalPluginDependency {
  const binaryCandidates = [
    ...(privateBinary ? [privateBinary] : []),
    win32.join(localAppData, 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe'), 'cua-driver.exe',
  ];
  return {
    id: 'cua-driver', kind: 'native_cli', supportedPlatforms: ['win32'], displayName: 'CUA Driver',
    envOverride: 'XIAOK_CUA_DRIVER_CMD', binaryCandidates, exactVersion: WINDOWS_CUA_RELEASE.version,
    install: { kind: 'official_release_archive', requiresUserConfirmation: true },
    update: { kind: 'official_release_archive', requiresUserConfirmation: true },
    health: { version: [binaryCandidates[0], '--version'] },
    mcp: { serverName: 'cua-driver', command: binaryCandidates[0], args: ['mcp', '--direct'], requiresUserActivation: true },
  };
}

/** Initial activation and each replacement must pass the same frozen contract. */
export async function verifyWindowsCuaReadiness(input: {
  identity?: { name: string; version: string };
  schemas: McpToolSchema[];
  callToolResult(name: string, args: Record<string, unknown>): Promise<McpRuntimeToolResult>;
  /** Only main may supply its own window; never select the first business app. */
  target?: { pid: number; window_id: number } | null;
}): Promise<{ observed: boolean }> {
  if (input.identity?.name !== 'cua-driver' || input.identity.version !== WINDOWS_CUA_RELEASE.version) throw new Error('COMPUTER_USE_WINDOWS_IDENTITY_MISMATCH');
  const operations = input.schemas.map(schema => {
    const required = schema.inputSchema.required ?? [];
    const properties = schema.inputSchema.properties;
    if (!Array.isArray(required) || !required.every(field => typeof field === 'string')
      || !properties || typeof properties !== 'object' || Array.isArray(properties)
      || !Object.values(properties).every(value => value && typeof value === 'object' && !Array.isArray(value))) throw new Error('COMPUTER_USE_WINDOWS_ABI_MISMATCH');
    return { name: schema.name, required, properties } as BackendOperationSchema;
  });
  if (!verifyBackendAbi(operations, WINDOWS_CUA_ABI_PROFILE).ok) throw new Error('COMPUTER_USE_WINDOWS_ABI_MISMATCH');
  const windows = await input.callToolResult('list_windows', { on_screen_only: true });
  const structured = windows.structuredContent as { windows?: unknown } | undefined;
  if (windows.isError || !Array.isArray(structured?.windows)) throw new Error('COMPUTER_USE_WINDOWS_OBSERVATION_INVALID');
  const target = input.target;
  if (!target || !structured.windows.some(value => value && typeof value === 'object'
    && (value as Record<string, unknown>).pid === target.pid && (value as Record<string, unknown>).window_id === target.window_id)) return { observed: false };
  const args = { ...target, include_screenshot: true };
  const capture = await input.callToolResult('get_window_state', args);
  new WindowsCuaObservationStore().record(args, capture);
  return { observed: true };
}
