import type { Tool } from '../../types.js';
import type { McpInvocationOptions, McpRuntimeToolResult } from '../mcp/runtime/client.js';
import {
  MACOS_CUA_ABI_PROFILE,
  type CuaAbiProfile,
  InvalidComputerUseInputError,
  translateCuaAction,
} from '../../platform/computer-use/cua-action-contract.js';
import { classifyCuaRuntimeFailure } from '../../platform/mcp/cua-runtime-failure.js';

export interface ComputerUseBackend {
  abiProfile?: CuaAbiProfile;
  requiresImageInput?: boolean;
  prepareActionInput?(action: string, input: Record<string, unknown>): Record<string, unknown>;
  acquireInvocation?(): { generation: number; backend: ComputerUseBackend; isCurrent(): boolean } | null;
  getUnavailableError?(): ComputerUseUnavailableError | null;
  onRecoverableError?(error: ComputerUseUnavailableError): void;
  callToolResult(name: string, input: Record<string, unknown>, options?: McpInvocationOptions): Promise<McpRuntimeToolResult>;
}

export interface ComputerUseUnavailableError {
  code: string;
  message: string;
  userAction?: { type: string; label: string };
  waitForUserAction?: boolean;
  retryable?: boolean;
  notifyBackend?: boolean;
  remember?: boolean;
  nextAction?: string;
}

/**
 * Design v58 §6.1: the public action list now comes from the frozen
 * `CuaActionContract` table, which is also what activation verifies. The old map
 * pointed `screenshot` and `middle_click` at backend operations that do not exist
 * in cua-driver 0.19.3 (its legacy catalog has 54 tools and neither of those), so
 * a "ready" provider failed at call time with Unknown tool.
 */
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

