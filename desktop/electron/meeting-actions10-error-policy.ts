// UNREVIEWED CANDIDATE target desktop/electron/meeting-actions10-error-policy.ts
import { types } from 'node:util';
// Source-defined fixed diagnostics. Unknown upstream text never becomes a public
// error/reason/failureReason; successful transcript and metadata are untouched.
const allowed = new Set(["agent_meeting_write_forbidden", "aliyun_asr_invalid_response", "aliyun_asr_not_configured", "aliyun_asr_result_download_failed", "aliyun_asr_submit_failed", "aliyun_asr_task_query_failed", "aliyun_asr_timeout", "aliyun_asr_upload_policy_failed", "aliyun_live_audio_buffer_overflow", "aliyun_live_cancelled", "aliyun_live_connect_failed", "aliyun_live_connection_closed", "aliyun_live_finish_timeout", "aliyun_live_invalid_audio", "aliyun_live_invalid_base_url", "aliyun_live_invalid_sample_rate", "aliyun_live_not_started", "aliyun_live_session_not_found", "audio_too_large", "empty_transcription", "invalid_transcriber_output", "invalid_wav", "local_model_required", "meeting_actions10_input_invalid", "meeting_actions10_operation_failed", "meeting_actions10_projection_unavailable", "meeting_live_failed", "meeting_live_invalid_audio", "meeting_live_provider_not_supported", "meeting_live_session_not_found", "microphone_unavailable", "missing_audio", "preview_transcription_failed", "provider_changed", "sherpa_onnx_model_incomplete", "sherpa_onnx_model_not_downloaded", "sherpa_onnx_runtime_missing", "sherpa_onnx_transcribe_timeout", "summary_blocked_by_privacy", "summary_service_unavailable", "transcriber_unavailable", "transcript_required", "transcription_failed", "transcription_interrupted", "transcription_url", "volcengine_asr_invalid_response", "volcengine_asr_not_configured", "volcengine_live_audio_buffer_overflow", "volcengine_live_cancelled", "volcengine_live_connect_failed", "volcengine_live_connection_closed", "volcengine_live_finish_timeout", "volcengine_live_invalid_audio", "volcengine_live_invalid_endpoint", "volcengine_live_invalid_packet_duration", "volcengine_live_invalid_response", "volcengine_live_invalid_sample_rate", "volcengine_live_not_started", "volcengine_live_session_not_found", "whisper_model_incomplete", "whisper_model_not_downloaded"]);
export function safeMeeting10Code(value: unknown, fallback: string): string {
 if (typeof value !== 'string') return fallback;
 if (allowed.has(value)) return value;
 if (/^(?:volcengine_asr_failed|aliyun_asr_upload_failed|aliyun_asr_http_failed):[0-9]+$/.test(value)) return value;
 if (/^(?:aliyun_live_task_failed|volcengine_live_service_failed):[A-Za-z0-9_.-]{1,80}$/.test(value)) return value;
 return fallback;
}
export function safeMeeting10Thrown(error: unknown, fallback: string): string {
 if (!error || typeof error !== 'object' || types.isProxy(error)) return fallback;
 const message = Object.getOwnPropertyDescriptor(error,'message');
 return message && 'value' in message ? safeMeeting10Code(message.value,fallback) : fallback;
}
export function meeting10Rejection(error: unknown): Error {
 const code = safeMeeting10Thrown(error,'meeting_actions10_operation_failed');
 const descriptor = error && typeof error === 'object' && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error,'message') : undefined;
 return types.isNativeError(error) && descriptor && 'value' in descriptor && descriptor.value === code ? error as Error : Error(code);
}
export function projectMeeting10Failure(method: string,value: unknown): unknown {
 const dto = value as Record<string,unknown>;
 if (!dto || typeof dto !== 'object' || dto.ok !== false) return value;
 const fallback = method.startsWith('live:') ? 'meeting_live_failed' : method==='transcribePreview' ? 'preview_transcription_failed' : 'transcription_failed';
 const publicError = safeMeeting10Code(dto.error,fallback);
 const projected = {...dto,error:publicError};
 if (Object.hasOwn(dto,'reason')) Object.assign(projected,{reason:safeMeeting10Code(dto.reason,publicError)});
 if (dto.meeting && typeof dto.meeting==='object') Object.assign(projected,{meeting:{...dto.meeting as Record<string,unknown>,failureReason:(dto.meeting as Record<string,unknown>).failureReason===''?'':safeMeeting10Code((dto.meeting as Record<string,unknown>).failureReason,publicError)}});
 return projected;
}
