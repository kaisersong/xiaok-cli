/** Original pure persistent scalar contracts. These declarations grant no authority. */
type MultiAgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated';
type MultiAgentApprovalReason = 'user_denied' | 'approval_deadline' | 'actor_deadline' | 'actor_aborted'
  | 'permission_revoked' | 'descriptor_changed' | 'scope_disposed' | 'factory_disposed' | 'turn_sealed' | 'restart' | 'approval_persistence_failed';
interface MultiAgentApprovalDurable {
  approvalId: string; bootId: string; profileId: string; workspaceId: string; threadId: string; groupId: string;
  agentId: string; turn: number; turnId: string; sourceTaskId?: string;
  canonicalName: string; toolName: string; cwd: string; ownerId: string; slotId: string; capabilityId: string;
  revision: number; permissionRevision: number; invocationNonce: string; inputSha256: string; inputByteLength: number;
  issuedAt: number; minDeadlineAt: number; status: MultiAgentApprovalStatus; persistenceState: 'confirmed' | 'unknown'; reason?: MultiAgentApprovalReason;
}
interface ApprovalRequestOperation {
  groupId: string; operationId: string; requestHash: string; command: 'approval_request';
  applyState: 'prepared' | 'applied' | 'unknown'; result: { approval: MultiAgentApprovalDurable };
}
interface WorkspaceExecutionAuthorizationRow {
  profileId: string; workspaceId: string; permissionRevision: number; executionAllowed: boolean; updatedAt: number;
  actorId: string | null; lastReceiptJson: string | null;
}
interface MultiAgentApprovalEventPayload {
  approvalId: string; status: MultiAgentApprovalStatus; persistenceState: 'confirmed' | 'unknown'; reason?: MultiAgentApprovalReason;
}
import {encodeMultiAgentRow} from './row-codec.js';
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
export const APPROVAL_STATUSES: readonly MultiAgentApprovalStatus[] = ['pending', 'approved', 'denied', 'expired', 'invalidated'];
export const APPROVAL_REASONS: readonly MultiAgentApprovalReason[] = ['user_denied', 'approval_deadline', 'actor_deadline', 'actor_aborted',
  'permission_revoked', 'descriptor_changed', 'scope_disposed', 'factory_disposed', 'turn_sealed', 'restart', 'approval_persistence_failed'];
const APPROVAL_FIELDS = ['approvalId', 'bootId', 'profileId', 'workspaceId', 'threadId', 'groupId', 'agentId', 'turn', 'turnId', 'sourceTaskId',
  'canonicalName', 'toolName', 'cwd', 'ownerId', 'slotId', 'capabilityId', 'revision', 'permissionRevision', 'invocationNonce', 'inputSha256',
  'inputByteLength', 'issuedAt', 'minDeadlineAt', 'status', 'persistenceState', 'reason'];
function scalarRecord(value: unknown, fields: readonly string[], required = fields): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('invalid multi-agent scalar record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !fields.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))
    || required.some(key => !descriptors[key] || descriptors[key].value === undefined)) throw new Error('invalid multi-agent scalar fields');
  return value as Record<string, unknown>;
}
export function boundedString(value: unknown, maximum = 256): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('invalid multi-agent scalar string');
}
export function safeInteger(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error('invalid multi-agent scalar integer');
}
export function captureApprovalOperation(value: unknown): ApprovalRequestOperation {
  const operation = scalarRecord(value, ['groupId', 'operationId', 'requestHash', 'command', 'applyState', 'result']);
  if (operation.command !== 'approval_request' || typeof operation.applyState !== 'string' || !['prepared', 'applied', 'unknown'].includes(operation.applyState)) throw new Error('invalid approval operation');
  for (const field of ['groupId', 'operationId', 'requestHash']) boundedString(operation[field]);
  const result = scalarRecord(operation.result, ['approval']);
  const approval = scalarRecord(result.approval, APPROVAL_FIELDS, APPROVAL_FIELDS.filter(key => key !== 'sourceTaskId' && key !== 'reason'));
  for (const field of ['approvalId', 'bootId', 'profileId', 'workspaceId', 'threadId', 'groupId', 'agentId', 'turnId', 'canonicalName', 'toolName',
    'ownerId', 'slotId', 'capabilityId', 'invocationNonce']) boundedString(approval[field]);
  if (approval.sourceTaskId !== undefined) boundedString(approval.sourceTaskId);
  boundedString(approval.cwd, 4096);
  for (const field of ['turn', 'permissionRevision', 'inputByteLength', 'issuedAt', 'minDeadlineAt']) safeInteger(approval[field]);
  safeInteger(approval.revision, 1);
  if ((approval.inputByteLength as number) > MAX_CONTENT_BYTES || (approval.minDeadlineAt as number) < (approval.issuedAt as number)
    || typeof approval.inputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(approval.inputSha256)
    || !APPROVAL_STATUSES.includes(approval.status as MultiAgentApprovalStatus)
    || typeof approval.persistenceState !== 'string' || !['confirmed', 'unknown'].includes(approval.persistenceState)
    || approval.reason !== undefined && !APPROVAL_REASONS.includes(approval.reason as MultiAgentApprovalReason)
    || approval.groupId !== operation.groupId || operation.operationId !== `approval-request:${approval.approvalId}`) throw new Error('invalid approval scalar metadata');
  const json = encodeMultiAgentRow(operation);
  if (Buffer.byteLength(json) > 4096) throw new Error('approval_metadata_too_large');
  return JSON.parse(json) as ApprovalRequestOperation;
}