export function createComputerUseTool(backend: ComputerUseBackend, abiProfile: CuaAbiProfile = MACOS_CUA_ABI_PROFILE): Tool {
  const PUBLIC_CUA_ACTIONS: readonly string[] = abiProfile.contracts.map(c => c.action);
  const repeatedRecoverableErrors = new Set<string>();
  let lastErrorGeneration: number | undefined;
  return {
    permission: 'write',
    definition: {
      name: 'xiaok_computer_use',
      description: `Observe and operate local ${abiProfile.platform === 'win32' ? 'Windows' : 'macOS'} apps through CUA Driver with Xiaok safety checks. Session revival and transport reconnection are owned internally by Xiaok; never search for or call start_session or raw cua-driver commands. If an error has waitForUserAction=true, stop and wait for that user action. If a reobserve-required error has waitForUserAction=false, first capture the current target UI again, then decide whether the interrupted mutation still needs to be retried. Windows mutations default to background. An explicit foreground retry requires a native background_unavailable response for that exact target/operation and another fresh capture; never switch focus preemptively. Windows mutations require a fresh capture, explicit pid + window_id, and tokens/indices from that exact host snapshot. Never fall back to shell screenshot, osascript, cliclick, open, or cua-driver commands.`,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: PUBLIC_CUA_ACTIONS,
            description: 'Computer-use action to run.',
          },
          app: { type: 'string' },
          pid: { type: abiProfile.platform === 'win32' ? 'integer' : 'number' },
          window_id: { type: abiProfile.platform === 'win32' ? 'integer' : 'string' },
          element_index: { type: abiProfile.platform === 'win32' ? 'integer' : 'string' },
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
          ...(abiProfile.platform === 'win32' ? {
            snapshot_id: { type: 'string', description: 'Host snapshot identity returned by this generation of capture. Required with element_index.' },
            element_token: { type: 'string', description: 'Host element token from the latest capture of this pid and window_id.' },
            capture_id: { type: 'string', description: 'Host capture identity from the latest capture of this target.' },
            delivery_mode: { type: 'string', enum: ['background', 'foreground'] },
            button: { type: 'string', enum: ['left', 'right', 'middle'] }, count: { type: 'integer', minimum: 1, maximum: 3 },
            by: { type: 'string', enum: ['line', 'page'] },
            duration_ms: { type: 'integer', minimum: 0 }, steps: { type: 'integer', minimum: 1 }, delay_ms: { type: 'integer', minimum: 0 },
            include_accessibility_tree: { type: 'boolean' }, max_depth: { type: 'integer', minimum: 1 },
            max_elements: { type: 'integer', minimum: 1 }, max_dimension: { type: 'integer', minimum: 1 },
            max_image_dimension: { type: 'integer', minimum: 0 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
            modifier: { type: 'array', items: { type: 'string' } }, modifiers: { type: 'array', items: { type: 'string' } },
          } : { javascript: { type: 'string' }, screenshot_out_file: { type: 'string' } }),
          capture_after: { type: 'boolean' },
        },
        required: ['action'],
        additionalProperties: abiProfile.platform !== 'win32',
      },
    },
    async execute(input, context) {
      const options = context?.signal ? { signal: context.signal } : undefined;
      options?.signal?.throwIfAborted();
      const lease = backend.acquireInvocation?.();
      if (lease?.generation !== lastErrorGeneration) {
        repeatedRecoverableErrors.clear(); lastErrorGeneration = lease?.generation;
      }
      const returnRecoverableError = (error: ComputerUseUnavailableError, notifyBackend = false): string => {
        if (notifyBackend && error.notifyBackend !== false) {
          try {
            backend.onRecoverableError?.(error);
          } catch {
            // Recovery state updates are best effort; the tool response must still be safe.
          }
        }
        const remember = error.remember !== false;
        const repeated = remember && repeatedRecoverableErrors.has(error.code);
        if (remember) repeatedRecoverableErrors.add(error.code);
        const retryable = error.retryable ?? !repeated;
        const waitForUserAction = error.waitForUserAction ?? true;
        return JSON.stringify({
          ok: false,
          code: error.code,
          message: error.message,
          retryable,
          waitForUserAction,
          ...(repeated ? { repeated: true } : {}),
          ...(!repeated && waitForUserAction && error.userAction ? { userAction: error.userAction } : {}),
          ...(error.nextAction ? { nextAction: error.nextAction } : {}),
        });
      };

      const unavailable = backend.getUnavailableError?.();
      if (unavailable) {
        return returnRecoverableError(unavailable);
      }

      const action = typeof input.action === 'string' ? input.action : '';
      if (!PUBLIC_CUA_ACTIONS.includes(action)) {
        return `Error: unsupported computer-use action: ${String(input.action)}`;
      }
      const targetBackend = lease?.backend ?? backend;
      const invocationProfile = targetBackend.abiProfile ?? abiProfile;
      if (invocationProfile.id !== abiProfile.id) return returnRecoverableError({ code: 'COMPUTER_USE_WRAPPER_NOT_READY', message: 'Computer Use 接口版本已变化，请重新启用。', retryable: false });
      const assertGeneration = () => {
        if (lease && !lease.isCurrent()) {
          throw Object.assign(new Error('Computer Use connection changed; observe again.'), { code: 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED' });
        }
      };
      const invocationBackend: ComputerUseBackend = {
        ...targetBackend,
        async callToolResult(name, args, callOptions) {
          assertGeneration();
          const result = await targetBackend.callToolResult(name, args, callOptions);
          assertGeneration();
          if (targetBackend.requiresImageInput && name === 'get_window_state' && !result.isError) {
            const observation = result.structuredContent as Record<string, unknown> | undefined;
            for (const field of ['pid', 'window_id']) {
              const requested = args[field];
              if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested <= 0
                || !observation || observation[field] !== requested) throw new Error('COMPUTER_USE_OBSERVATION_TARGET_MISMATCH');
            }
          }
          return result;
        },
      };
      if (targetBackend.requiresImageInput && !['list_apps', 'list_windows'].includes(action)
        && (context?.modelSupportsImageInput !== true || !context.emitToolImage)) {
        return returnRecoverableError({ code: 'COMPUTER_USE_MODEL_IMAGE_DISABLED', message: '当前会话模型没有经过确认的图片输入能力，请切换到支持图片的模型。', retryable: false, waitForUserAction: true, remember: false });
      }
      const images: McpRuntimeToolResult['images'] = [];

      const blocked = checkBlockedInput(action, input);
      if (blocked) return blocked;

      let prepared: Record<string, unknown> | string;
      try {
        prepared = await buildActionInput(invocationBackend, action, input, options);
        options?.signal?.throwIfAborted();
      } catch (error) {
        options?.signal?.throwIfAborted();
        const recoverable = classifyRecoverableComputerUseError(error);
        if (recoverable) return returnRecoverableError(recoverable, true);
        throw error;
      }
      if (typeof prepared === 'string') {
        const recoverable = classifyRecoverableComputerUseError(prepared);
        if (recoverable) return returnRecoverableError(recoverable, true);
        return prepared;
      }

      // The frozen table decides the backend operation, the allowed field set,
      // renames and forced constants; nothing is passed through implicitly.
      let translated: { operation: string; input: Record<string, unknown> };
      try {
        translated = translateCuaAction(action, targetBackend.prepareActionInput?.(action, prepared) ?? prepared, invocationProfile);
      } catch (error) {
        if (error instanceof InvalidComputerUseInputError) return `Error: ${error.message}`;
        const recoverable = classifyRecoverableComputerUseError(error);
        if (recoverable) return returnRecoverableError(recoverable);
        throw error;
      }

      let result: McpRuntimeToolResult;
      try {
        result = await callComputerUseBackend(invocationBackend, translated.operation, translated.input, options);
        options?.signal?.throwIfAborted();
      } catch (error) {
        options?.signal?.throwIfAborted();
        const recoverable = classifyRecoverableComputerUseError(error);
        if (recoverable) return returnRecoverableError(recoverable, true);
        throw error;
      }
      if (result.isError) {
        const recoverable = classifyRecoverableComputerUseError(result);
        if (recoverable) return returnRecoverableError(recoverable, true);
        return `Error: ${result.summary || result.text || 'computer-use action failed'}`;
      }

      const response: Record<string, unknown> = {
        ok: true,
        action,
        result: sanitizeToolResult(result),
      };
      if (targetBackend.requiresImageInput && ['capture', 'screenshot'].includes(action)) images.push(...result.images);

      if (input.capture_after === true && action !== 'capture' && action !== 'screenshot' && action !== 'list_apps' && action !== 'list_windows') {
        const captureInput = await buildCaptureInput(invocationBackend, input, options);
        options?.signal?.throwIfAborted();
        if (typeof captureInput === 'string') {
          const recoverable = classifyRecoverableComputerUseError(captureInput);
          if (recoverable) return returnRecoverableError(recoverable, true);
          response.captureAfter = { error: captureInput };
          return JSON.stringify(response);
        }
        // The follow-up observation goes through the same frozen translator as the
        // public `capture` action, so both paths force include_screenshot and share
        // one allowed-field set (design §6.1).
        const captureTranslated = translateCuaAction('capture', captureInput, invocationProfile);
        let capture: McpRuntimeToolResult;
        try {
          capture = await callComputerUseBackend(
            invocationBackend,
            captureTranslated.operation,
            captureTranslated.input,
            options,
          );
          options?.signal?.throwIfAborted();
        } catch (error) {
          options?.signal?.throwIfAborted();
          const recoverable = classifyRecoverableComputerUseError(error);
          if (recoverable) return returnRecoverableError(recoverable, true);
          throw error;
        }
        if (capture.isError) {
          const recoverable = classifyRecoverableComputerUseError(capture);
          if (recoverable) return returnRecoverableError(recoverable, true);
        }
        if (targetBackend.requiresImageInput && !capture.isError) images.push(...capture.images);
        response.captureAfter = sanitizeToolResult(capture);
      }

      options?.signal?.throwIfAborted();
      assertGeneration();
      for (const image of images) {
        if (!image.data || image.mimeType !== 'image/png') throw new Error('COMPUTER_USE_IMAGE_INVALID');
        context!.emitToolImage!({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } });
      }
      return JSON.stringify(response);
    },
  };
}

