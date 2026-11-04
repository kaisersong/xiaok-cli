import {z} from 'zod';
import {SCHEDULED_ROOM_TARGET_SCHEMA} from '../shared/scheduled-timed-action-ipc-contract.js';
import type {TimedActionExecutor} from './timed-action-types.js';

// Older room schedules persisted the complete host execution context. This
// compatibility path is only for SQLite reads, never new mutation inputs.
const legacyKeys = new Set([
  'roomId','logicalAgentId','bindingId','generation','runId','executorInstanceId',
  'contextScope','parentClaimId','projectMappingRevision','taskId','claimId',
  'protocolVersion','workspaceId','originHostId','hostPrincipal','hostIncarnation',
  'workspaceRevision','instructionsRevision','instructionsDigest','membershipRevision',
  'executionState','authorizationState','createdAt','acquireDigest','taskName',
  'roomSequence','updatedAt','effectiveCwd','localCommandsAllowed','workspaceRoot',
  'publishedInstructions','confirmedDecisions','artifactRefs','handoffRefs',
]);
const identifier = z.string().refine(value => value.trim().length > 0);
const legacyTargetSchema = SCHEDULED_ROOM_TARGET_SCHEMA.extend({
  roomId:identifier, logicalAgentId:identifier, bindingId:identifier,
  generation:z.number().int().positive().safe(),
  contextScope:z.object({kind:z.literal('room_only')}).strict(),
  claimId:identifier, runId:identifier, executorInstanceId:identifier, workspaceId:identifier,
}).passthrough();

export function decodeStoredRoomScheduledExecutor(executor:TimedActionExecutor):TimedActionExecutor {
  if (!executor || executor.kind !== 'agent_task' || !executor.roomTarget) return executor;
  const target = executor.roomTarget;
  if (SCHEDULED_ROOM_TARGET_SCHEMA.safeParse(target).success) return executor;
  if (Object.keys(target).some(key => !legacyKeys.has(key))) return executor;
  const legacy = legacyTargetSchema.safeParse(target);
  if (!legacy.success) return executor;
  const {roomId,logicalAgentId,bindingId,generation} = legacy.data;
  // Keep all outer fields so existing strict checks still reject bad records.
  return {...executor,roomTarget:{roomId,logicalAgentId,bindingId,generation}};
}
