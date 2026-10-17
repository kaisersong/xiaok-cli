export interface KnowledgeErrorLabels { projectionUnavailable: string; operationUnknown: string; inputInvalid: string }
export function knowledgeErrorMessage(error: unknown, labels: KnowledgeErrorLabels, reading = false): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const hasCode = (code: string) => message === code || message.endsWith(`: ${code}`);
  if (hasCode('knowledge_input_invalid')) return labels.inputInvalid;
  if (hasCode('knowledge_projection_unavailable') || hasCode('knowledge_runtime_unavailable')) return labels.projectionUnavailable;
  if (hasCode('knowledge_operation_unknown')) return labels.operationUnknown;
  return reading ? labels.projectionUnavailable : labels.operationUnknown;
}
