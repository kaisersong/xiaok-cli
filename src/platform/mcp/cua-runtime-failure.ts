import type { McpRuntimeToolResult } from '../../ai/mcp/runtime/client.js';

export type CuaRuntimeFailureKind =
  | 'authorization_denied'
  | 'session_ended'
  | 'transport_closed'
  | 'daemon_unreachable';

export interface CuaRuntimeFailure {
  kind: CuaRuntimeFailureKind;
  message: string;
}

interface ErrorWithCode {
  code?: unknown;
  message?: unknown;
}

const AUTHORIZATION_PATTERNS = [
  /permission\s+(?:denied|missing|required)/i,
  /approval\s+(?:denied|required|missing)/i,
  /authorization[^\n]*(?:denied|revoked|expired|invalid)/i,
  /policy[^\n]*(?:denied|revoked|disabled|invalid)/i,
  /disabled\s+by\s+(?:the\s+)?user/i,
];

const SESSION_ENDED_PATTERNS = [
  /session\s+['"][^'"]+['"]\s+has\s+ended/i,
  /call\s+start_session[^\n]*\brevive\b/i,
];

const TRANSPORT_CLOSED_PATTERNS = [
  /\btransport\s+(?:is\s+)?closed\b/i,
  /\bconnection\s+(?:is\s+)?closed\b/i,
  /\bbroken\s+pipe\b/i,
  /\bepipe\b/i,
  /\beconnreset\b/i,
];

function messageFromFailure(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== 'object') return null;

  const result = value as Partial<McpRuntimeToolResult> & ErrorWithCode;
  if ('isError' in result && result.isError !== true) return null;
  if (typeof result.summary === 'string' && result.summary) return result.summary;
  if (typeof result.text === 'string' && result.text) return result.text;
  if (typeof result.message === 'string' && result.message) return result.message;
  return null;
}

/**
 * Classifies only failures that invalidate CUA authorization/session/transport
 * health. It is deliberately platform-neutral: this module is imported by the
 * cross-platform public wrapper and must never import macOS or driver bindings.
 */
export function classifyCuaRuntimeFailure(value: unknown): CuaRuntimeFailure | null {
  const message = messageFromFailure(value);
  if (!message) return null;

  // Authorization has priority over lifecycle/transport words that may appear
  // in the same driver error. Recovery must never rotate a connection to bypass
  // an explicit deny.
  if (AUTHORIZATION_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: 'authorization_denied', message };
  }
  if (SESSION_ENDED_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: 'session_ended', message };
  }
  if (TRANSPORT_CLOSED_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: 'transport_closed', message };
  }

  const normalized = message.toLowerCase();
  const mentionsCuaSocket = normalized.includes('cua-driver.sock');
  const daemonUnreachable = normalized.includes('cua-driver daemon not reachable')
    || (mentionsCuaSocket && normalized.includes('daemon not reachable'))
    || (mentionsCuaSocket && normalized.includes('connect enoent'))
    || (mentionsCuaSocket && normalized.includes('econnrefused'));
  return daemonUnreachable ? { kind: 'daemon_unreachable', message } : null;
}

/** Default-deny replay guard for calls whose first execution result is unknown. */
export function isReplaySafeCuaCall(
  operation: string,
  input: Readonly<Record<string, unknown>>,
): boolean {
  if (operation === 'list_apps' || operation === 'list_windows') return true;
  if (operation !== 'get_window_state') return false;

  // get_window_state is normally observational, but these compatibility fields
  // can write a file or execute code. Future side-effectful fields stay denied
  // until this production guard is deliberately extended.
  if (typeof input.screenshot_out_file === 'string' && input.screenshot_out_file.trim()) return false;
  if (typeof input.javascript === 'string' && input.javascript.trim()) return false;
  return true;
}
