import type { McpToolSchema } from '../../src/ai/mcp/client.js';
import type { McpRuntimeToolResult } from '../../src/ai/mcp/runtime/client.js';

const CUA_OBSERVATION_TOOL_PRIORITY = ['list_apps', 'get_app_state'];

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

export async function runCuaMcpReadinessSmoke(input: CuaMcpReadinessSmokeInput): Promise<CuaMcpReadinessResult> {
  const observationTool = selectCuaObservationTool(input.schemas);
  if (!observationTool) {
    return { ready: false, code: 'mcp_observation_tool_missing' };
  }

  let result: McpRuntimeToolResult;
  try {
    result = await input.callToolResult(observationTool, {});
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
  return CUA_OBSERVATION_TOOL_PRIORITY.find((name) => available.has(name)) ?? null;
}

function collectConsumableContentTypes(result: McpRuntimeToolResult): string[] {
  const types: string[] = [];
  if (result.text.trim()) types.push('text');
  if (result.images.length > 0) types.push('image');
  if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) types.push('structuredContent');
  return types;
}
