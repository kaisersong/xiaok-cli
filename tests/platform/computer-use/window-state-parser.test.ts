import { describe, expect, it } from 'vitest';
import {
  INVALID_IDENTITY_RESULT,
  parseWindowStateResult,
  projectSnapshotIdentity,
  type ParseContext,
} from '../../../src/platform/computer-use/window-state-parser.js';

/**
 * Design v58 §6.1 / R48-01 / R49-02. Target binding must happen before any
 * screenshot, degraded classification, snapshot publication or status update, and
 * a mismatch must expose nothing but the host constant.
 */
const TARGET = { pid: 501, windowId: 12 };
const CONTEXT: ParseContext = { generationId: 'gen-1', traceId: 'trace-1' };

/** Every raw channel carries a distinct canary so a leak is unambiguous. */
function canaryResult(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: 'CANARY_TEXT' }],
    screenshot: 'CANARY_SCREENSHOT',
    error: { message: 'CANARY_ERROR', cause: 'CANARY_CAUSE' },
    structuredContent: {
      pid: 501,
      window_id: 12,
      summary: 'CANARY_SUMMARY',
      status: 'CANARY_STATUS',
      screenshot_path: 'CANARY_PATH',
      snapshot_id: 's1a2b3c4d',
      element_token: 'CANARY_TOKEN',
      elements: [{ token: 'CANARY_ELEMENT' }],
      elements_complete: true,
      degraded: false,
      background_input: { exact_window: { pid: 501, window_id: 12, status: 'ok' } },
      ...overrides,
    },
  };
}

describe('window state target binding', () => {
  it('accepts a result whose four identity fields agree with the request', () => {
    const parsed = parseWindowStateResult(canaryResult(), TARGET, CONTEXT);

    expect(parsed.kind).toBe('ok');
    expect(parsed).toMatchObject({ pid: 501, windowId: 12, snapshotId: 's1a2b3c4d', elementsComplete: true });
  });

  it('rejects a same-pid sibling window even though every field is well formed', () => {
    const raw = canaryResult({
      window_id: 99,
      background_input: { exact_window: { pid: 501, window_id: 99, status: 'ok' } },
    });

    const parsed = parseWindowStateResult(raw, TARGET, CONTEXT);

    expect(parsed).toMatchObject({ kind: 'invalid_identity' });
    expect((parsed as { result: unknown }).result).toEqual(INVALID_IDENTITY_RESULT);
  });

  it('rejects disagreement between the top level and exact_window', () => {
    const raw = canaryResult({
      background_input: { exact_window: { pid: 501, window_id: 13, status: 'ok' } },
    });

    expect(parseWindowStateResult(raw, TARGET, CONTEXT).kind).toBe('invalid_identity');
  });

  it('rejects missing, numeric-string, float and overflowing identities', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['missing top pid', { pid: undefined }],
      ['numeric string', { pid: '501' }],
      ['float', { pid: 501.5 }],
      ['overflow', { pid: Number.MAX_SAFE_INTEGER + 2 }],
      ['missing background', { background_input: undefined }],
      ['missing exact window', { background_input: {} }],
      ['exact window numeric string', { background_input: { exact_window: { pid: '501', window_id: 12 } } }],
    ];

    for (const [label, overrides] of cases) {
      const parsed = parseWindowStateResult(canaryResult(overrides), TARGET, CONTEXT);
      expect(parsed.kind, label).toBe('invalid_identity');
    }
  });

  it('leaks no raw channel when identity fails: the public shape is a host constant', () => {
    const raw = canaryResult({
      window_id: 99,
      background_input: { exact_window: { pid: 501, window_id: 99, status: 'ok' } },
    });

    const parsed = parseWindowStateResult(raw, TARGET, CONTEXT);
    const serialized = JSON.stringify(parsed);

    for (const canary of [
      'CANARY_TEXT', 'CANARY_SCREENSHOT', 'CANARY_ERROR', 'CANARY_CAUSE', 'CANARY_SUMMARY',
      'CANARY_STATUS', 'CANARY_PATH', 'CANARY_TOKEN', 'CANARY_ELEMENT', 's1a2b3c4d',
    ]) {
      expect(serialized, `leaked ${canary}`).not.toContain(canary);
    }
    // Only the frozen keys plus out-of-band diagnostics are present.
    expect(Object.keys((parsed as { result: object }).result).sort())
      .toEqual(['actionable', 'errorCode', 'ok']);
    expect((parsed as { diagnostic: { reason: string } }).diagnostic.reason).toBe('mismatch');
  });

  it('keeps the runtime projection untouched on an identity failure', () => {
    const raw = canaryResult({
      window_id: 99,
      background_input: { exact_window: { pid: 501, window_id: 99, status: 'ok' } },
    });
    const parsed = parseWindowStateResult(raw, TARGET, CONTEXT);

    expect(projectSnapshotIdentity('unknown', parsed)).toBe('unknown');
    expect(projectSnapshotIdentity('certified', parsed)).toBe('certified');
  });
});

