import type { MultiAgentApprovalView, MultiAgentPendingApproval } from '../../../shared/multi-agent-types';

export interface ApprovalIdentity { threadId: string; groupId: string; bootId: string; pending: MultiAgentPendingApproval }
export function approvalInvocationKey(identity: ApprovalIdentity): string {
  const p = identity.pending;
  return JSON.stringify([identity.threadId, identity.groupId, identity.bootId, p.approvalId, p.agentId, p.turn, p.turnId, p.inputSha256, p.inputByteLength, p.minDeadlineAt]);
}
export function approvalIdentityKey(identity: ApprovalIdentity): string {
  const p = identity.pending;
  return JSON.stringify([identity.threadId, identity.groupId, identity.bootId, p.approvalId, p.agentId, p.turn, p.turnId,
    p.inputSha256, p.inputByteLength, p.minDeadlineAt, p.status, p.persistenceState, p.canDecide, p.reason]);
}
export function assertApprovalMetadata(value: MultiAgentApprovalView, identity: ApprovalIdentity): void {
  const p = identity.pending;
  if (!value || value.threadId !== identity.threadId || value.groupId !== identity.groupId || value.bootId !== identity.bootId
    || value.approvalId !== p.approvalId || value.agentId !== p.agentId || value.turn !== p.turn || value.turnId !== p.turnId
    || value.inputSha256 !== p.inputSha256 || value.inputByteLength !== p.inputByteLength || value.minDeadlineAt !== p.minDeadlineAt
    || !/^[a-f0-9]{64}$/.test(value.inputSha256) || !Number.isSafeInteger(value.inputByteLength) || value.inputByteLength < 0 || value.inputByteLength > 2 * 1024 * 1024
    || typeof value.toolName !== 'string' || typeof value.cwd !== 'string' || !Number.isSafeInteger(value.issuedAt)
    || !Number.isSafeInteger(value.minDeadlineAt) || typeof value.canDecide !== 'boolean'
    || !['pending', 'approved', 'denied', 'expired', 'invalidated'].includes(value.status)
    || !['confirmed', 'unknown'].includes(value.persistenceState)) throw new Error('invalid_approval_metadata');
}
export function decodeApprovalPage(value: MultiAgentApprovalView, identity: ApprovalIdentity, offset: number): Uint8Array {
  assertApprovalMetadata(value, identity);
  const page = value.inputPage;
  if (value.persistenceState !== 'confirmed' || value.status !== 'pending' || !value.canDecide || !page
    || page.offset !== offset || page.byteLength !== value.inputByteLength || page.sha256 !== value.inputSha256
    || typeof page.base64 !== 'string' || page.base64.length > 4 * Math.ceil(32768 / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(page.base64)) throw new Error('invalid_approval_input_page');
  const binary = atob(page.base64);
  if (btoa(binary) !== page.base64 || binary.length > 32768 || page.nextOffset !== offset + binary.length
    || page.nextOffset > page.byteLength || binary.length === 0 && offset !== page.byteLength) throw new Error('invalid_approval_input_offset');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
