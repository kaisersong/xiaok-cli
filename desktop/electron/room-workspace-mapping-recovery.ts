import type { RoomWorkspaceLocalStore } from './room-workspace-local.js';

export interface PendingWorkspaceMapping {
  recordKey: string; roomId: string; projectId: string; operationId: string;
  payloadDigest: string; payload: Record<string, unknown>; ticketId?: string; applied: boolean; cancelled?: boolean; rejected?: boolean;
}

/** Replays only an existing mapping authorization. No background ticket issue. */
export function createRoomWorkspaceMappingRecovery(options: {
  store: RoomWorkspaceLocalStore;
  isMutationOwner(): boolean;
  broker: { request(roomId: string, action: string, input: Record<string, unknown>): Promise<Record<string, unknown>> };
  kswarmRequest(path: string, init?: RequestInit): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}) {
  const pending = new Map<string, Promise<void>>();
  async function apply(record: PendingWorkspaceMapping, recover = false) {
    if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
    const current = options.store.getRecord<PendingWorkspaceMapping>('pending-mapping', record.recordKey);
    if (current?.applied) return;
    if (recover || !record.ticketId) {
      const recovered = await options.broker.request(record.roomId, 'recover-mapping-ticket', { projectId: record.projectId, operationId: record.operationId, payloadDigest: record.payloadDigest, expectedProjectRevision: record.payload.expectedProjectRevision });
      if (!recovered.ok && recovered.code === 'workspace_ticket_mismatch') {
        const found = await options.broker.request(record.roomId, 'recover-mapping-operation', { projectId: record.projectId, operationId: record.operationId });
        const mapping = found.mapping as Record<string, unknown> | undefined;
        const exactOperation = found.ok && mapping && ['roomId', 'projectId', 'operationId'].every(key => mapping[key] === (record as unknown as Record<string, unknown>)[key]) && ['bindingId', 'generation'].every(key => mapping[key] === record.payload[key]);
        if (exactOperation && mapping.state === 'cancelled') {
          if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
          options.store.saveRecord('pending-mapping', record.recordKey, { ...record, cancelled: true });
          return;
        }
        if (exactOperation && mapping.state === 'updating' && !mapping.ticketId) {
          if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
          // The authority checks again atomically: a concurrently issued ticket
          // makes cancellation fail. Recovery never signs the missing ticket.
          const cancelled = await options.broker.request(record.roomId, 'cancel-mapping', { projectId: record.projectId, operationId: record.operationId });
          if (cancelled.ok) { options.store.saveRecord('pending-mapping', record.recordKey, { ...record, cancelled: true }); return; }
        }
      }
      const ticket = recovered.ticket as Record<string, unknown> | undefined;
      if (!recovered.ok || !ticket || typeof ticket.ticketId !== 'string' || ['roomId', 'projectId', 'operationId', 'payloadDigest'].some(key => ticket[key] !== (record as unknown as Record<string, unknown>)[key]) || ['workspaceId', 'bindingId', 'generation', 'expectedProjectRevision'].some(key => ticket[key] !== record.payload[key])) throw new Error(String(recovered.code ?? 'workspace_mapping_ticket_mismatch'));
      if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
      if (record.ticketId && record.ticketId !== ticket.ticketId) throw new Error('workspace_mapping_ticket_mismatch');
      if (ticket.rejected === true) { options.store.saveRecord('pending-mapping', record.recordKey, { ...record, rejected: true }); return; }
      record = { ...record, ticketId: ticket.ticketId };
      options.store.saveRecord('pending-mapping', record.recordKey, record);
    }
    if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
    const response = await options.kswarmRequest(`/projects/${encodeURIComponent(record.projectId)}/workspace-mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticketId: record.ticketId, operationId: record.operationId, payload: record.payload, payloadDigest: record.payloadDigest }) });
    const result = await response.json() as { ok?: boolean; code?: string; error?: string };
    if (!response.ok || !result.ok) throw new Error(result.code ?? result.error ?? 'workspace_mapping_pending');
    options.store.saveRecord('pending-mapping', record.recordKey, { ...record, applied: true });
  }
  function applyOnce(record: PendingWorkspaceMapping) {
    const prior = pending.get(record.recordKey);
    if (prior) return prior;
    const work = apply(record, true).finally(() => { if (pending.get(record.recordKey) === work) pending.delete(record.recordKey); });
    pending.set(record.recordKey, work);
    return work;
  }
  return {
    apply: applyOnce,
    execute(record: PendingWorkspaceMapping, issueTicket: () => Promise<string>) {
      const active = pending.get(record.recordKey);
      if (active) return active;
      const work = (async () => {
        options.store.saveRecord('pending-mapping', record.recordKey, record);
        if (!record.ticketId) {
          record = { ...record, ticketId: await issueTicket() };
          options.store.saveRecord('pending-mapping', record.recordKey, record);
        }
        await apply(record);
      })().finally(() => { if (pending.get(record.recordKey) === work) pending.delete(record.recordKey); });
      pending.set(record.recordKey, work);
      return work;
    },
    async recover(): Promise<string[]> {
      const changed = new Set<string>();
      if (!options.isMutationOwner()) return [];
      for (const record of options.store.listRecords<PendingWorkspaceMapping>('pending-mapping')) {
        if (record.applied || record.cancelled || record.rejected || pending.has(record.recordKey)) continue;
        try { await applyOnce(record); changed.add(record.roomId); }
        catch { /* Preserve the exact request for authority recovery, not a fresh operation. */ }
      }
      return [...changed];
    },
  };
}
