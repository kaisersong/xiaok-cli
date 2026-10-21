/** Host-only capability installed on one tool execution context, never on model input. */
export interface ObservationCollectorPort {
  begin(input: {
    toolName: 'read' | 'bash';
    source: { filePath: string; offset: number; limit?: number } | { command: string; workdir: string };
  }): {
    append(text: string): void;
    finalize(facts: ObservationTerminalFacts): void;
  };
}

export interface ObservationTerminalFacts {
  executionState: 'terminal' | 'termination_pending';
  outcome?: 'success' | 'error' | 'timeout' | 'cancelled';
  incompleteReason?: string;
}

/** Archiving cannot alter, replay, or misreport the native operation. The owner
 * must fail closed on unpublished references, independently of tool success. */
export function beginToolObservation(port: ObservationCollectorPort | undefined,
  input: Parameters<ObservationCollectorPort['begin']>[0]) {
  let capture: ReturnType<ObservationCollectorPort['begin']> | undefined;
  let unavailable = false;
  let finalized = false;
  try { capture = port?.begin(input); } catch { unavailable = true; }
  return {
    append(text: string) {
      if (!capture || unavailable || finalized || !text) return;
      try { capture.append(text); } catch { unavailable = true; }
    },
    finalize(facts: ObservationTerminalFacts) {
      if (!capture || finalized) return;
      finalized = true;
      try { capture.finalize(unavailable ? { ...facts, incompleteReason: 'collector_unavailable' } : facts); }
      catch { /* Missing durable reference stays unavailable; do not fabricate success. */ }
    },
  };
}
