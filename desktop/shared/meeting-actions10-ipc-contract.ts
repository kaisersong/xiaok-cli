// UNREVIEWED CANDIDATE target desktop/shared/meeting-actions10-ipc-contract.ts
import { z } from 'zod';
import { KB_SOURCE_SCHEMA, KB_OUTPUT_FACT_SCHEMA } from './knowledge-ipc-contract.js';
export const MEETING_ACTIONS10_METHODS = ['pickAudioFile','saveRecordedAudio','transcribePreview','live:start','live:pushAudio','live:finish','live:cancel','processRecording','draftRecording','saveTranscript'] as const;
export type MeetingActions10Method = typeof MEETING_ACTIONS10_METHODS[number];
// Capture rejects executable data before this schema. Preserve existing safe-data
// scalar coercion/default/false-result behavior; do not tighten business limits.
const legacyNumber = z.custom<number>(value => typeof value === 'number');
type Fact = string | number | bigint | boolean | null | undefined | Fact[] | { [key: string]: Fact };
const fact: z.ZodType<Fact> = z.lazy(() => z.union([z.string(),legacyNumber,z.bigint(),z.boolean(),z.null(),z.undefined(),z.array(fact),z.record(z.string(),fact)]));
const record = (fields: readonly string[]) => z.object(Object.fromEntries(fields.map(field => [field,fact.optional()]))).passthrough();
const audio = record(['title','wavBase64']);
const transcriber = ['engine','model','language'] as const;
const preview = record(['title','wavBase64',...transcriber]);
const recording = record(['collectionId','title','audioFilePath','scenario',...transcriber]);
const draft = record(['title','audioFilePath','scenario','transcript','segments',...transcriber]);
const transcript = record(['collectionId','title','audioFilePath','transcript']);
// A malformed but serializable payload is still the old producer's responsibility.
// Named object shapes document the full known contract without deleting legacy
// undefined/null/scalar/array payloads which previously yielded business false.
const tuple = (shape: z.ZodTypeAny) => z.union([z.tuple([]),z.tuple([z.union([shape,fact])])]);
export const MEETING_ACTIONS10_INPUT_SCHEMAS = {
 pickAudioFile:z.tuple([]),saveRecordedAudio:tuple(audio),transcribePreview:tuple(preview),
 'live:start':tuple(record(['engine','sampleRate','language'])),
 'live:pushAudio':tuple(record(['sessionId','pcmBase64'])),
 'live:finish':tuple(record(['sessionId'])),'live:cancel':tuple(record(['sessionId'])),
 processRecording:tuple(recording),draftRecording:tuple(draft),saveTranscript:tuple(transcript),
} as const;
const segment = z.object({start:legacyNumber,end:legacyNumber,text:z.string()}).strict();
const sales = z.object({customerNeeds:z.array(z.string()),painPoints:z.array(z.string()),competitors:z.array(z.string()),commitments:z.array(z.string()),nextSteps:z.array(z.string()),amountsAndDates:z.array(z.string()),contacts:z.array(z.string())}).strict();
export const MEETING_ACTIONS10_SUMMARY_SCHEMA = z.object({title:z.string(),scenario:z.enum(['discussion','meeting','sales']).optional(),overview:z.array(z.string()).optional(),attendees:z.array(z.string()),decisions:z.array(z.string()),actionItems:z.array(z.object({owner:z.string().optional(),text:z.string()}).strict()),sales:sales.optional()}).strict();
export const MEETING_ACTIONS10_MEETING_SCHEMA = z.object({id:z.string(),sourceId:z.string(),status:z.enum(['recording','paused','interrupted','stopping','transcribing','transcribed','summarizing','summary_blocked_by_privacy','saved','failed','cancelled']),title:z.string(),audioFilePath:z.string(),audioRetention:z.enum(['kept','deleted']),summaryProvider:z.string(),summaryProviderHash:z.string(),failureReason:z.string(),startedAt:legacyNumber,endedAt:legacyNumber.nullable(),updatedAt:legacyNumber}).strict();
export const MEETING_ACTIONS10_CHUNK_SCHEMA = z.object({id:z.string(),sourceId:z.string(),collectionId:z.string(),idx:legacyNumber,text:z.string(),charStart:legacyNumber,charEnd:legacyNumber,pageIndex:legacyNumber.nullable(),slideIndex:legacyNumber.nullable(),sheetName:z.string().nullable(),cellRange:z.string().nullable(),embeddingStatus:z.enum(['pending','embedding','embedded','failed']),embeddingError:z.string(),metadata:z.record(z.string(),KB_OUTPUT_FACT_SCHEMA),createdAt:legacyNumber}).strict();
const ok = z.object({ok:z.literal(true)}).strict();
const error = (code: z.ZodTypeAny) => z.object({ok:z.literal(false),error:code}).strict();
const audioError = error(z.enum(['missing_audio','audio_too_large','invalid_wav']));
const liveError = error(z.string());
const serviceError = z.union([
 error(z.literal('agent_meeting_write_forbidden')),
 z.object({ok:z.literal(false),error:z.enum(['transcriber_unavailable','transcription_failed','summary_service_unavailable','summary_blocked_by_privacy']),meeting:MEETING_ACTIONS10_MEETING_SCHEMA.optional(),reason:z.string().optional()}).strict(),
]);
const draftError = z.union([
 error(z.literal('agent_meeting_write_forbidden')),
 z.object({ok:z.literal(false),error:z.enum(['transcriber_unavailable','transcription_failed','summary_service_unavailable','summary_blocked_by_privacy']),reason:z.string().optional()}).strict(),
]);
const processResult = z.union([z.object({ok:z.literal(true),meeting:MEETING_ACTIONS10_MEETING_SCHEMA,source:KB_SOURCE_SCHEMA,chunks:z.array(MEETING_ACTIONS10_CHUNK_SCHEMA),summary:MEETING_ACTIONS10_SUMMARY_SCHEMA}).strict(),serviceError]);
const draftResult = z.union([z.object({ok:z.literal(true),suggestedTitle:z.string(),audioFilePath:z.string(),transcript:z.string(),segments:z.array(segment),transcriptStatus:z.enum(['ready','unavailable','failed','interrupted']).optional(),summary:MEETING_ACTIONS10_SUMMARY_SCHEMA,summaryMarkdown:z.string()}).strict(),draftError]);
const saveResult = z.union([z.object({ok:z.literal(true),meeting:MEETING_ACTIONS10_MEETING_SCHEMA,source:KB_SOURCE_SCHEMA,chunks:z.array(MEETING_ACTIONS10_CHUNK_SCHEMA)}).strict(),error(z.enum(['agent_meeting_write_forbidden','transcript_required']))]);
export const MEETING_ACTIONS10_OUTPUT_SCHEMAS = {
 pickAudioFile:z.string().nullable(),
 saveRecordedAudio:z.union([z.object({ok:z.literal(true),filePath:z.string()}).strict(),audioError]),
 transcribePreview:z.union([z.object({ok:z.literal(true),text:z.string(),segments:z.array(segment)}).strict(),error(z.string())]),
 'live:start':z.union([z.object({ok:z.literal(true),sessionId:z.string()}).strict(),liveError]),
 'live:pushAudio':z.union([ok,liveError]),'live:finish':z.union([ok,liveError]),'live:cancel':z.union([ok,liveError]),
 processRecording:processResult,draftRecording:draftResult,saveTranscript:saveResult,
} as const;
export const MEETING_ACTIONS10_LIVE_UPDATE_SCHEMA = z.object({sessionId:z.string(),sentenceId:z.string(),start:legacyNumber,end:legacyNumber,text:z.string(),final:z.boolean()}).strict();
export type MeetingActions10Replies = {[K in MeetingActions10Method]: z.infer<typeof MEETING_ACTIONS10_OUTPUT_SCHEMAS[K]>};
export type MeetingActions10LiveUpdate = z.infer<typeof MEETING_ACTIONS10_LIVE_UPDATE_SCHEMA>;
