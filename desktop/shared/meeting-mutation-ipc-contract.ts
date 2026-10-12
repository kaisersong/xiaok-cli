import { z } from 'zod';
import { MEETING_PERMISSION_OUTPUT_SCHEMA, MEETING_ASR_OUTPUT_SCHEMA, MEETING_MODELS_OUTPUT_SCHEMA } from './meeting-readonly-ipc-contract.js';
export const MEETING_MUTATION_METHODS = ['requestMicrophonePermission', 'saveAsrConfig', 'downloadModel', 'uninstallModel'] as const;
// Empty strings preserve deletion semantics. Credential-bearing URLs must not
// be returned as public endpoint/baseUrl fields.
export const MEETING_PUBLIC_ENDPOINT_SCHEMA = z.string().refine(value => {
  if (!value.trim()) return true;
  try { const url = new URL(value.trim()); return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
});
export const MEETING_MUTATION_ASR_OUTPUT_SCHEMA = MEETING_ASR_OUTPUT_SCHEMA.extend({
  volcengine: MEETING_ASR_OUTPUT_SCHEMA.shape.volcengine.extend({ endpoint: MEETING_PUBLIC_ENDPOINT_SCHEMA.optional() }),
  aliyun: MEETING_ASR_OUTPUT_SCHEMA.shape.aliyun.extend({ baseUrl: MEETING_PUBLIC_ENDPOINT_SCHEMA }),
});
export const MEETING_SAVE_INPUT_SCHEMA = z.object({
  defaultProvider: MEETING_ASR_OUTPUT_SCHEMA.shape.defaultProvider.optional(),
  volcengine: z.object({ appKey: z.string().optional(), accessKey: z.string().optional(), endpoint: MEETING_PUBLIC_ENDPOINT_SCHEMA.optional(), resourceId: z.string().optional(), clearAppKey: z.boolean().optional(), clearAccessKey: z.boolean().optional() }).strict().optional(),
  aliyun: z.object({ apiKey: z.string().optional(), baseUrl: MEETING_PUBLIC_ENDPOINT_SCHEMA.optional(), model: z.string().optional(), clearApiKey: z.boolean().optional() }).strict().optional(),
}).strict();
// Preserve the original input ?? {} save behavior; reject surplus transport arguments.
export const MEETING_MUTATION_INPUT_SCHEMAS = {
  requestMicrophonePermission: z.tuple([]),
  saveAsrConfig: z.union([z.tuple([]), z.tuple([MEETING_SAVE_INPUT_SCHEMA.nullish()])]),
  downloadModel: z.tuple([z.string()]),
  uninstallModel: z.tuple([z.string()]),
} as const;
const model = MEETING_MODELS_OUTPUT_SCHEMA.element.extend({ sizeBytes: z.number().finite().nonnegative(), localSizeBytes: z.number().finite().nonnegative().optional() }).strict();
export const MEETING_MODEL_ACTION_OUTPUT_SCHEMA = z.object({ ok: z.literal(true), model }).strict();
export const MEETING_MUTATION_OUTPUT_SCHEMAS = { requestMicrophonePermission: MEETING_PERMISSION_OUTPUT_SCHEMA, saveAsrConfig: MEETING_MUTATION_ASR_OUTPUT_SCHEMA, downloadModel: MEETING_MODEL_ACTION_OUTPUT_SCHEMA, uninstallModel: MEETING_MODEL_ACTION_OUTPUT_SCHEMA } as const;
export type MeetingMutationModelResult = z.infer<typeof MEETING_MODEL_ACTION_OUTPUT_SCHEMA>;
