import type { Tool } from '../../types.js';
import type { McpRuntimeToolResult } from '../mcp/runtime/client.js';

export interface ComputerUseBackend {
  callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
}

const ACTION_TO_CUA_TOOL: Record<string, string> = {
  capture: 'get_app_state',
  list_apps: 'list_apps',
  click: 'click',
  double_click: 'double_click',
  right_click: 'right_click',
  middle_click: 'middle_click',
  drag: 'drag',
  scroll: 'scroll',
  type: 'type_text',
  key: 'press_key',
  set_value: 'set_value',
};

const DANGEROUS_KEY_PATTERNS = [
  /^cmd\+shift\+q$/i,
  /^cmd\+option\+shift\+q$/i,
  /^cmd\+ctrl\+q$/i,
  /^cmd\+shift\+backspace$/i,
  /^cmd\+option\+backspace$/i,
];

const DANGEROUS_TEXT_PATTERNS = [
  /\bcurl\b[\s\S]*\|\s*(?:bash|sh)\b/i,
  /\bwget\b[\s\S]*\|\s*(?:bash|sh)\b/i,
  /\brm\s+-[^\n]*[rf][^\n]*\s+\/(?:\s|$)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

export function createComputerUseTool(backend: ComputerUseBackend): Tool {
  return {
    permission: 'write',
    definition: {
      name: 'xiaok_computer_use',
      description: 'Observe and operate local macOS apps through CUA Driver with Xiaok safety checks.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(ACTION_TO_CUA_TOOL),
            description: 'Computer-use action to run.',
          },
          app: { type: 'string' },
          window_id: { type: 'string' },
          element_index: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          to_x: { type: 'number' },
          to_y: { type: 'number' },
          direction: { type: 'string' },
          pages: { type: 'number' },
          text: { type: 'string' },
          key: { type: 'string' },
          value: { type: 'string' },
          capture_after: { type: 'boolean' },
        },
        required: ['action'],
        additionalProperties: true,
      },
    },
    async execute(input) {
      const action = typeof input.action === 'string' ? input.action : '';
      const toolName = ACTION_TO_CUA_TOOL[action];
      if (!toolName) {
        return `Error: unsupported computer-use action: ${String(input.action)}`;
      }

      const blocked = checkBlockedInput(action, input);
      if (blocked) return blocked;

      const cuaInput = buildCuaInput(input);
      const result = await backend.callToolResult(toolName, cuaInput);
      if (result.isError) {
        return `Error: ${result.summary || result.text || 'computer-use action failed'}`;
      }

      const response: Record<string, unknown> = {
        ok: true,
        action,
        result: sanitizeToolResult(result),
      };

      if (input.capture_after === true && action !== 'capture' && action !== 'list_apps') {
        const captureInput = buildCaptureAfterInput(input);
        const capture = await backend.callToolResult('get_app_state', captureInput);
        response.captureAfter = sanitizeToolResult(capture);
      }

      return JSON.stringify(response);
    },
  };
}

function checkBlockedInput(action: string, input: Record<string, unknown>): string | null {
  if (action === 'type') {
    const text = typeof input.text === 'string' ? input.text : '';
    if (DANGEROUS_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
      return 'Error: blocked dangerous computer-use text input';
    }
  }

  if (action === 'key') {
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (DANGEROUS_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      return 'Error: blocked dangerous computer-use key combo';
    }
  }

  return null;
}

function buildCuaInput(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'action' || key === 'capture_after') continue;
    if (value === undefined || value === null || value === '') continue;
    output[key] = value;
  }
  return output;
}

function buildCaptureAfterInput(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (typeof input.app === 'string' && input.app.trim()) {
    output.app = input.app;
  }
  if (typeof input.window_id === 'string' && input.window_id.trim()) {
    output.window_id = input.window_id;
  }
  return output;
}

function sanitizeToolResult(result: McpRuntimeToolResult): Record<string, unknown> {
  return {
    text: result.text,
    summary: result.summary,
    images: result.images.map((image) => ({
      mimeType: image.mimeType,
      ...(image.filePath ? { filePath: image.filePath } : {}),
      ...(image.description ? { description: image.description } : {}),
      ...(image.data ? { data: '[image data omitted]' } : {}),
    })),
    ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
  };
}
