import { z } from 'zod';
import { KSWARM_PROJECT_FACT_SCHEMA } from './kswarm-project-agent-ipc-contract.js';

/** Historical display data never supplies caller/actor/execution authority. */
export type LegacyRoomFactData = string | number | boolean | null | undefined
  | LegacyRoomFactData[] | { [key: string]: LegacyRoomFactData };
const facts: z.ZodType<LegacyRoomFactData> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.undefined(), z.array(facts), z.record(z.string(), facts),
]));
const text = z.string(), number = z.number().finite();
const optionalText = text.optional(), optionalNumber = number.optional();
const dataObject = z.record(z.string(), facts);
const actor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: text, logicalAgentId: text.nullable().optional(), service: text.nullable().optional() }).catchall(facts),
  z.object({ kind: z.literal('agent'), logicalAgentId: text, userId: text.nullable().optional(), service: text.nullable().optional() }).catchall(facts),
  z.object({ kind: z.literal('system'), service: text, userId: text.nullable().optional(), logicalAgentId: text.nullable().optional() }).catchall(facts),
]);
const subject = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: text, logicalAgentId: text.nullable().optional(), service: text.nullable().optional() }).catchall(facts),
  z.object({ kind: z.literal('agent'), logicalAgentId: text, userId: text.nullable().optional(), service: text.nullable().optional() }).catchall(facts),
]);
export const ROOM_SEMANTIC_CONTEXT_SCOPE_SCHEMA = z.object({ kind: text, projectId: optionalText }).catchall(facts);
export const ROOM_SEMANTIC_FACT_SCHEMA = z.object({
  roomId: text, title: text, description: optionalText, status: text, origin: optionalText,
  createdBy: actor.optional(), revision: optionalNumber, discussionEpoch: optionalNumber,
  createdAt: optionalText, updatedAt: optionalText, archivedAt: optionalText, deletedAt: optionalText,
  deletedBy: actor.optional(), lastActivityAt: optionalText, requiredProtocol: text.nullable().optional(),
}).catchall(facts);
const member = z.object({ roomId: optionalText, subject, role: optionalText, status: text,
  addedBy: actor.optional(), membershipRevision: optionalNumber, addedAt: optionalText,
  removedAt: optionalText, alias: optionalText, displayName: optionalText }).catchall(facts);
const sourceRef = z.object({
  kind: text.nullable().optional(), attachments: z.array(z.object({ filePath: text, name: text }).catchall(facts)).optional(),
  projectId: text.nullable().optional(), projectRevision: number.nullable().optional(), eventType: text.nullable().optional(), eventKind: text.nullable().optional(),
  projectionEventId: text.nullable().optional(), taskId: text.nullable().optional(), artifactId: text.nullable().optional(),
  artifact: z.object({ projectId: text.nullable().optional(), filename: text.nullable().optional(), kind: text.nullable().optional(), mimeType: text.nullable().optional() }).catchall(facts).optional(),
}).catchall(facts);
export const ROOM_SEMANTIC_MESSAGE_SCHEMA = z.object({
  messageId: text, roomId: optionalText, threadId: optionalText, sender: actor, kind: text,
  text: optionalText, replyToMessageId: optionalText, contextScope: ROOM_SEMANTIC_CONTEXT_SCOPE_SCHEMA.nullable().optional(),
  mentions: z.array(z.union([z.null(), z.undefined(), z.string(), number, z.boolean(), z.array(facts),
    z.object({ kind: optionalText, logicalAgentId: text.nullable().optional(), userId: text.nullable().optional() }).catchall(facts),
  ])).optional(), responsePolicy: optionalText, sourceRef: sourceRef.nullable().optional(), idempotencyKey: optionalText,
  roomSequence: optionalNumber, discussionEpoch: optionalNumber, createdAt: optionalText,
}).catchall(facts);
const capability = z.object({ logicalAgentId: text,
  mode: z.enum(['workspace_worker', 'discussion_only', 'discussion_unavailable']), runtime: optionalText, reason: optionalText }).catchall(facts);
