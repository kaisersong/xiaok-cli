import { z } from 'zod';

const collectionInput = z.object({ collectionId: z.string().refine(value => value.trim().length > 0) }).passthrough();
export const RECORDER_WINDOW_INPUT_SCHEMAS = {
  meetingOpenRecorderWindow: z.tuple([collectionInput]),
  meetingSetRecorderWindowMode: z.tuple([z.object({ mode: z.enum(['workbench', 'compact', 'summary']) }).passthrough()]),
  meetingSetRecorderSessionState: z.tuple([z.object({ state: z.enum(['idle', 'recording', 'processing', 'summary']) }).passthrough()]),
  meetingNotifyRecorderSummaryReady: z.tuple([z.object({ title: z.string() }).passthrough()]),
  meetingNotifyRecordingSaved: z.tuple([collectionInput]),
  meetingCloseRecorderWindow: z.tuple([]),
} as const;
const basicReply = z.object({ ok: z.boolean(), error: z.string().optional() }).strict();
const notificationReply = basicReply.extend({ skipped: z.boolean().optional(), reason: z.string().optional() }).strict();
export const RECORDER_WINDOW_OUTPUT_SCHEMAS = {
  meetingOpenRecorderWindow: basicReply,
  meetingSetRecorderWindowMode: basicReply,
  meetingSetRecorderSessionState: basicReply,
  meetingNotifyRecorderSummaryReady: notificationReply,
  meetingNotifyRecordingSaved: basicReply,
  meetingCloseRecorderWindow: basicReply,
} as const;
export type RecorderWindowIpcMethod = keyof typeof RECORDER_WINDOW_INPUT_SCHEMAS;
export type RecorderWindowReply = z.infer<typeof basicReply>;
export type RecorderWindowNotificationReply = z.infer<typeof notificationReply>;
export type RecorderWindowMode = 'workbench' | 'compact' | 'summary';
export type RecorderWindowSessionState = 'idle' | 'recording' | 'processing' | 'summary';
