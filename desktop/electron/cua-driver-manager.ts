import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import type { McpToolSchema } from '../../src/ai/mcp/client.js';
import type { McpRuntimeToolImage, McpRuntimeToolResult } from '../../src/ai/mcp/runtime/client.js';

const CUA_REQUIRED_TOOLS = ['list_windows', 'get_window_state'];
const CUA_OBSERVATION_TOOL_PRIORITY = ['list_windows'];
const DEFAULT_CUA_DRIVER_APP_PATH = '/Applications/CuaDriver.app';

export type CuaMcpReadinessCode =
  | 'ready'
  | 'mcp_observation_tool_missing'
  | 'mcp_observation_smoke_failed'
  | 'mcp_content_unsupported';

export interface CuaMcpReadinessReady {
  ready: true;
  observationTool: string;
  contentTypes: string[];
}

export interface CuaMcpReadinessFailure {
  ready: false;
  code: Exclude<CuaMcpReadinessCode, 'ready'>;
  observationTool?: string;
  detail?: string;
}

export type CuaMcpReadinessResult = CuaMcpReadinessReady | CuaMcpReadinessFailure;

export interface CuaMcpReadinessSmokeInput {
  schemas: McpToolSchema[];
  callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
}

export interface CuaDriverDaemonLaunch {
  command: string;
  args: string[];
}

export function buildCuaDriverDaemonLaunch(appPath = DEFAULT_CUA_DRIVER_APP_PATH): CuaDriverDaemonLaunch {
  return {
    command: 'open',
    args: ['-n', '-g', appPath, '--args', 'serve'],
  };
}

export function shouldPrelaunchCuaDriverDaemonForMcp(
  serverName: string,
  resolvedBinary: string,
  currentPlatform: NodeJS.Platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): boolean {
  if (currentPlatform !== 'darwin') return false;
  if (serverName !== 'cua-driver') return false;
  if (basename(resolvedBinary) !== 'cua-driver') return false;
  return fileExists(join(DEFAULT_CUA_DRIVER_APP_PATH, 'Contents', 'MacOS', 'cua-driver'));
}

export function prelaunchCuaDriverDaemonForMcp(
  serverName: string,
  resolvedBinary: string,
  options: {
    platform?: NodeJS.Platform;
    fileExists?: (path: string) => boolean;
    runOpen?: (command: string, args: string[]) => { status: number | null; error?: Error };
  } = {},
): boolean {
  if (!shouldPrelaunchCuaDriverDaemonForMcp(serverName, resolvedBinary, options.platform, options.fileExists)) {
    return false;
  }

  const launch = buildCuaDriverDaemonLaunch();
  const result = (options.runOpen ?? ((command, args) => spawnSync(command, args, { stdio: 'ignore', timeout: 5_000 })))(launch.command, launch.args);
  return result.status === 0 && !result.error;
}

export async function runCuaMcpReadinessSmoke(input: CuaMcpReadinessSmokeInput): Promise<CuaMcpReadinessResult> {
  const observationTool = selectCuaObservationTool(input.schemas);
  if (!observationTool) {
    return { ready: false, code: 'mcp_observation_tool_missing' };
  }

  let result: McpRuntimeToolResult;
  try {
    result = await input.callToolResult(observationTool, buildCuaObservationSmokeInput(observationTool));
  } catch (error) {
    return {
      ready: false,
      code: 'mcp_observation_smoke_failed',
      observationTool,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (result.isError) {
    return {
      ready: false,
      code: 'mcp_observation_smoke_failed',
      observationTool,
      detail: result.summary || result.text,
    };
  }

  const contentTypes = collectConsumableContentTypes(result);
  if (contentTypes.length === 0) {
    return {
      ready: false,
      code: 'mcp_content_unsupported',
      observationTool,
    };
  }

  return {
    ready: true,
    observationTool,
    contentTypes,
  };
}

function selectCuaObservationTool(schemas: McpToolSchema[]): string | null {
  const available = new Set(schemas.map((schema) => schema.name));
  if (!CUA_REQUIRED_TOOLS.every((name) => available.has(name))) {
    return null;
  }
  return CUA_OBSERVATION_TOOL_PRIORITY.find((name) => available.has(name)) ?? null;
}

function buildCuaObservationSmokeInput(toolName: string): Record<string, unknown> {
  if (toolName === 'list_windows') {
    return { on_screen_only: true };
  }
  return {};
}

function collectConsumableContentTypes(result: McpRuntimeToolResult): string[] {
  const types: string[] = [];
  if (result.text.trim()) types.push('text');
  if (result.images.some((image) => !isProbablyEmptyCaptureImage(image))) types.push('image');
  if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) types.push('structuredContent');
  return types;
}

export function isProbablyEmptyCaptureImage(image: McpRuntimeToolImage): boolean {
  if (!image.data) return false;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(image.data, 'base64');
  } catch {
    return false;
  }
  if (bytes.length === 0) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  const unique = new Set(sample);
  return unique.size <= 1;
}
