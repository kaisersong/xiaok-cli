import type { Tool } from '../../types.js';
import type { McpRuntimeToolResult } from '../mcp/runtime/client.js';

export interface ComputerUseBackend {
  getUnavailableError?(): ComputerUseUnavailableError | null;
  onRecoverableError?(error: ComputerUseUnavailableError): void;
  callToolResult(name: string, input: Record<string, unknown>): Promise<McpRuntimeToolResult>;
}

export interface ComputerUseUnavailableError {
  code: string;
  message: string;
  userAction?: { type: string; label: string };
}

const ACTION_TO_CUA_TOOL: Record<string, string> = {
  capture: 'get_window_state',
  screenshot: 'screenshot',
  list_apps: 'list_apps',
  list_windows: 'list_windows',
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
  const repeatedRecoverableErrors = new Set<string>();
  return {
    permission: 'write',
    definition: {
      name: 'xiaok_computer_use',
      description: 'Observe and operate local macOS apps through CUA Driver with Xiaok safety checks. If this tool returns any COMPUTER_USE_* error, stop using Computer Use and wait for the user action; do not fall back to shell screenshot, osascript, cliclick, open, or cua-driver commands.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(ACTION_TO_CUA_TOOL),
            description: 'Computer-use action to run.',
          },
          app: { type: 'string' },
          pid: { type: 'number' },
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
          on_screen_only: { type: 'boolean' },
          query: { type: 'string' },
          javascript: { type: 'string' },
          screenshot_out_file: { type: 'string' },
          capture_after: { type: 'boolean' },
        },
        required: ['action'],
        additionalProperties: true,
      },
    },
    async execute(input) {
      const returnRecoverableError = (error: ComputerUseUnavailableError, notifyBackend = false): string => {
        if (notifyBackend) {
          try {
            backend.onRecoverableError?.(error);
          } catch {
            // Recovery state updates are best effort; the tool response must still be safe.
          }
        }
        const repeated = repeatedRecoverableErrors.has(error.code);
        repeatedRecoverableErrors.add(error.code);
        return JSON.stringify({
          ok: false,
          code: error.code,
          message: error.message,
          retryable: !repeated,
          waitForUserAction: true,
          ...(repeated ? { repeated: true } : {}),
          ...(!repeated && error.userAction ? { userAction: error.userAction } : {}),
        });
      };

      const unavailable = backend.getUnavailableError?.();
      if (unavailable) {
        return returnRecoverableError(unavailable);
      }

      const action = typeof input.action === 'string' ? input.action : '';
      const toolName = ACTION_TO_CUA_TOOL[action];
      if (!toolName) {
        return `Error: unsupported computer-use action: ${String(input.action)}`;
      }

      const blocked = checkBlockedInput(action, input);
      if (blocked) return blocked;

      let prepared: Record<string, unknown> | string;
      try {
        prepared = await buildActionInput(backend, action, input);
      } catch (error) {
        const recoverable = classifyRecoverableComputerUseError(formatUnknownError(error));
        if (recoverable) return returnRecoverableError(recoverable, true);
        throw error;
      }
      if (typeof prepared === 'string') {
        const recoverable = classifyRecoverableComputerUseError(prepared);
        if (recoverable) return returnRecoverableError(recoverable, true);
        return prepared;
      }

      let result: McpRuntimeToolResult;
      try {
        result = await backend.callToolResult(toolName, prepared);
      } catch (error) {
        const recoverable = classifyRecoverableComputerUseError(formatUnknownError(error));
        if (recoverable) return returnRecoverableError(recoverable, true);
        throw error;
      }
      if (result.isError) {
        const recoverable = classifyRecoverableComputerUseError(result.summary || result.text);
        if (recoverable) return returnRecoverableError(recoverable, true);
        return `Error: ${result.summary || result.text || 'computer-use action failed'}`;
      }

      const response: Record<string, unknown> = {
        ok: true,
        action,
        result: sanitizeToolResult(result),
      };

      if (input.capture_after === true && action !== 'capture' && action !== 'list_apps' && action !== 'list_windows') {
        const captureInput = await buildCaptureInput(backend, input);
        if (typeof captureInput === 'string') {
          const recoverable = classifyRecoverableComputerUseError(captureInput);
          if (recoverable) return returnRecoverableError(recoverable, true);
          response.captureAfter = { error: captureInput };
          return JSON.stringify(response);
        }
        const capture = await backend.callToolResult('get_window_state', captureInput);
        if (capture.isError) {
          const recoverable = classifyRecoverableComputerUseError(capture.summary || capture.text);
          if (recoverable) return returnRecoverableError(recoverable, true);
        }
        response.captureAfter = sanitizeToolResult(capture);
      }

      return JSON.stringify(response);
    },
  };
}

