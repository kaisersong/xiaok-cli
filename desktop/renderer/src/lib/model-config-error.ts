export interface ModelConfigErrorLabels { operationUnknown: string; inputInvalid: string; unavailable: string }
/** Translate only this IPC family's stable failures; preserve existing business errors. */
export function modelConfigErrorMessage(error: unknown, labels: ModelConfigErrorLabels): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const hasCode = (code: string) => message === code || message.endsWith(`: ${code}`);
  if (hasCode('model_config_operation_unknown')) return labels.operationUnknown;
  if (hasCode('model_config_input_invalid')) return labels.inputInvalid;
  if (['model_config_runtime_unavailable', 'model_config_projection_unavailable', 'model_config_actor_invalid', 'model_config_user_required'].some(hasCode)) return labels.unavailable;
  return undefined;
}