const unavailable = z.object({ logicalAgentId: text, reason: optionalText }).catchall(facts);
const wake = z.object({ status: z.enum(['queued', 'unavailable']), roomMessageId: text,
  logicalAgentIds: z.array(text), unavailable: z.array(unavailable).optional() }).catchall(facts);
const cursor = z.object({ roomId: text, recipientKey: text, lastSeenRoomSequence: number }).catchall(facts);
const project = KSWARM_PROJECT_FACT_SCHEMA.extend({ linkedBy: actor.nullable().optional() });
const preparation = z.object({ state: optionalText }).catchall(facts);
const planningStart = z.object({ sent: z.boolean(), reason: optionalText }).catchall(facts);
const roomProjection = z.object({ ok: z.boolean(), published: optionalNumber, suppressed: optionalNumber,
  code: optionalText }).catchall(facts);
// All actual broker errors and both new honest wire classifications are allowed.
const failureCode = z.union([z.literal('room_operation_unknown'), z.literal('room_projection_unavailable'), text]);
const base = z.object({ ok: z.boolean().optional(), code: failureCode.optional(), error: optionalText,
  message: z.union([text, ROOM_SEMANTIC_MESSAGE_SCHEMA]).optional(), degraded: z.boolean().optional(),
  field: optionalText, limit: optionalNumber, expectedRoomRevision: optionalNumber, actualRoomRevision: optionalNumber,
  status: optionalText, mutationId: optionalText, cause: optionalText, replyToMessageId: optionalText,
  messageId: optionalText, declared: ROOM_SEMANTIC_CONTEXT_SCOPE_SCHEMA.nullable().optional(),
  parent: ROOM_SEMANTIC_CONTEXT_SCOPE_SCHEMA.nullable().optional(), details: dataObject.optional(),
}).catchall(facts);
const readers = new Set(['listRooms', 'getRoom']);
function result<T extends z.ZodRawShape>(method: string, shape: T, required: string[]) {
  return base.extend(shape).superRefine((value, context) => {
    if (value.ok === true) {
      for (const key of required) if (value[key] === undefined)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'room_success_missing_' + key });
      if (method === 'sendMessage' && (value.message === null || typeof value.message !== 'object'))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'room_success_message_invalid' });
      return;
    }
    if ((value.ok !== false && value.ok !== undefined) || (typeof value.code !== 'string' && typeof value.error !== 'string'))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'room_error_envelope_invalid' });
    if ((value.code === 'room_operation_unknown' && readers.has(method))
      || (value.code === 'room_projection_unavailable' && !readers.has(method)))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'room_error_method_invalid' });
  });
}
const change = { room: ROOM_SEMANTIC_FACT_SCHEMA.optional(), members: z.array(member).optional(),
  reused: z.boolean().optional(), roomSequence: optionalNumber };
export const ROOM_SEMANTIC_OUTPUT_SCHEMAS = Object.freeze({
  listRooms: result('listRooms', { rooms: z.array(ROOM_SEMANTIC_FACT_SCHEMA).optional() }, ['rooms']),
  getRoom: result('getRoom', { room: ROOM_SEMANTIC_FACT_SCHEMA.optional(), members: z.array(member).optional(),
    messages: z.array(ROOM_SEMANTIC_MESSAGE_SCHEMA).optional(), projects: z.array(project).optional(),
    executionCapabilities: z.array(capability).optional() }, ['room', 'members', 'messages', 'projects']),
  createRoom: result('createRoom', change, ['room', 'members']),
  archiveRoom: result('archiveRoom', change, ['room']),
  deleteRoom: result('deleteRoom', { roomId: optionalText, deletedAt: optionalText }, ['roomId', 'deletedAt']),
  updateRoomMembers: result('updateRoomMembers', change, ['room', 'members']),
  sendMessage: result('sendMessage', { message: z.union([text, ROOM_SEMANTIC_MESSAGE_SCHEMA]).optional(), wake: wake.optional(),
    unavailable: z.array(unavailable).optional() }, ['message']),
  markRoomSeen: result('markRoomSeen', { cursor: cursor.optional() }, ['cursor']),
  cancelDiscussion: result('cancelDiscussion', change, ['room']),
  createProjectFromRoom: result('createProjectFromRoom', { project: project.optional(), preparation: preparation.nullable().optional(),
    planningStart: planningStart.optional(), roomProjection: roomProjection.optional(), reused: z.boolean().optional() }, ['project']),
  createTaskFromRoomMessage: result('createTaskFromRoomMessage', { taskIds: z.array(text).optional() }, ['taskIds']),
});
const roomId = { roomId: text }, revision = { expectedRoomRevision: optionalNumber };
const create = z.object({ title: optionalText, description: optionalText, goal: optionalText,
  memberAgentIds: z.array(text).optional(), clientRequestKey: optionalText }).strict();