function classifyRecoverableComputerUseError(message: string): ComputerUseUnavailableError | null {
  const normalized = message.toLowerCase();
  const mentionsCuaSocket = normalized.includes('cua-driver.sock');
  const daemonUnreachable = normalized.includes('cua-driver daemon not reachable')
    || (mentionsCuaSocket && normalized.includes('daemon not reachable'))
    || (mentionsCuaSocket && normalized.includes('connect enoent'))
    || (mentionsCuaSocket && normalized.includes('econnrefused'));

  if (!daemonUnreachable) return null;

  return {
    code: 'COMPUTER_USE_MCP_CONNECT_TIMEOUT',
    message: 'CUA Driver 后台服务不可达，请在小K设置里重新连接 Computer Use。',
    userAction: { type: 'reconnect_computer_use', label: '重新连接' },
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function buildActionInput(
  backend: ComputerUseBackend,
  action: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | string> {
  if (action === 'capture') {
    return buildCaptureInput(backend, input);
  }
  if (action === 'screenshot') {
    return buildScreenshotInput(backend, input);
  }
  if (action === 'list_windows') {
    return buildListWindowsInput(input);
  }
  return buildCuaInput(input);
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

function buildListWindowsInput(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const pid = normalizeInteger(input.pid);
  if (pid !== null) {
    output.pid = pid;
  }
  if (typeof input.on_screen_only === 'boolean') {
    output.on_screen_only = input.on_screen_only;
  }
  return output;
}

async function buildCaptureInput(
  backend: ComputerUseBackend,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | string> {
  const direct = buildDirectWindowStateInput(input);
  if (direct) return direct;

  const app = typeof input.app === 'string' ? input.app.trim() : '';
  if (!app) {
    return 'Error: capture requires pid + window_id, or an app name that can be resolved through list_windows';
  }

  const windows = await backend.callToolResult('list_windows', { on_screen_only: true });
  if (windows.isError) {
    return `Error: ${windows.summary || windows.text || 'list_windows failed before capture'}`;
  }

  const candidate = selectWindowForApp(windows.structuredContent, app);
  if (!candidate) {
    return `Error: no visible CUA window found for app: ${app}`;
  }

  return {
    pid: candidate.pid,
    window_id: candidate.windowId,
    ...pickWindowStateOptions(input),
  };
}

async function buildScreenshotInput(
  backend: ComputerUseBackend,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | string> {
  const direct = buildDirectWindowAddressInput(input);
  if (direct) return direct;

  const app = typeof input.app === 'string' ? input.app.trim() : '';
  if (!app) {
    return 'Error: screenshot requires pid + window_id, or an app name that can be resolved through list_windows';
  }

  const windows = await backend.callToolResult('list_windows', { on_screen_only: true });
  if (windows.isError) {
    return `Error: ${windows.summary || windows.text || 'list_windows failed before screenshot'}`;
  }

  const candidate = selectWindowForApp(windows.structuredContent, app);
  if (!candidate) {
    return `Error: no visible CUA window found for app: ${app}`;
  }

  return {
    pid: candidate.pid,
    window_id: candidate.windowId,
  };
}

function buildDirectWindowStateInput(input: Record<string, unknown>): Record<string, unknown> | null {
  const direct = buildDirectWindowAddressInput(input);
  if (!direct) return null;
  return {
    ...direct,
    ...pickWindowStateOptions(input),
  };
}

function buildDirectWindowAddressInput(input: Record<string, unknown>): Record<string, unknown> | null {
  const pid = normalizeInteger(input.pid);
  const windowId = normalizeInteger(input.window_id);
  if (pid === null || windowId === null) return null;
  return {
    pid,
    window_id: windowId,
  };
}

function pickWindowStateOptions(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of ['query', 'javascript', 'screenshot_out_file']) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      output[key] = input[key];
    }
  }
  return output;
}

function selectWindowForApp(
  structuredContent: unknown,
  app: string,
): { pid: number; windowId: number } | null {
  const windows = extractWindows(structuredContent);
  const normalizedApp = normalizeName(app);
  const candidates = windows
    .map(normalizeWindowRecord)
    .filter((window): window is NormalizedWindowRecord => window !== null)
    .filter((window) => {
      const appName = normalizeName(window.appName);
      return appName === normalizedApp || appName.includes(normalizedApp) || normalizedApp.includes(appName);
    });

  const selected = candidates.find((window) => window.isOnScreen !== false) ?? candidates[0];
  if (!selected) return null;
  return { pid: selected.pid, windowId: selected.windowId };
}

interface NormalizedWindowRecord {
  appName: string;
  pid: number;
  windowId: number;
  isOnScreen?: boolean;
}

function extractWindows(structuredContent: unknown): unknown[] {
  if (!structuredContent || typeof structuredContent !== 'object') return [];
  const windows = (structuredContent as { windows?: unknown }).windows;
  return Array.isArray(windows) ? windows : [];
}

function normalizeWindowRecord(record: unknown): NormalizedWindowRecord | null {
  if (!record || typeof record !== 'object') return null;
  const value = record as Record<string, unknown>;
  const pid = normalizeInteger(value.pid);
  const windowId = normalizeInteger(value.window_id);
  const appName = readFirstString(value, ['app_name', 'app', 'name']);
  if (pid === null || windowId === null || !appName) return null;
  return {
    appName,
    pid,
    windowId,
    ...(typeof value.is_on_screen === 'boolean' ? { isOnScreen: value.is_on_screen } : {}),
  };
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
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
