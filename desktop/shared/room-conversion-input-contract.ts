import {z} from 'zod';
const reference=z.string().min(1).max(256).refine(value=>value.trim()===value&&!value.includes('\0'));
const revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const common={roomId:reference,messageId:reference,projectId:reference,expectedProjectRevision:revision};
/** This is the new capture envelope, not the existing legacy Room task wire.
 * Internal job/authority/generation fields are never accepted from a caller. */
export const ROOM_CONVERSION_CAPTURE_INPUT=z.discriminatedUnion('action',[
 z.object({action:z.literal('add_task'),...common,title:z.string().max(1024).optional(),brief:z.string().max(65536).optional()}).strict(),
 z.object({action:z.literal('add_revision'),...common,logicalArtifactId:reference,expectedArtifactRevision:revision,expectedReservationRevision:revision}).strict(),
]);
export type RoomConversionCaptureInput=z.infer<typeof ROOM_CONVERSION_CAPTURE_INPUT>;

/** Metadata acknowledgement only. It never means a B task was created. */
export const ROOM_CONVERSION_CAPTURE_REFERENCE=z.object({captureId:z.string().regex(/^main-room-conversion:[a-f0-9]{64}:[a-f0-9-]{36}$/),
 canonicalMessageId:z.string().regex(/^main-user-message:[a-f0-9]{64}$/),canonicalUserTaskId:z.string().regex(/^main-user-task:[a-f0-9]{64}$/),
 projectId:reference,roomId:reference,roomMessageId:reference}).strict();
export const ROOM_CONVERSION_CAPTURE_OUTPUT=z.object({capture:ROOM_CONVERSION_CAPTURE_REFERENCE,
 execution:z.object({state:z.literal('blocked'),reasonCode:z.enum(['CANDIDATE_WORKSPACE_UNAVAILABLE','REVISION_BASE_NOT_READY'])}).strict()}).strict();
export const ROOM_CONVERSION_OBSERVE_INPUT=z.object({captureId:ROOM_CONVERSION_CAPTURE_REFERENCE.shape.captureId}).strict();
export type RoomConversionCaptureOutput=z.infer<typeof ROOM_CONVERSION_CAPTURE_OUTPUT>;
export type RoomConversionCaptureReference=z.infer<typeof ROOM_CONVERSION_CAPTURE_REFERENCE>;
export type RoomConversionObserveInput=z.infer<typeof ROOM_CONVERSION_OBSERVE_INPUT>;
