export const KIMI_TERMINAL_BOUNDARY_CODE = 'KIMI_REASONING_TERMINAL_BOUNDARY_REQUIRED';

/** Protocol facts only: never attach provider content or tool argument fragments. */
export function createKimiTerminalBoundaryError(facts: {
  boundaryKind: 'missing_finish' | 'invalid_tool_call';
  sawOfficialReasoning: boolean;
  toolCallCount: number;
}): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(KIMI_TERMINAL_BOUNDARY_CODE), {
    name: 'KimiTerminalBoundaryError',
    code: KIMI_TERMINAL_BOUNDARY_CODE,
    retryable: facts.boundaryKind === 'missing_finish' && facts.sawOfficialReasoning,
    ...facts,
  });
}

export function isKimiTerminalBoundaryError(error: unknown): boolean {
  return error instanceof Error && (error as {code?: unknown}).code === KIMI_TERMINAL_BOUNDARY_CODE;
}

export function getKimiTerminalBoundaryDiagnostic(error: unknown) {
  if (!isKimiTerminalBoundaryError(error)) return undefined;
  const facts=error as {boundaryKind?: unknown;sawOfficialReasoning?: unknown;toolCallCount?: unknown};
  if (facts.boundaryKind !== 'missing_finish' && facts.boundaryKind !== 'invalid_tool_call') return undefined;
  return {code:KIMI_TERMINAL_BOUNDARY_CODE,boundaryKind:facts.boundaryKind,
    sawOfficialReasoning:facts.sawOfficialReasoning === true,
    toolCallCount:typeof facts.toolCallCount === 'number' && Number.isSafeInteger(facts.toolCallCount) && facts.toolCallCount >= 0 ? facts.toolCallCount : 0};
}