/**
 * Admission invariant shared by transport and every pending-row writer. A
 * visible request must fit all legal finalizations, including their reason.
 * Read/recovery capture deliberately keeps the original current-row contract.
 */
export function captureApprovalOperationForWrite(value: unknown): ApprovalRequestOperation {
  const operation = captureApprovalOperation(value), approval = operation.result.approval;
  if (approval.status === 'pending') {
    for (const status of APPROVAL_STATUSES) {
      if (status === 'pending') continue;
      for (const reason of [undefined, ...APPROVAL_REASONS]) {
        captureApprovalOperation({ ...operation, applyState: 'applied', result: { approval: {
          ...approval, status, persistenceState: 'confirmed', reason,
        } } });
      }
    }
  }
  return operation;
}

export function captureWorkspaceAuthorization(value: unknown): WorkspaceExecutionAuthorizationRow {
  const row = { ...scalarRecord(value, ['profileId', 'workspaceId', 'permissionRevision', 'executionAllowed', 'updatedAt', 'actorId', 'lastReceiptJson']) };
  boundedString(row.profileId); boundedString(row.workspaceId); safeInteger(row.permissionRevision); safeInteger(row.updatedAt);
  if (typeof row.executionAllowed !== 'boolean') throw new Error('invalid workspace authorization allowed value');
  if (row.actorId === null || row.lastReceiptJson === null) {
    if (row.actorId !== null || row.lastReceiptJson !== null || row.permissionRevision !== 0 || row.executionAllowed !== true) throw new Error('invalid initial workspace authorization');
  } else {
    boundedString(row.actorId); boundedString(row.lastReceiptJson, 4096);
    const envelope = scalarRecord(JSON.parse(row.lastReceiptJson), ['requestHash', 'receipt']);
    if (typeof envelope.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.requestHash)) throw new Error('invalid workspace authorization request hash');
    const receipt = scalarRecord(envelope.receipt, ['operationId', 'state', 'permissionRevision', 'executionAllowed', 'persistenceState', 'outcome', 'error'],
      ['operationId', 'state', 'permissionRevision', 'executionAllowed', 'persistenceState']);
    boundedString(receipt.operationId);
    if (receipt.state !== 'applied' || receipt.persistenceState !== 'confirmed' || receipt.permissionRevision !== row.permissionRevision
      || receipt.executionAllowed !== row.executionAllowed || receipt.outcome !== undefined && receipt.outcome !== 'rejected'
      || receipt.outcome === 'rejected' && (row.executionAllowed !== false || receipt.error !== 'grant_not_applied')
      || receipt.outcome === undefined && receipt.error !== undefined) throw new Error('invalid workspace authorization receipt');
    row.lastReceiptJson = encodeMultiAgentRow(envelope);
  }
  const json = encodeMultiAgentRow(row);
  if (Buffer.byteLength(json) > 4096) throw new Error('workspace authorization exceeds reserve record limit');
  return JSON.parse(json) as WorkspaceExecutionAuthorizationRow;
}
export function approvalEvent(approval: MultiAgentApprovalDurable): MultiAgentApprovalEventPayload {
  return { approvalId: approval.approvalId, status: approval.status, persistenceState: approval.persistenceState,
    ...(approval.reason === undefined ? {} : { reason: approval.reason }) };
}
export function captureApprovalEvent(value: unknown): MultiAgentApprovalEventPayload {
  const event = scalarRecord(value, ['approvalId', 'status', 'persistenceState', 'reason'], ['approvalId', 'status', 'persistenceState']);
  boundedString(event.approvalId);
  if (!APPROVAL_STATUSES.includes(event.status as MultiAgentApprovalStatus) || typeof event.persistenceState !== 'string' || !['confirmed', 'unknown'].includes(event.persistenceState)
    || event.reason !== undefined && !APPROVAL_REASONS.includes(event.reason as MultiAgentApprovalReason)) throw new Error('invalid approval event');
  return JSON.parse(encodeMultiAgentRow(event)) as MultiAgentApprovalEventPayload;
}
