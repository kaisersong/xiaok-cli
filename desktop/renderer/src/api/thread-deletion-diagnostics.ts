// Pure internal diagnostic DATA; no application, native, authority or SDK imports.
export const THREAD_DELETION_DIAGNOSTIC_PREFIX = 'XIAOK_THREAD_DELETE_PHASE ';
export const THREAD_DELETION_DIAGNOSTIC_LIMIT = 64;
export type ThreadDeletionPhase = 'delete_enter' | 'desktop_api_unavailable' | 'thread_read_start' | 'thread_read_done' | 'receipt_read_start' | 'receipt_read_done' | 'receipt_invalid' | 'thread_absent_pending' | 'recover_start' | 'recover_api_unavailable' | 'recover_rejected' | 'recover_resolved' | 'recover_context_mismatch' | 'recover_context_match' | 'reservation_start' | 'reservation_completed_tombstone' | 'reservation_identity_mismatch' | 'reservation_identity_match' | 'reservation_done' | 'main_expression_enter' | 'main_expression_resolved' | 'main_result_not_completed' | 'completion_cas_start' | 'completion_identity_mismatch' | 'completion_cas_done' | 'delete_return' | 'delete_reject';

export interface ThreadDeletionPhaseFact {
  readonly attemptOrdinal: number;
  readonly phase: ThreadDeletionPhase;
  readonly taskOrdinal?: number;
}
export interface ThreadDeletionDiagnosticConsole { debug?(message: string): void }
export interface ThreadDeletionDiagnosticBuffer {
  facts: ThreadDeletionPhaseFact[];
  overflow: number;
  parseFailures: number;
  readFailures: number;
}

export function emitThreadDeletionPhase(
  state: { active: boolean },
  readConsole: () => ThreadDeletionDiagnosticConsole,
  buildFact: () => ThreadDeletionPhaseFact,
): void {
  if (state.active) return;
  state.active = true;
  try {
    const receiver = readConsole();
    const callback = receiver.debug;
    if (typeof callback !== 'function') return;
    const { attemptOrdinal, phase, taskOrdinal } = buildFact();
    const text = THREAD_DELETION_DIAGNOSTIC_PREFIX + JSON.stringify({
      attemptOrdinal, phase, ...(taskOrdinal === undefined ? {} : { taskOrdinal }),
    });
    callback.call(receiver, text);
  } catch {
    // Synchronous diagnostic failures must not replace the business outcome.
  } finally {
    state.active = false;
  }
}

function isPhase(value: unknown): value is ThreadDeletionPhase {
  switch (value) {
    case 'delete_enter':
    case 'desktop_api_unavailable':
    case 'thread_read_start':
    case 'thread_read_done':
    case 'receipt_read_start':
    case 'receipt_read_done':
    case 'receipt_invalid':
    case 'thread_absent_pending':
    case 'recover_start':
    case 'recover_api_unavailable':
    case 'recover_rejected':
    case 'recover_resolved':
    case 'recover_context_mismatch':
    case 'recover_context_match':
    case 'reservation_start':
    case 'reservation_completed_tombstone':
    case 'reservation_identity_mismatch':
    case 'reservation_identity_match':
    case 'reservation_done':
    case 'main_expression_enter':
    case 'main_expression_resolved':
    case 'main_result_not_completed':
    case 'completion_cas_start':
    case 'completion_identity_mismatch':
    case 'completion_cas_done':
    case 'delete_return':
    case 'delete_reject':
      return true;
    default: return false;
  }
}

export function parseThreadDeletionPhase(text: string):
  | { kind: 'unrelated' }
  | { kind: 'invalid' }
  | { kind: 'fact'; fact: ThreadDeletionPhaseFact } {
  if (!text.startsWith(THREAD_DELETION_DIAGNOSTIC_PREFIX)) return { kind: 'unrelated' };
  try {
    const value: unknown = JSON.parse(text.slice(THREAD_DELETION_DIAGNOSTIC_PREFIX.length));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !('attemptOrdinal' in value) || typeof value.attemptOrdinal !== 'number'
      || !Number.isSafeInteger(value.attemptOrdinal) || value.attemptOrdinal < 1
      || !('phase' in value) || !isPhase(value.phase)
      || Object.keys(value).some(key => key !== 'attemptOrdinal' && key !== 'phase' && key !== 'taskOrdinal')) return { kind: 'invalid' };
    let taskOrdinal: number | undefined;
    if ('taskOrdinal' in value) {
      if (typeof value.taskOrdinal !== 'number' || !Number.isSafeInteger(value.taskOrdinal) || value.taskOrdinal < 0) return { kind: 'invalid' };
      taskOrdinal = value.taskOrdinal;
    }
    return { kind: 'fact', fact: Object.freeze({
      attemptOrdinal: value.attemptOrdinal, phase: value.phase,
      ...(taskOrdinal === undefined ? {} : { taskOrdinal }),
    }) };
  } catch { return { kind: 'invalid' }; }
}

export function collectThreadDeletionPhase(buffer: ThreadDeletionDiagnosticBuffer, text: string): void {
  const parsed = parseThreadDeletionPhase(text);
  if (parsed.kind === 'unrelated') return;
  if (parsed.kind === 'invalid') { buffer.parseFailures += 1; return; }
  if (buffer.facts.length >= THREAD_DELETION_DIAGNOSTIC_LIMIT) { buffer.overflow += 1; return; }
  buffer.facts.push(parsed.fact);
}
