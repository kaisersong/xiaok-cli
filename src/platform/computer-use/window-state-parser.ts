/**
 * `get_window_state` output parser with target binding (design v58 §6.1;
 * R47-02, R48-01, R49-02, R50-02).
 *
 * Two failure modes this closes:
 *
 *  1. A same-pid sibling window, or a stale/misrouted result, could satisfy the
 *     old checks and leak the wrong window's screenshot while still being marked
 *     `certified`. Target binding therefore happens *before* any screenshot,
 *     degraded classification, snapshot/token publication or runtime status
 *     update, and requires four safe-integer fields that agree with each other
 *     and with the request target.
 *  2. On mismatch the raw MCP result must not reach the model at all — not via
 *     text, summary, content, structuredContent, background_input, status, image
 *     data/paths, snapshot/token, or backend error/cause. The only public shape is
 *     a host constant, so a canary planted in any raw channel cannot escape.
 */

export const INVALID_IDENTITY_RESULT = Object.freeze({
  ok: false as const,
  errorCode: 'invalid_computer_use_output_identity' as const,
  actionable: false as const,
});

export type IdentityRejectReason = 'missing' | 'type' | 'range' | 'mismatch';

export interface IdentityDiagnostic {
  readonly reason: IdentityRejectReason;
  readonly generationId: string;
  readonly traceId: string;
}

export type ParsedWindowState =
  | {
    kind: 'ok';
    pid: number;
    windowId: number;
    elements: readonly unknown[];
    elementsComplete: boolean;
    snapshotId: string | null;
    screenshot: unknown;
  }
  | {
    kind: 'ax_unresolved';
    pid: number;
    windowId: number;
    degradedReason: string;
    escalation: unknown;
    backgroundInput: unknown;
    elementsComplete: false;
    actionable: false;
    /** Observation-only screenshot, already proven to belong to the target. */
    screenshot: unknown;
  }
  | {
    kind: 'invalid_identity';
    result: typeof INVALID_IDENTITY_RESULT;
    diagnostic: IdentityDiagnostic;
  }
  | {
    kind: 'unsupported_degraded';
    pid: number;
    windowId: number;
    degradedReason: string;
  };

export interface RequestTarget {
  readonly pid: number;
  readonly windowId: number;
}

export interface ParseContext {
  readonly generationId: string;
  readonly traceId: string;
}

function safeInt(value: unknown): { ok: true; value: number } | { ok: false; reason: IdentityRejectReason } {
  if (value === undefined || value === null) return { ok: false, reason: 'missing' };
  if (typeof value !== 'number') return { ok: false, reason: 'type' };
  if (!Number.isInteger(value)) return { ok: false, reason: 'type' };
  if (!Number.isSafeInteger(value)) return { ok: false, reason: 'range' };
  return { ok: true, value };
}

function reject(reason: IdentityRejectReason, context: ParseContext): ParsedWindowState {
  return {
    kind: 'invalid_identity',
    result: INVALID_IDENTITY_RESULT,
    diagnostic: { reason, generationId: context.generationId, traceId: context.traceId },
  };
}

/**
 * Parses a raw `get_window_state` MCP result. The caller must pass the target it
 * actually asked for; everything else is derived from the payload.
 */
export function parseWindowStateResult(
  raw: unknown,
  target: RequestTarget,
  context: ParseContext,
): ParsedWindowState {
  if (!raw || typeof raw !== 'object') return reject('missing', context);
  const structured = (raw as { structuredContent?: unknown }).structuredContent;
  if (!structured || typeof structured !== 'object') return reject('missing', context);
  const payload = structured as Record<string, unknown>;

  const topPid = safeInt(payload.pid);
  const topWindow = safeInt(payload.window_id);
  if (!topPid.ok) return reject(topPid.reason, context);
  if (!topWindow.ok) return reject(topWindow.reason, context);

  const background = payload.background_input;
  if (!background || typeof background !== 'object') return reject('missing', context);
  const exactWindow = (background as { exact_window?: unknown }).exact_window;
  if (!exactWindow || typeof exactWindow !== 'object') return reject('missing', context);
  const exact = exactWindow as Record<string, unknown>;

  const exactPid = safeInt(exact.pid);
  const exactWindowId = safeInt(exact.window_id);
  if (!exactPid.ok) return reject(exactPid.reason, context);
  if (!exactWindowId.ok) return reject(exactWindowId.reason, context);

  // Mutual agreement, then agreement with the request. A same-pid sibling window
  // fails here even though every field is individually well formed.
  if (topPid.value !== exactPid.value || topWindow.value !== exactWindowId.value) {
    return reject('mismatch', context);
  }
  if (topPid.value !== target.pid || topWindow.value !== target.windowId) {
    return reject('mismatch', context);
  }

  const degraded = payload.degraded === true;
  const degradedReason = typeof payload.degraded_reason === 'string' ? payload.degraded_reason : '';
  const screenshot = payload.screenshot ?? (raw as { screenshot?: unknown }).screenshot ?? null;

  if (degraded) {
    const isAxUnresolved = degradedReason.startsWith('ax_window_unresolved');
    const exactStatus = typeof exact.status === 'string' ? exact.status : '';
    if (isAxUnresolved && exactStatus === 'ax_unresolved') {
      return {
        kind: 'ax_unresolved',
        pid: topPid.value,
        windowId: topWindow.value,
        degradedReason,
        escalation: payload.escalation ?? null,
        backgroundInput: background,
        elementsComplete: false,
        actionable: false,
        screenshot,
      };
    }
    return {
      kind: 'unsupported_degraded',
      pid: topPid.value,
      windowId: topWindow.value,
      degradedReason: degradedReason || 'unclassified_degraded',
    };
  }

  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const snapshotId = typeof payload.snapshot_id === 'string' ? payload.snapshot_id : null;
  return {
    kind: 'ok',
    pid: topPid.value,
    windowId: topWindow.value,
    elements,
    elementsComplete: payload.elements_complete === true,
    snapshotId,
    screenshot,
  };
}

export type SnapshotIdentityProjection = 'unknown' | 'certified' | 'blocked_external';

/**
 * Non-persistent runtime projection. It never writes `ComputerUsePreference`, and
 * a successful pixel action can never promote it.
 */
export function projectSnapshotIdentity(
  current: SnapshotIdentityProjection,
  parsed: ParsedWindowState,
): SnapshotIdentityProjection {
  if (parsed.kind === 'invalid_identity') return current; // no status update at all
  if (parsed.kind === 'ax_unresolved') return 'blocked_external';
  if (parsed.kind === 'ok' && parsed.snapshotId !== null && parsed.elementsComplete) return 'certified';
  return current;
}