async function callComputerUseBackend(
  backend: ComputerUseBackend,
  name: string,
  input: Record<string, unknown>,
  options?: McpInvocationOptions,
): Promise<McpRuntimeToolResult> {
  options?.signal?.throwIfAborted();
  try {
    const result = await (options
      ? backend.callToolResult(name, input, options)
      : backend.callToolResult(name, input));
    options?.signal?.throwIfAborted();
    return result;
  } catch (error) {
    options?.signal?.throwIfAborted();
    throw error;
  }
}

function classifyRecoverableComputerUseError(value: unknown): ComputerUseUnavailableError | null {
  const code = readErrorCode(value);
  if (code === 'background_unavailable' || code === 'background_occluded') {
    return { code: 'COMPUTER_USE_BACKGROUND_UNAVAILABLE', message: '当前目标的后台操作不可用，请重新观察后再决定是否显式选择 foreground。', waitForUserAction: false, retryable: true, notifyBackend: false, remember: false, nextAction: 'capture' };
  }
  const nativeMessage = value && typeof value === 'object' ? (value as Partial<McpRuntimeToolResult>).summary ?? (value as Partial<McpRuntimeToolResult>).text : undefined;
  if (code === 'foreground_unavailable' || (code === 'tool_invocation_failed' && typeof nativeMessage === 'string' && nativeMessage.startsWith('foreground_unavailable:'))) return { code: 'COMPUTER_USE_FOREGROUND_UNAVAILABLE', message: 'Windows 未确认目标窗口或控件获得焦点。请检查目标状态后重新观察，避免重复发送操作。', waitForUserAction: true, retryable: false, notifyBackend: false, remember: false };
  if (code === 'background_uipi_blocked') return { code: 'COMPUTER_USE_WINDOWS_TARGET_PERMISSION_DENIED', message: 'Windows 阻止了向此目标发送输入，请将目标与小K运行在相同权限级别后重新观察。', waitForUserAction: true, retryable: false, notifyBackend: false, remember: false };
  if (code === 'COMPUTER_USE_WINDOW_AMBIGUOUS') {
    return { code, message: value instanceof Error ? value.message : '多个窗口匹配，请明确 pid + window_id。', waitForUserAction: false, retryable: true, notifyBackend: false, remember: false, nextAction: 'list_windows' };
  }
  if (code === 'COMPUTER_USE_REOBSERVE_REQUIRED' || code === 'COMPUTER_USE_OBSERVATION_TARGET_MISMATCH' || code === 'COMPUTER_USE_OBSERVATION_INVALID') {
    return { code, message: '目标尚未观察、快照已过期或观察结果无效，请重新 capture 同一 pid 与 window_id 后再操作。',
      waitForUserAction: false, retryable: true, notifyBackend: false, remember: false, nextAction: 'capture' };
  }
  if (code === 'COMPUTER_USE_RECONNECTED_REOBSERVE_REQUIRED') {
    return {
      code,
      message: 'Computer Use 连接已恢复。请先重新观察当前界面，再决定是否重试刚才的操作。',
      waitForUserAction: false,
      retryable: true,
      notifyBackend: false,
      remember: false,
      nextAction: 'observe',
    };
  }

  const runtimeFailure = classifyCuaRuntimeFailure(value);
  if (!runtimeFailure || runtimeFailure.kind === 'authorization_denied') {
    if (code !== 'COMPUTER_USE_CONNECTION_RECOVERY_FAILED') return null;
  }

  return {
    code: 'COMPUTER_USE_MCP_CONNECT_TIMEOUT',
    message: 'CUA Driver 后台服务不可达，请在小K设置里重新连接 Computer Use。',
    userAction: { type: 'reconnect_computer_use', label: '重新连接' },
  };
}

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { code?: unknown; structuredContent?: { code?: unknown; error?: { code?: unknown } } };
  const code = record.code ?? record.structuredContent?.code ?? record.structuredContent?.error?.code;
  return typeof code === 'string' ? code : null;
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
  options?: McpInvocationOptions,
): Promise<Record<string, unknown> | string> {
  if (action === 'capture') {
    return buildCaptureInput(backend, input, options);
  }
  if (action === 'screenshot') {
    return buildScreenshotInput(backend, input, options);
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
  options?: McpInvocationOptions,
): Promise<Record<string, unknown> | string> {
  const direct = buildDirectWindowStateInput(input);
  if (direct) return direct;

  const app = typeof input.app === 'string' ? input.app.trim() : '';
  if (!app) {
    return 'Error: capture requires pid + window_id, or an app name that can be resolved through list_windows';
  }

  const windows = await callComputerUseBackend(backend, 'list_windows', { on_screen_only: true }, options);
  if (windows.isError) {
    return `Error: ${windows.summary || windows.text || 'list_windows failed before capture'}`;
  }

  const candidate = selectWindowForApp(windows.structuredContent, app, backend.abiProfile?.platform === 'win32');
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
  options?: McpInvocationOptions,
): Promise<Record<string, unknown> | string> {
  const direct = buildDirectWindowAddressInput(input);
  if (direct) return direct;

  const app = typeof input.app === 'string' ? input.app.trim() : '';
  if (!app) {
    return 'Error: screenshot requires pid + window_id, or an app name that can be resolved through list_windows';
  }

  const windows = await callComputerUseBackend(backend, 'list_windows', { on_screen_only: true }, options);
  if (windows.isError) {
    return `Error: ${windows.summary || windows.text || 'list_windows failed before screenshot'}`;
  }

  const candidate = selectWindowForApp(windows.structuredContent, app, backend.abiProfile?.platform === 'win32');
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
  for (const key of ['include_accessibility_tree', 'max_depth', 'max_elements', 'max_dimension', 'max_image_dimension', 'timeout_ms']) {
    if (input[key] !== undefined) output[key] = input[key];
  }
  return output;
}

function selectWindowForApp(
  structuredContent: unknown,
  app: string,
  rejectAmbiguous = false,
): { pid: number; windowId: number } | null {
  const windows = extractWindows(structuredContent);
  const normalizedApp = normalizeName(app);
  const candidates = windows
    .map(normalizeWindowRecord)
    .filter((window): window is NormalizedWindowRecord => window !== null)
    .filter((window) => {
      const appName = normalizeName(window.appName);
      return Boolean(appName) && (appName === normalizedApp || appName.includes(normalizedApp) || normalizedApp.includes(appName));
    });

  if (rejectAmbiguous && candidates.length > 1) {
    throw Object.assign(new Error(`多个窗口匹配 ${app}，请明确 pid + window_id：${JSON.stringify(candidates.slice(0, 8).map(window => ({ pid: window.pid, window_id: window.windowId, title: window.title })))}`), { code: 'COMPUTER_USE_WINDOW_AMBIGUOUS' });
  }

  const selected = candidates.find((window) => window.isOnScreen !== false) ?? candidates[0];
  if (!selected) return null;
  return { pid: selected.pid, windowId: selected.windowId };
}

interface NormalizedWindowRecord {
  appName: string;
  title: string;
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
    title: readFirstString(value, ['title', 'window_title']).slice(0, 200),
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
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
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
