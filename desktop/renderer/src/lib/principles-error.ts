export interface PrinciplesErrorLabels { operationUnknown: string; inputInvalid: string; projectionUnavailable: string }
/** Preserve existing business errors while localizing this family's stable failures. */
export function principlesErrorMessage(error: unknown, labels: PrinciplesErrorLabels): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const hasCode = (code: string) => message === code || message.endsWith(`: ${code}`);
  if (hasCode('principles_operation_unknown')) return labels.operationUnknown;
  if (hasCode('principles_input_invalid')) return labels.inputInvalid;
  if (['principles_projection_unavailable', 'principles_runtime_unavailable', 'principles_user_required'].some(hasCode)) return labels.projectionUnavailable;
  return undefined;
}
