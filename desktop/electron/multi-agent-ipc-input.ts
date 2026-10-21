import { z } from 'zod';
import { captureIpcData } from './ipc-data-snapshot.js';
export type MultiAgentWireRecord = Record<string, unknown>;
export function readMultiAgentRecord(value: unknown, allowed: readonly string[]): MultiAgentWireRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('invalid multi-agent argument');
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) throw new Error('multi_agent_wire_limit_exceeded');
  return value as MultiAgentWireRecord;
}
export function readMultiAgentId(value: unknown, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('invalid multi-agent identifier'); return value;
}
export function readMultiAgentInteger(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('invalid multi-agent integer'); return value as number;
}
export function multiAgentWireSchema(fields: readonly string[]) {
  return z.custom<MultiAgentWireRecord>(() => true).transform(raw => readMultiAgentRecord(captureIpcData(raw, 'invalid multi-agent argument'), fields));
}
/** Full scalar validation occurs only after the original host ownership phase. */
export function multiAgentInputSchema(key: string, fields: readonly string[]) {
  return z.custom<MultiAgentWireRecord>(() => true).transform(raw => {
    const input = readMultiAgentRecord(raw, fields), id = readMultiAgentId, integer = readMultiAgentInteger;
    if (fields.includes('threadId')) id(input.threadId);
    const group = () => id(input.groupId);
    switch (key) {
      case 'getMultiAgentSnapshot': id(input.groupId, true); break;
      case 'getMultiAgentApproval': group(); id(input.approvalId); if (input.inputOffset !== undefined) integer(input.inputOffset); break;
      case 'decideMultiAgentApproval':
        if (!['approve','approve_for_task','deny'].includes(input.decision as string)) throw Error('invalid approval decision');
        group(); id(input.approvalId); id(input.operationId); break;
      case 'listMultiAgentGroups': id(input.cursor, true); break;
      case 'listMultiAgents': case 'getMultiAgentResources': group(); id(input.cursor, true); break;
      case 'getMultiAgentEvents': group(); integer(input.afterSeq, 0); integer(input.limit, 100); break;
      case 'getAgentContent': group(); id(input.contentId); integer(input.offset, 0); break;
      case 'getMultiAgentOperation': group(); id(input.operationId); break;
      case 'resolveMultiAgentResource':
        if (input.action !== 'keep' && input.action !== 'retryCleanup') throw Error('invalid resource action');
        group(); id(input.resourceId); id(input.operationId); break;
      case 'resetMultiAgentGroup':
        if (input.confirmTerminate !== true) throw Error('group reset requires explicit confirmation');
        if (input.expectedGroupId !== null) id(input.expectedGroupId); id(input.operationId); break;
      case 'deleteMultiAgentThread':
        if (input.confirmTerminate !== true) throw Error('thread deletion requires explicit confirmation');
        id(input.operationId); integer(input.expectedThreadRevision); break;
      case 'sendAgentMessage': case 'followupAgent': case 'interruptAgent': case 'closeAgent':
        group(); id(input.agentId); id(input.operationId); integer(input.expectedTurn);
        if (key === 'sendAgentMessage' || key === 'followupAgent') {
          if (typeof input.message !== 'string' || Buffer.byteLength(input.message) > 16 * 1024) throw Error('invalid multi-agent message');
        }
        break;
      case 'subscribeMultiAgents': id(input.subscriptionId); integer(input.afterSeq, 0); id(input.groupId, true); break;
      case 'getLocalExecutionAuthorizationOperation': id(input.operationId); break;
      case 'setLocalExecutionAuthorization':
        if (input.confirm !== true) throw Error('execution authorization requires explicit confirmation');
        if (typeof input.executionAllowed !== 'boolean') throw Error('invalid authorization argument');
        id(input.operationId); integer(input.expectedPermissionRevision); break;
      case 'subscribeLocalExecutionAuthorization': case 'unsubscribeLocalExecutionAuthorization': case 'unsubscribeMultiAgents': id(input.subscriptionId); break;
    }
    return input;
  });
}