describe('window state degraded classification', () => {
  it('returns a typed ax_unresolved result after target binding succeeds', () => {
    const raw = canaryResult({
      degraded: true,
      degraded_reason: 'ax_window_unresolved: WindowServer refused',
      elements: [],
      elements_complete: false,
      snapshot_id: undefined,
      background_input: { exact_window: { pid: 501, window_id: 12, status: 'ax_unresolved' } },
    });

    const parsed = parseWindowStateResult(raw, TARGET, CONTEXT);

    expect(parsed).toMatchObject({
      kind: 'ax_unresolved', pid: 501, windowId: 12, actionable: false, elementsComplete: false,
    });
    // The observation screenshot is kept, because identity was already proven.
    expect((parsed as { screenshot: unknown }).screenshot).toBe('CANARY_SCREENSHOT');
  });

  it('projects blocked_external for an ax-unresolved target, never certified', () => {
    const raw = canaryResult({
      degraded: true,
      degraded_reason: 'ax_window_unresolved: x',
      background_input: { exact_window: { pid: 501, window_id: 12, status: 'ax_unresolved' } },
    });
    const parsed = parseWindowStateResult(raw, TARGET, CONTEXT);

    expect(projectSnapshotIdentity('unknown', parsed)).toBe('blocked_external');
  });

  it('refuses to treat an unclassified degraded reason as actionable', () => {
    const raw = canaryResult({ degraded: true, degraded_reason: 'some_new_reason' });

    const parsed = parseWindowStateResult(raw, TARGET, CONTEXT);

    expect(parsed.kind).toBe('unsupported_degraded');
    expect(projectSnapshotIdentity('unknown', parsed)).toBe('unknown');
  });

  it('does not accept ax_unresolved unless exact_window agrees', () => {
    const raw = canaryResult({
      degraded: true,
      degraded_reason: 'ax_window_unresolved: x',
      background_input: { exact_window: { pid: 501, window_id: 12, status: 'ok' } },
    });

    expect(parseWindowStateResult(raw, TARGET, CONTEXT).kind).toBe('unsupported_degraded');
  });

  it('only certifies a fully resolved snapshot', () => {
    const complete = parseWindowStateResult(canaryResult(), TARGET, CONTEXT);
    expect(projectSnapshotIdentity('unknown', complete)).toBe('certified');

    const noSnapshot = parseWindowStateResult(canaryResult({ snapshot_id: undefined }), TARGET, CONTEXT);
    expect(projectSnapshotIdentity('unknown', noSnapshot)).toBe('unknown');

    const incomplete = parseWindowStateResult(canaryResult({ elements_complete: false }), TARGET, CONTEXT);
    expect(projectSnapshotIdentity('unknown', incomplete)).toBe('unknown');
  });
});
