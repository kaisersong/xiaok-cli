/** Scheduler success acknowledges dispatch, never a runtime terminal result. */
export function scheduledRunPresentation(input: { status: 'success' | 'failed' | 'skipped'; runtimeTaskId?: string }) {
  return {
    completed: false,
    dispatchStatus: input.status,
    runtimeState: input.status === 'success' && input.runtimeTaskId ? 'accepted' as const : 'not_started' as const,
  };
}
