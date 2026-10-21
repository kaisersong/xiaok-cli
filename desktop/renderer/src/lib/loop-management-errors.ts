export type LoopManagementFailureKind = 'unknown' | 'unavailable' | 'invalid';
const codes: ReadonlyArray<readonly [string, LoopManagementFailureKind]> = [
  ['loop_operation_unknown', 'unknown'], ['loop_projection_unavailable', 'unavailable'], ['loop_input_invalid', 'invalid'],
];
/** Electron adds a remote-method prefix to the original stable error message. */
export function loopManagementFailureKind(error: unknown): LoopManagementFailureKind | undefined {
  if (!(error instanceof Error)) return undefined;
  for (const [code, kind] of codes) {
    if (error.message === code || error.message.endsWith(`: ${code}`)) return kind;
  }
  return undefined;
}
export interface LoopManagementErrorLabels {
  loopOperationResultUnknown: string;
  loopProjectionUnavailable: string;
  loopInputInvalid: string;
}
export function loopManagementErrorMessage(error: unknown, labels: LoopManagementErrorLabels, fallback: string): string {
  const kind = loopManagementFailureKind(error);
  if (kind === 'unknown') return labels.loopOperationResultUnknown;
  if (kind === 'unavailable') return labels.loopProjectionUnavailable;
  if (kind === 'invalid') return labels.loopInputInvalid;
  return error instanceof Error ? error.message : fallback;
}