const archive = z.object({ ...roomId, ...revision }).strict();
const remove = z.object({ ...roomId, expectedRoomRevision: number }).strict();
const members = z.object({ ...roomId, ...revision, addAgentIds: z.array(text).optional(), removeAgentIds: z.array(text).optional(),
  aliasChanges: z.array(z.object({ logicalAgentId: text, alias: text }).strict()).optional() }).strict();
const send = z.object({ ...roomId, text, filePaths: z.array(text).optional(), idempotencyKey: optionalText,
  replyToMessageId: optionalText, contextScope: ROOM_SEMANTIC_CONTEXT_SCOPE_SCHEMA.optional() }).strict();
const seen = z.object({ ...roomId, lastSeenRoomSequence: optionalNumber }).strict();
const cancel = z.object({ ...roomId, ...revision, requestId: optionalText }).strict();
const makeProject = z.object({ ...roomId, name: optionalText, goal: optionalText, poAgentId: optionalText,
  memberAgentIds: z.array(text).optional(), sourceMessageIds: z.array(text).optional(), clientRequestKey: optionalText }).strict();
const makeTask = z.object({ ...roomId, messageId: text, projectId: text, title: optionalText, brief: optionalText }).strict();
export const ROOM_SEMANTIC_INPUT_SCHEMAS = Object.freeze({ listRooms: z.tuple([]), getRoom: z.tuple([text]),
  createRoom: z.tuple([create]), archiveRoom: z.tuple([archive]), deleteRoom: z.tuple([remove]),
  updateRoomMembers: z.tuple([members]), sendMessage: z.tuple([send]), markRoomSeen: z.tuple([seen]),
  cancelDiscussion: z.tuple([cancel]), createProjectFromRoom: z.tuple([makeProject]), createTaskFromRoomMessage: z.tuple([makeTask]) });
export type RoomSemanticMethod = keyof typeof ROOM_SEMANTIC_INPUT_SCHEMAS;
export type RoomSemanticWireInput = unknown[];
export type RoomCreateInput = z.infer<typeof create>;
export type RoomArchiveInput = z.infer<typeof archive>;
export type RoomDeleteInput = z.infer<typeof remove>;
export type RoomMembersInput = z.infer<typeof members>;
export type RoomSendInput = z.infer<typeof send>;
export type RoomSeenInput = z.infer<typeof seen>;
export type RoomCancelInput = z.infer<typeof cancel>;
export type RoomProjectCreateInput = z.infer<typeof makeProject>;
export type RoomTaskCreateInput = z.infer<typeof makeTask>;
export type RoomListResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.listRooms>;
export type RoomSnapshotDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.getRoom>;
export type RoomCreateResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.createRoom>;
export type RoomArchiveResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.archiveRoom>;
export type RoomDeleteResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.deleteRoom>;
export type RoomMembersResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.updateRoomMembers>;
export type RoomSendResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.sendMessage>;
export type RoomSeenResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.markRoomSeen>;
export type RoomCancelResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.cancelDiscussion>;
export type RoomProjectCreateResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.createProjectFromRoom>;
export type RoomTaskCreateResultDto = z.infer<typeof ROOM_SEMANTIC_OUTPUT_SCHEMAS.createTaskFromRoomMessage>;
