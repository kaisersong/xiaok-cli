export interface RecorderWindowErrorLabels { meetingRecorderInputInvalid: string; meetingRecorderOperationUnknown: string }
/** Only known data codes influence labels; arbitrary errors are never rendered. */
export function recorderWindowErrorMessage(reason: unknown, labels: RecorderWindowErrorLabels): string {
  return typeof reason === 'string' && ['unauthorized_sender', 'invalid_mode', 'invalid_state', 'collection_id_required', 'recorder_input_invalid'].includes(reason)
    ? labels.meetingRecorderInputInvalid : labels.meetingRecorderOperationUnknown;
}
