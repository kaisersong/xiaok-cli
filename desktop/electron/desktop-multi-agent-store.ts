import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  DesktopAgentSnapshot, DesktopMultiAgentGroup, MultiAgentContent, MultiAgentContentPage,
  MultiAgentDrainedBatch, MultiAgentDurableEvent, MultiAgentEventKind, MultiAgentManagedResource,
  MultiAgentMessage, MultiAgentOperation, MultiAgentPage, MultiAgentRootBinding, MultiAgentSender, MultiAgentControlResult,
  WorkspaceExecutionAuthorizationRow, ExecutionAuthorizationReceiptEnvelope, ApprovalRequestOperation,
  MultiAgentApprovalDurable, MultiAgentApprovalStatus, MultiAgentApprovalReason, MultiAgentApprovalEventPayload,
} from '../shared/multi-agent-types.js';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const TABLES = ['groups', 'agents', 'events', 'messages', 'contents', 'operations', 'root_turns', 'managed_resources'] as const;
type Table = typeof TABLES[number];
type SqlValue = string | number | null;
interface JsonRow { data_json: string; logical_bytes: number }
export interface MultiAgentThreadBinding {
  threadId: string; profileId: string; workspaceId: string; cwd: string;
  activeGroupId?: string | null; threadRevision?: number;
  pendingApprovalCount?: number;
  deleteState?: 'none' | 'delete_pending' | 'deleted';
  deletionReceipt?: ThreadDeletionReceipt;
}
export interface ThreadDeletionReceipt {
  operationId: string; requestHash: string; actorId: string; bootId: string; expectedRevision: number; startedAt: number;
  result: MultiAgentControlResult;
}

/** Frozen logical accounting format: recursively key-sorted, finite, plain JSON UTF-8. */
export function encodeMultiAgentRow(value: unknown): string {
  const seen = new Set<object>();
  function canonical(item: unknown): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || !item) throw new Error('invalid multi-agent JSON value');
    if (seen.has(item)) throw new Error('cyclic multi-agent JSON value');
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map(canonical);
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error('non-plain multi-agent JSON value');
      return Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, canonical((item as Record<string, unknown>)[key])]));
    } finally { seen.delete(item); }
  }
  return JSON.stringify(canonical(value));
}

export function truncateMultiAgentText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, truncated: false };
  return { text: new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true }), truncated: true };
}

const APPROVAL_STATUSES: readonly MultiAgentApprovalStatus[] = ['pending', 'approved', 'denied', 'expired', 'invalidated'];
const APPROVAL_REASONS: readonly MultiAgentApprovalReason[] = ['user_denied', 'approval_deadline', 'actor_deadline', 'actor_aborted',
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
function boundedString(value: unknown, maximum = 256): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('invalid multi-agent scalar string');
}
function safeInteger(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error('invalid multi-agent scalar integer');
}
function captureApprovalOperation(value: unknown): ApprovalRequestOperation {
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

function captureWorkspaceAuthorization(value: unknown): WorkspaceExecutionAuthorizationRow {
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
function approvalEvent(approval: MultiAgentApprovalDurable): MultiAgentApprovalEventPayload {
  return { approvalId: approval.approvalId, status: approval.status, persistenceState: approval.persistenceState,
    ...(approval.reason === undefined ? {} : { reason: approval.reason }) };
}
function captureApprovalEvent(value: unknown): MultiAgentApprovalEventPayload {
  const event = scalarRecord(value, ['approvalId', 'status', 'persistenceState', 'reason'], ['approvalId', 'status', 'persistenceState']);
  boundedString(event.approvalId);
  if (!APPROVAL_STATUSES.includes(event.status as MultiAgentApprovalStatus) || typeof event.persistenceState !== 'string' || !['confirmed', 'unknown'].includes(event.persistenceState)
    || event.reason !== undefined && !APPROVAL_REASONS.includes(event.reason as MultiAgentApprovalReason)) throw new Error('invalid approval event');
  return JSON.parse(encodeMultiAgentRow(event)) as MultiAgentApprovalEventPayload;
}
export interface FinalizeApprovalInput {
  groupId: string; approvalId: string; bootId: string; status: Exclude<MultiAgentApprovalStatus, 'pending'>;
  reason?: MultiAgentApprovalReason; decisionOperation?: MultiAgentOperation;
}

const WORKSPACE_AUTHORIZATION_SQL = `CREATE TABLE workspace_execution_authorizations (
  profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  permission_revision INTEGER NOT NULL CHECK (typeof(permission_revision) = 'integer' AND permission_revision BETWEEN 0 AND 9007199254740991),
  execution_allowed INTEGER NOT NULL CHECK (execution_allowed IN (0, 1)), updated_at INTEGER NOT NULL, actor_id TEXT,
  last_receipt_json TEXT CHECK (last_receipt_json IS NULL OR json_valid(last_receipt_json)), PRIMARY KEY (profile_id, workspace_id));`;
const APPROVAL_INDEX_SQL = `CREATE INDEX operations_approval_requests ON operations (
  group_id, json_extract(data_json, '$.result.approval.bootId'), operation_id) WHERE json_extract(data_json, '$.command') = 'approval_request';`;
const THREAD_DELETION_COLUMNS = ["delete_state TEXT NOT NULL DEFAULT 'none' CHECK(delete_state IN ('none','delete_pending','deleted'))", 'delete_json TEXT'];
const APPROVAL_COUNT_COLUMN = 'pending_approval_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0)';
/** Keep quoted JSON paths/literals case- and whitespace-sensitive. */
function schemaSql(sql: string): string {
  return (sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[^\s'"]+/g) ?? []).map(token => token.startsWith("'") ? token
    : token.replace(/^"|"$/g, '').toLowerCase()).join('').replace(/;$/, '').replace(/^create(table|index|uniqueindex)ifnotexists/, 'create$1');
}

export class DesktopMultiAgentStore {
  private readonly db: DatabaseSync;
  readonly bootId: string;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly reserveBytes: number;
  private closed = false;
  private transactionDepth = 0;
  private readonly listeners = new Set<(event: MultiAgentDurableEvent) => void>();
  private pendingEvents: MultiAgentDurableEvent[] = [];
  private readonly committedEvents: MultiAgentDurableEvent[] = [];
  private publishing = false;
  private ownerClaimed = false;

  constructor(dbPath: string, options: { bootId?: string; now?: () => number; maxBytes?: number; reserveBytes?: number } = {}) {
    this.bootId = options.bootId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
    this.reserveBytes = options.reserveBytes ?? 1024 * 1024;
    if (this.reserveBytes <= 0 || this.maxBytes <= this.reserveBytes) throw new Error('invalid multi-agent byte quota');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    try {
      const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (![0, 1, 2].includes(version.user_version)) throw new Error(`unsupported multi-agent schema version ${version.user_version}`);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0;');
      this.applySchema(version.user_version);
    } catch (error) { this.db.close(); this.closed = true; throw error; }
  }

  close(): void { if (!this.closed) { this.closed = true; this.listeners.clear(); this.db.close(); } }
  isClosed(): boolean { return this.closed; }

  /** Main-only startup admission. Closing SQLite does not release a JS owner. */
  claimBootOwnership(pid = process.pid): void {
    if (this.ownerClaimed) return;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('multi_agent_owner_unknown');
    this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM boot_owners WHERE boot_id=?').get(this.bootId)) throw new Error('multi_agent_owner_boot_collision');
      const missing = this.db.prepare(`SELECT 1 FROM groups g WHERE g.boot_id<>? AND NOT EXISTS(SELECT 1 FROM boot_owners b WHERE b.boot_id=g.boot_id)
        AND (EXISTS(SELECT 1 FROM agents a WHERE a.group_id=g.group_id AND (
          json_extract(a.data_json,'$.executionActive')=1 OR json_extract(a.data_json,'$.sessionResident')=1 OR json_extract(a.data_json,'$.runtimeResident')=1))
          OR EXISTS(SELECT 1 FROM managed_resources r WHERE r.group_id=g.group_id AND json_extract(r.data_json,'$.state') NOT IN ('released','retained_by_policy'))
          OR EXISTS(SELECT 1 FROM root_turns t WHERE t.group_id=g.group_id AND json_extract(t.data_json,'$.phase') NOT IN ('settled','abandoned'))) LIMIT 1`).get(this.bootId);
      if (missing) throw new Error('multi_agent_owner_unknown');
      let cursor = '';
      for (;;) {
        const owners = this.db.prepare("SELECT boot_id,owner_pid FROM boot_owners WHERE state='active' AND boot_id>? ORDER BY boot_id LIMIT 100")
          .all(cursor) as unknown as Array<{ boot_id: string; owner_pid: number }>;
        for (const owner of owners) {
          if (!Number.isSafeInteger(owner.owner_pid) || owner.owner_pid <= 0) throw new Error('multi_agent_owner_unknown');
          let exited = false;
          try { process.kill(owner.owner_pid, 0); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') exited = true; else throw new Error('multi_agent_owner_unknown', { cause: error }); }
          if (!exited) throw new Error('multi_agent_owner_live');
          this.db.prepare("UPDATE boot_owners SET state='exited' WHERE boot_id=? AND state='active'").run(owner.boot_id);
        }
        if (owners.length < 100) break;
        cursor = owners.at(-1)!.boot_id;
      }
      this.db.prepare("INSERT INTO boot_owners(boot_id,owner_pid,state) VALUES(?,?,'active')").run(this.bootId, pid);
    });
    this.ownerClaimed = true;
  }

  /** Only the service that has physically drained all owned work may call this. */
  settleBootOwnership(): void {
    if (this.ownerClaimed) this.db.prepare("UPDATE boot_owners SET state='quiesced' WHERE boot_id=? AND state='active'").run(this.bootId);
  }

  *previousGroups(): Generator<DesktopMultiAgentGroup> {
    let cursor = '';
    for (;;) {
      const rows = this.db.prepare('SELECT data_json,logical_bytes FROM groups WHERE boot_id<>? AND group_id>? ORDER BY group_id LIMIT 50')
        .all(this.bootId, cursor) as unknown as JsonRow[];
      for (const row of rows) { const group = this.parse<DesktopMultiAgentGroup>(row); cursor = group.groupId; yield group; }
      if (rows.length < 50) break;
    }
  }

  assertResourceOwnerSettled(ownerBootId: string): void {
    const row = this.db.prepare('SELECT state FROM boot_owners WHERE boot_id=?').get(ownerBootId) as { state: string } | undefined;
    if (!this.ownerClaimed || ownerBootId === this.bootId || !row || !['exited', 'quiesced'].includes(row.state)) throw new Error('multi_agent_resource_owner_unknown');
  }

  reconcileAgentResources(groupId: string): void {
    this.transaction(() => {
      const pending = new Map(this.resources(groupId).filter(resource => !['released', 'retained_by_policy'].includes(resource.state)).map(resource => [resource.agentId, resource]));
      for (const agent of this.allAgents(groupId)) {
        if (agent.executionActive || agent.sessionResident || agent.runtimeResident) throw new Error('multi_agent_resource_owner_live');
        const resource = pending.get(agent.id);
        this.putAgent(groupId, { ...agent, resourcesReleased: !resource, cleanupPending: Boolean(resource),
          ...(resource?.lastError ? { cleanupError: resource.lastError } : { cleanupError: undefined }) }, true);
      }
    });
  }

  subscribe(listener: (event: MultiAgentDurableEvent) => void): () => void {
    if (this.closed) throw new Error('multi-agent store closed');
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }

  transaction<T>(action: () => T): T {
    if (this.transactionDepth) return action();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    let committed = false;
    try {
      const result = action();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('multi-agent transactions must be synchronous');
      this.db.exec('COMMIT');
      committed = true;
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally {
      this.transactionDepth -= 1;
      const events = this.pendingEvents; this.pendingEvents = [];
      if (committed) { this.committedEvents.push(...events); this.publishCommitted(); }
    }
  }

  private publishCommitted(): void {
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.committedEvents.length) {
        const event = this.committedEvents.shift()!;
        for (const listener of [...this.listeners]) { try { listener(structuredClone(event)); } catch { /* A subscriber cannot roll back committed truth. */ } }
      }
    } finally { this.publishing = false; }
  }

  registerThread(binding: MultiAgentThreadBinding): void {
    const previous = this.getThread(binding.threadId);
    if (previous) {
      if (previous.profileId !== binding.profileId || previous.workspaceId !== binding.workspaceId || previous.cwd !== binding.cwd) throw new Error('thread ownership mismatch');
      return;
    }
    this.db.prepare('INSERT INTO thread_bindings(thread_id,profile_id,workspace_id,cwd,active_group_id,thread_revision) VALUES(?,?,?,?,NULL,0)')
      .run(binding.threadId, binding.profileId, binding.workspaceId, binding.cwd);
  }

  getThread(threadId: string): MultiAgentThreadBinding | null {
    const row = this.db.prepare('SELECT thread_id,profile_id,workspace_id,cwd,active_group_id,thread_revision,delete_state,delete_json,pending_approval_count FROM thread_bindings WHERE thread_id=?')
      .get(threadId) as { thread_id: string; profile_id: string; workspace_id: string; cwd: string; active_group_id: string | null; thread_revision: number;
        delete_state: MultiAgentThreadBinding['deleteState']; delete_json: string | null; pending_approval_count: number } | undefined;
    return row ? { threadId: row.thread_id, profileId: row.profile_id, workspaceId: row.workspace_id, cwd: row.cwd, activeGroupId: row.active_group_id, threadRevision: row.thread_revision,
      deleteState: row.delete_state, pendingApprovalCount: row.pending_approval_count,
      ...(row.delete_json ? { deletionReceipt: JSON.parse(row.delete_json) as ThreadDeletionReceipt } : {}) } : null;
  }

  /** Main factory/service only, for its already-resolved fixed domain. No IPC creates arbitrary domains. */
  initializeWorkspaceAuthorization(domain: { profileId: string; workspaceId: string }): WorkspaceExecutionAuthorizationRow {
    const initial = captureWorkspaceAuthorization({ ...domain, permissionRevision: 0, executionAllowed: true, updatedAt: this.now(), actorId: null, lastReceiptJson: null });
    return this.transaction(() => {
      this.db.prepare('INSERT INTO workspace_execution_authorizations(profile_id,workspace_id,permission_revision,execution_allowed,updated_at,actor_id,last_receipt_json) VALUES(?,?,0,1,?,NULL,NULL) ON CONFLICT(profile_id,workspace_id) DO NOTHING')
        .run(initial.profileId, initial.workspaceId, initial.updatedAt);
      return this.readWorkspaceAuthorization(domain)!;
    });
  }

  readWorkspaceAuthorization(domain: { profileId: string; workspaceId: string }): WorkspaceExecutionAuthorizationRow | null {
    boundedString(domain.profileId); boundedString(domain.workspaceId);
    const row = this.db.prepare('SELECT profile_id,workspace_id,permission_revision,execution_allowed,updated_at,actor_id,last_receipt_json FROM workspace_execution_authorizations WHERE profile_id=? AND workspace_id=?')
      .get(domain.profileId, domain.workspaceId) as { profile_id: string; workspace_id: string; permission_revision: number; execution_allowed: number; updated_at: number; actor_id: string | null; last_receipt_json: string | null } | undefined;
    if (!row) return null;
    if (row.execution_allowed !== 0 && row.execution_allowed !== 1) throw new Error('invalid stored workspace authorization');
    return captureWorkspaceAuthorization({ profileId: row.profile_id, workspaceId: row.workspace_id, permissionRevision: row.permission_revision,
      executionAllowed: row.execution_allowed === 1, updatedAt: row.updated_at, actorId: row.actor_id, lastReceiptJson: row.last_receipt_json });
  }

  /** Pure durable CAS: the service owns candidate allocation and all actor authorization. */
  compareAndSetWorkspaceAuthorization(input: { profileId: string; workspaceId: string; expectedPermissionRevision: number; next: WorkspaceExecutionAuthorizationRow }): boolean {
    boundedString(input.profileId); boundedString(input.workspaceId); safeInteger(input.expectedPermissionRevision);
    const next = captureWorkspaceAuthorization(input.next);
    if (next.profileId !== input.profileId || next.workspaceId !== input.workspaceId || next.permissionRevision !== input.expectedPermissionRevision + 1
      || !next.actorId || !next.lastReceiptJson) throw new Error('invalid workspace authorization CAS');
    const result = this.db.prepare('UPDATE workspace_execution_authorizations SET permission_revision=?,execution_allowed=?,updated_at=?,actor_id=?,last_receipt_json=? WHERE profile_id=? AND workspace_id=? AND permission_revision=?')
      .run(next.permissionRevision, Number(next.executionAllowed), next.updatedAt, next.actorId, next.lastReceiptJson, input.profileId, input.workspaceId, input.expectedPermissionRevision);
    return Number(result.changes) === 1;
  }

  listWorkspaceThreads(input: { profileId: string; workspaceId: string; cursor?: string; limit?: number }): MultiAgentPage<MultiAgentThreadBinding> {
    boundedString(input.profileId); boundedString(input.workspaceId); if (input.cursor !== undefined) boundedString(input.cursor);
    const limit = this.limit(input.limit ?? 50, 50);
    const rows = this.db.prepare('SELECT thread_id FROM thread_bindings WHERE profile_id=? AND workspace_id=? AND thread_id>? ORDER BY thread_id LIMIT ?')
      .all(input.profileId, input.workspaceId, input.cursor ?? '', limit + 1) as Array<{ thread_id: string }>;
    const items = rows.slice(0, limit).map(row => this.getThread(row.thread_id)!);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.threadId : null };
  }

  listWorkspaceGroups(input: { threadId: string; bootId: string; cursor?: string; limit?: number }): MultiAgentPage<DesktopMultiAgentGroup> {
    boundedString(input.threadId); boundedString(input.bootId); const limit = this.limit(input.limit ?? 50, 50);
    const [time, id] = this.cursor(input.cursor, Number.MAX_SAFE_INTEGER, '\uffff');
    const rows = this.db.prepare('SELECT data_json,logical_bytes FROM groups WHERE thread_id=? AND boot_id=? AND historical_only=0 AND (created_at<? OR (created_at=? AND group_id<?)) ORDER BY created_at DESC,group_id DESC LIMIT ?')
      .all(input.threadId, input.bootId, time, time, id, limit + 1) as unknown as JsonRow[];
    return this.page(rows.map(row => { const group = this.parse<DesktopMultiAgentGroup>(row); return { ...group, byteUsage: this.getByteUsage(group.groupId) }; }), limit, group => [group.createdAt, group.groupId]);
  }

  beginThreadDeletion(threadId: string, receipt: ThreadDeletionReceipt): void {
    const data = encodeMultiAgentRow(receipt);
    if (Buffer.byteLength(data) > 4 * 1024) throw new Error('thread deletion receipt exceeds limit');
    const result = this.db.prepare("UPDATE thread_bindings SET delete_state='delete_pending',delete_json=?,thread_revision=thread_revision+1 WHERE thread_id=? AND thread_revision=? AND delete_state<>'deleted'")
      .run(data, threadId, receipt.expectedRevision);
    if (result.changes !== 1) throw new Error('stale thread deletion revision');
  }

  updateThreadDeletion(threadId: string, operationId: string, result: MultiAgentControlResult): void {
    const thread = this.getThread(threadId), receipt = thread?.deletionReceipt;
    if (!receipt || receipt.operationId !== operationId || thread?.deleteState === 'deleted') throw new Error('stale thread deletion operation');
    const data = encodeMultiAgentRow({ ...receipt, result });
    if (Buffer.byteLength(data) > 4 * 1024) throw new Error('thread deletion receipt exceeds limit');
    this.db.prepare('UPDATE thread_bindings SET delete_json=? WHERE thread_id=?').run(data, threadId);
  }

  /** Called only after the service's physical host/core/Goal gate, not by tools. */
  deleteThreadHistory(threadId: string, operationId: string): void {
    this.transaction(() => {
      const thread = this.getThread(threadId), receipt = thread?.deletionReceipt;
      if (thread?.deleteState !== 'delete_pending' || receipt?.operationId !== operationId) throw new Error('stale thread deletion operation');
      if (this.threadHasUnreleasedResources(threadId)) throw new Error('thread deletion cleanup pending');
      for (const table of ['events', 'messages', 'operations', 'root_turns', 'managed_resources', 'contents', 'agents', 'groups'] as const) {
        this.db.prepare(`DELETE FROM ${table} WHERE group_id IN (SELECT group_id FROM groups WHERE thread_id=?)`).run(threadId);
      }
      const data = encodeMultiAgentRow({ ...receipt, result: { operationId, state: 'completed', resourcesReleased: true } });
      this.db.prepare("UPDATE thread_bindings SET active_group_id=NULL,delete_state='deleted',delete_json=?,pending_approval_count=0,thread_revision=thread_revision+1 WHERE thread_id=?").run(data, threadId);
    });
  }

  createGroup(threadId: string, permissionRevision = 0): DesktopMultiAgentGroup {
    safeInteger(permissionRevision);
    return this.transaction(() => {
      const thread = this.getThread(threadId);
      if (!thread) throw new Error('unknown thread');
      if (thread.deleteState !== 'none') throw new Error('thread deletion prevents new groups');
      if (thread.activeGroupId) throw new Error('thread already has an active group');
      const group: DesktopMultiAgentGroup = {
        groupId: randomUUID(), threadId, bootId: this.bootId, historicalOnly: false,
        createdAt: this.now(), lastSeq: 0, byteUsage: 0, currentRootEpoch: 0, nextRootEpoch: 0, mutationBlockedReason: null, permissionRevision,
      };
      this.putGroup(group);
      this.putAgent(group.groupId, { id: `root_${group.groupId}`, parentId: null, taskName: 'main', canonicalName: '/root', depth: 0, status: 'pending', turn: 0 });
      this.db.prepare('UPDATE thread_bindings SET active_group_id=?,thread_revision=thread_revision+1 WHERE thread_id=? AND active_group_id IS NULL').run(group.groupId, threadId);
      return this.requireGroup(group.groupId);
    });
  }

  activeGroup(threadId: string): DesktopMultiAgentGroup | null {
    const id = this.getThread(threadId)?.activeGroupId;
    return id ? this.getGroup(id) : null;
  }

  getGroup(groupId: string): DesktopMultiAgentGroup | null {
    const data = this.readOne<DesktopMultiAgentGroup>('groups', 'group_id', groupId);
    return data ? { ...data, byteUsage: this.getByteUsage(groupId) } : null;
  }
  requireGroup(groupId: string): DesktopMultiAgentGroup {
    const group = this.getGroup(groupId);
    if (!group) throw new Error('unknown multi-agent group');
    return group;
  }
  putGroup(group: DesktopMultiAgentGroup, control = false): void {
    const { byteUsage: _counter, ...data } = group;
    this.write('groups', group.groupId, { group_id: group.groupId }, {
      thread_id: group.threadId, boot_id: group.bootId, historical_only: Number(group.historicalOnly), created_at: group.createdAt,
    }, data, control);
  }

  clearActiveGroup(threadId: string, expectedGroupId: string): void {
    this.db.prepare('UPDATE thread_bindings SET active_group_id=NULL,thread_revision=thread_revision+1 WHERE thread_id=? AND active_group_id=?').run(threadId, expectedGroupId);
  }

  findThreadOperation(threadId: string, operationId: string, command: string): MultiAgentOperation | null {
    const row = this.db.prepare("SELECT o.data_json,o.logical_bytes FROM operations o JOIN groups g ON g.group_id=o.group_id WHERE g.thread_id=? AND o.operation_id=? AND json_extract(o.data_json,'$.command')=? LIMIT 1")
      .get(threadId, operationId, command) as JsonRow | undefined;
    return row ? this.parse<MultiAgentOperation>(row) : null;
  }

  /** Physical gate spans history as well as the active pointer; never trusts UI status. */
  threadHasUnreleasedResources(threadId: string): boolean {
    const live = this.db.prepare(`SELECT 1 FROM agents a JOIN groups g ON g.group_id=a.group_id WHERE g.thread_id=? AND (
      json_extract(a.data_json,'$.executionActive')=1 OR json_extract(a.data_json,'$.sessionResident')=1 OR json_extract(a.data_json,'$.runtimeResident')=1
      OR json_extract(a.data_json,'$.cleanupPending')=1 OR COALESCE(json_extract(a.data_json,'$.cleanupError'),'')<>''
      OR (json_extract(a.data_json,'$.activationState') IN ('prepared','activating') AND json_extract(a.data_json,'$.turn')>0)) LIMIT 1`).get(threadId);
    const disk = this.db.prepare("SELECT 1 FROM managed_resources r JOIN groups g ON g.group_id=r.group_id WHERE g.thread_id=? AND json_extract(r.data_json,'$.state') NOT IN ('released','retained_by_policy') LIMIT 1").get(threadId);
    return Boolean(live || disk);
  }

  /** Thread-wide history includes retained/old-boot children, never root-only groups. */
  threadHasAgentHistory(threadId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM groups g WHERE g.thread_id=? AND EXISTS (
      SELECT 1 FROM agents a WHERE a.group_id=g.group_id AND a.parent_id IS NOT NULL
    ) LIMIT 1`).get(threadId));
  }

  goalChildReadiness(groupId: string): 'ready' | 'waiting_children' | 'children_need_attention' {
    const failed = this.db.prepare(`SELECT 1 FROM messages m JOIN agents a ON a.group_id=m.group_id AND a.agent_id=m.sender_agent_id
      WHERE m.group_id=? AND m.delivery_state<>'context_applied' AND a.parent_id IS NOT NULL AND (
        json_extract(m.data_json,'$.kind')='error' OR (json_extract(m.data_json,'$.kind')='result'
        AND json_extract(a.data_json,'$.status') IN ('failed','interrupted'))) LIMIT 1`).get(groupId);
    if (failed) return 'children_need_attention';
    const live = this.db.prepare(`SELECT 1 FROM agents WHERE group_id=? AND parent_id IS NOT NULL AND (
      json_extract(data_json,'$.executionActive')=1 OR (json_extract(data_json,'$.turn')>0 AND json_extract(data_json,'$.activationState') IN ('prepared','activating'))) LIMIT 1`).get(groupId);
    const unread = this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND delivery_state<>'context_applied' AND json_extract(data_json,'$.kind') IN ('result','error') LIMIT 1").get(groupId);
    return live || unread ? 'waiting_children' : 'ready';
  }

  listGroups(threadId: string, cursor?: string, limit = 50, options: { onlyWithChildren?: boolean } = {}): MultiAgentPage<DesktopMultiAgentGroup> {
    const [time, id] = this.cursor(cursor, Number.MAX_SAFE_INTEGER, '\uffff');
    const childFilter = options.onlyWithChildren
      ? ' AND EXISTS (SELECT 1 FROM agents a WHERE a.group_id=groups.group_id AND a.parent_id IS NOT NULL)' : '';
    const rows = this.db.prepare(`SELECT data_json,logical_bytes FROM groups WHERE thread_id=?${childFilter} AND (created_at<? OR (created_at=? AND group_id<?)) ORDER BY created_at DESC,group_id DESC LIMIT ?`)
      .all(threadId, time, time, id, this.limit(limit, 50) + 1) as unknown as JsonRow[];
    return this.page(rows.map(row => {
      const group = this.parse<DesktopMultiAgentGroup>(row);
      return { ...group, byteUsage: this.getByteUsage(group.groupId) };
    }), limit, item => [item.createdAt, item.groupId]);
  }

  putAgent(groupId: string, input: Pick<DesktopAgentSnapshot, 'id' | 'parentId' | 'taskName' | 'canonicalName' | 'depth' | 'status' | 'turn'> & Partial<DesktopAgentSnapshot>, control = false): DesktopAgentSnapshot {
    return this.transaction(() => {
    const previous = this.getAgent(groupId, input.id);
    const ordinal = input.parentId === null ? undefined : previous ? previous.presentationOrdinal
      : Number((this.db.prepare("SELECT COALESCE(MAX(json_extract(data_json,'$.presentationOrdinal')),0)+1 AS ordinal FROM agents WHERE group_id=?")
        .get(groupId) as { ordinal: number }).ordinal);
    if (ordinal !== undefined && (!Number.isSafeInteger(ordinal) || ordinal < 1)) throw new Error('invalid presentation ordinal');
    const agent: DesktopAgentSnapshot = {
      createdAt: this.now(), executionActive: false, sessionResident: false, runtimeResident: false,
      resourcesReleased: false, cleanupPending: false, resumable: false, stopState: 'none', closeReason: null,
      activationState: 'prepared', unreadMessages: 0, ...previous, ...input, presentationOrdinal: ordinal,
    };
    this.write('agents', groupId, { group_id: groupId, agent_id: input.id }, {
      parent_id: agent.parentId, created_at: agent.createdAt,
    }, agent, control);
    return agent;
    });
  }
  getAgent(groupId: string, agentId: string): DesktopAgentSnapshot | null {
    const agent = this.readScoped<DesktopAgentSnapshot>('agents', groupId, 'agent_id', agentId);
    return agent ? this.withUnread(groupId, agent) : null;
  }
  listAgents(groupId: string, cursor?: string, limit = 50, maxBytes = 48 * 1024,
    guardIO: <T>(query: () => T) => T = query => query()): MultiAgentPage<DesktopAgentSnapshot> {
    const [time, id] = this.cursor(cursor, -1, '');
    const queryLimit = this.limit(limit, 50) + 1;
    const agents = guardIO(() => {
      const rows = this.db.prepare('SELECT data_json,logical_bytes FROM agents WHERE group_id=? AND (created_at>? OR (created_at=? AND agent_id>?)) ORDER BY created_at,agent_id LIMIT ?')
        .all(groupId, time, time, id, queryLimit) as unknown as JsonRow[];
      return rows.map(row => this.withUnread(groupId, this.parse<DesktopAgentSnapshot>(row)));
    });
    const page = this.page(agents, limit, item => [item.createdAt, item.id]);
    const items: DesktopAgentSnapshot[] = []; let bytes = 256;
    for (const agent of page.items) {
      const size = Buffer.byteLength(JSON.stringify(agent)) + 1;
      if (bytes + size > maxBytes && items.length) break;
      if (size > maxBytes) throw new Error('agent exceeds wire page limit');
      items.push(agent); bytes += size;
    }
    return { items, nextCursor: items.length < page.items.length ? Buffer.from(JSON.stringify([items.at(-1)!.createdAt, items.at(-1)!.id])).toString('base64url') : page.nextCursor };
  }
  allAgents(groupId: string): DesktopAgentSnapshot[] { return this.readGroupRows('agents', groupId); }

  residentAgents(groupId: string): DesktopAgentSnapshot[] {
    const rows = this.db.prepare("SELECT data_json,logical_bytes FROM agents WHERE group_id=? AND parent_id IS NOT NULL AND json_extract(data_json,'$.resourcesReleased')=0 ORDER BY created_at,agent_id LIMIT 8").all(groupId) as unknown as JsonRow[];
    return rows.map(row => this.withUnread(groupId, this.parse<DesktopAgentSnapshot>(row)));
  }
  agentCounts(groupId: string): { total: number; running: number; completed: number; failed: number; unread: number } {
    const row = this.db.prepare("SELECT COUNT(*) total,COALESCE(SUM(json_extract(data_json,'$.status')='running'),0) running,COALESCE(SUM(json_extract(data_json,'$.status')='completed'),0) completed,COALESCE(SUM(json_extract(data_json,'$.status')='failed'),0) failed FROM agents WHERE group_id=?").get(groupId) as { total: number; running: number; completed: number; failed: number };
    const unread = this.db.prepare("SELECT COUNT(*) count FROM messages WHERE group_id=? AND delivery_state<>'context_applied'").get(groupId) as { count: number };
    return { ...row, unread: unread.count };
  }
  private withUnread(groupId: string, agent: DesktopAgentSnapshot): DesktopAgentSnapshot {
    const row = this.db.prepare("SELECT COUNT(*) count FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state<>'context_applied'").get(groupId, agent.id) as { count: number };
    return { ...agent, unreadMessages: row.count };
  }

  appendEvent(groupId: string, input: { kind: MultiAgentEventKind; agentId: string; payload: Record<string, unknown>; turnId?: string }): MultiAgentDurableEvent {
    const approval = input.kind === 'approval' ? captureApprovalEvent(input.payload) : undefined;
    if (approval) input = { ...input, payload: { ...approval } };
    return this.transaction(() => {
      const group = this.requireGroup(groupId);
      const event: MultiAgentDurableEvent = { schemaVersion: 1, channel: 'durable', ...input, groupId, seq: group.lastSeq + 1, eventId: randomUUID(), timestamp: this.now() };
      const control = input.kind === 'status' || input.kind === 'cleanup' || input.kind === 'delivery' || Boolean(approval && approval.status !== 'pending');
      if (Buffer.byteLength(encodeMultiAgentRow(event)) > (control ? 4 * 1024 : 64 * 1024)) throw new Error('multi-agent event exceeds wire limit');
      this.write('events', groupId, { group_id: groupId, seq: event.seq }, { event_id: event.eventId, agent_id: event.agentId }, event, control);
      this.putGroup({ ...group, lastSeq: event.seq }, control);
      this.pendingEvents.push(event);
      return event;
    });
  }
  readEvents(groupId: string, afterSeq = 0, limit = 100): MultiAgentDurableEvent[] {
    this.requireGroup(groupId);
    const rows = this.db.prepare('SELECT data_json,logical_bytes FROM events WHERE group_id=? AND seq>? ORDER BY seq LIMIT ?')
      .all(groupId, Math.max(0, afterSeq), this.limit(limit, 100)) as unknown as JsonRow[];
    return rows.map(row => this.parse(row));
  }

  sendMessage(groupId: string, input: { sender: MultiAgentSender; receiverId: string; text: string; kind?: MultiAgentMessage['kind']; contentId?: string; truncated?: boolean }, settlement = false): MultiAgentMessage {
    return this.transaction(() => {
      if (settlement && (input.sender.kind !== 'agent' || input.kind !== 'result' && input.kind !== 'error')) throw new Error('invalid settlement handoff');
      this.assertWritable(groupId, settlement);
      if (!input.text.trim() || Buffer.byteLength(input.text) > 16 * 1024) throw new Error('message exceeds 16KiB or is empty');
      if (input.sender.kind !== 'agent' && input.sender.kind !== 'user') throw new Error('invalid sender kind');
      const identityKey = input.sender.kind === 'user' ? 'actorId' : 'agentId';
      const identity = (input.sender as unknown as Record<string, unknown>)[identityKey];
      if (typeof identity !== 'string' || !identity || Object.keys(input.sender).some(key => key !== 'kind' && key !== identityKey)) {
        throw new Error('invalid sender identity');
      }
      if (input.contentId && !this.readScoped<MultiAgentContent>('contents', groupId, 'content_id', input.contentId)) {
        throw new Error('unknown content or group mismatch');
      }
      const message: MultiAgentMessage = {
        messageId: randomUUID(), groupId, sender: input.sender, receiverId: input.receiverId,
        kind: input.kind ?? 'message', preview: input.text, contentId: input.contentId,
        truncated: input.truncated ?? false, deliveryState: 'unread', claimId: null, turnId: null, createdAt: this.now(),
      };
      this.putMessage(message);
      this.appendEvent(groupId, { kind: 'message_sent', agentId: input.receiverId, payload: { message } });
      return message;
    });
  }
  /** Main settlement only: an unconfirmed claim cannot follow a closed receiver. */
  rerouteClosedHandoffs(groupId: string, agentId: string): void {
    this.transaction(() => {
      this.assertWritable(groupId, true);
      const closed = this.getAgent(groupId, agentId);
      if (!closed || closed.status !== 'closed') throw new Error('handoff receiver is not closed');
      let receiver = closed;
      while (receiver.status === 'closed' && receiver.parentId) receiver = this.getAgent(groupId, receiver.parentId)!;
      if (receiver.status === 'closed') return;
      const ids = this.db.prepare("SELECT message_id FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state<>'context_applied' AND json_extract(data_json,'$.kind') IN ('result','error')")
        .all(groupId, agentId) as unknown as Array<{ message_id: string }>;
      for (const { message_id: id } of ids) {
        const old = this.readScoped<MultiAgentMessage>('messages', groupId, 'message_id', id)!;
        const message: MultiAgentMessage = { ...old, receiverId: receiver.id, originalReceiverId: old.originalReceiverId ?? old.receiverId,
          deliveryState: 'unread', claimId: null, turnId: null };
        this.putMessage(message);
        this.appendEvent(groupId, { kind: 'message_sent', agentId: receiver.id, payload: { message, rerouted: true } });
      }
    });
  }
  listMessages(groupId: string, receiverId: string): MultiAgentMessage[] {
    const rows = this.db.prepare('SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND receiver_id=? ORDER BY created_at,rowid').all(groupId, receiverId) as unknown as JsonRow[];
    return rows.map(row => this.parse(row));
  }
  hasUnread(groupId: string, receiverId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state='unread' LIMIT 1").get(groupId, receiverId));
  }
  unreadMessageIds(groupId: string, receiverId: string, senderIds: readonly string[]): string[] {
    if (!senderIds.length) return [];
    const rows = this.db.prepare("SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state='unread' ORDER BY created_at,rowid").iterate(groupId, receiverId);
    const result: string[] = [];
    for (const row of rows) {
      const message = this.parse<MultiAgentMessage>(row as unknown as JsonRow);
      if (message.sender.kind === 'agent' && senderIds.includes(message.sender.agentId)) result.push(message.messageId);
      if (result.length === 50) break;
    }
    return result;
  }
  drainInput(groupId: string, receiverId: string, turnId: string, maxBytes = 16 * 1024): MultiAgentDrainedBatch {
    return this.transaction(() => {
      this.assertWritable(groupId);
      const batch: MultiAgentMessage[] = [];
      let bytes = 0;
      const unread = this.db.prepare("SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND receiver_id=? AND delivery_state='unread' ORDER BY created_at,rowid").iterate(groupId, receiverId);
      for (const row of unread) {
        const message = this.parse<MultiAgentMessage>(row as unknown as JsonRow);
        const next = Buffer.byteLength(message.preview);
        if (bytes + next > Math.min(maxBytes, 16 * 1024)) break;
        bytes += next;
        batch.push(message);
      }
      if (!batch.length) return { claimId: null, messages: [] };
      const claimId = randomUUID();
      for (const message of batch) this.putMessage({ ...message, deliveryState: 'consuming', claimId, turnId });
      return { claimId, messages: batch.map(message => ({ ...message, deliveryState: 'consuming', claimId, turnId })) };
    });
  }
  confirmApplied(groupId: string, claimId: string, turnId: string): void {
    this.transaction(() => {
      this.assertWritable(groupId);
      const messages = (this.db.prepare('SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND claim_id=? ORDER BY rowid').all(groupId, claimId) as unknown as JsonRow[]).map(row => this.parse<MultiAgentMessage>(row));
      if (!messages.length || messages.some(message => message.turnId !== turnId || message.deliveryState === 'unread')) throw new Error('stale message claim or turn');
      for (const message of messages) {
        if (message.deliveryState === 'context_applied') continue;
        this.putMessage({ ...message, deliveryState: 'context_applied' });
        this.appendEvent(groupId, { kind: 'message_consumed', agentId: message.receiverId, turnId, payload: { messageId: message.messageId, deliveryState: 'context_applied' } });
      }
    });
  }
  returnClaim(groupId: string, claimId: string, expectedTurnId?: string): void {
    this.transaction(() => {
      const messages = (this.db.prepare("SELECT data_json,logical_bytes FROM messages WHERE group_id=? AND claim_id=? AND delivery_state='consuming'").all(groupId, claimId) as unknown as JsonRow[]).map(row => this.parse<MultiAgentMessage>(row));
      if (expectedTurnId && messages.some(message => message.turnId !== expectedTurnId)) throw new Error('stale message claim or turn');
      for (const message of messages) {
        this.putMessage({ ...message, deliveryState: 'unread', claimId: null, turnId: null }, true);
      }
    });
  }

  putContent(groupId: string, agentId: string, text: string, settlement = false): MultiAgentContent {
    this.assertWritable(groupId, settlement);
    const clipped = truncateMultiAgentText(text, MAX_CONTENT_BYTES);
    const bytes = Buffer.from(clipped.text, 'utf8');
    const content: MultiAgentContent = { contentId: randomUUID(), groupId, agentId, utf8Text: clipped.text, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), truncated: clipped.truncated };
    this.write('contents', groupId, { content_id: content.contentId }, { group_id: groupId, agent_id: agentId }, content, false);
    return content;
  }
  readContent(groupId: string, contentId: string, offset: number, limit = 64 * 1024): MultiAgentContentPage {
    const content = this.readScoped<MultiAgentContent>('contents', groupId, 'content_id', contentId);
    if (!content) throw new Error('unknown content or group mismatch');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.byteLength) throw new Error('invalid content offset');
    const bytes = Buffer.from(content.utf8Text, 'utf8').subarray(offset, offset + this.limit(limit, 64 * 1024));
    return { contentId, base64: bytes.toString('base64'), nextOffset: offset + bytes.length, byteLength: content.byteLength, sha256: content.sha256, truncated: content.truncated };
  }

  /** Internal rollback/retention primitive; caller authorization belongs to the service. */
  deleteUnreferencedContent(groupId: string, contentId: string): void {
    this.transaction(() => {
      this.assertWritable(groupId);
      const content = this.readOne<MultiAgentContent>('contents', 'content_id', contentId);
      if (!content) return;
      if (content.groupId !== groupId) throw new Error('content group mismatch');
      const referenced = this.db.prepare("SELECT 1 FROM messages WHERE group_id=? AND json_extract(data_json,'$.contentId')=? UNION ALL SELECT 1 FROM agents WHERE group_id=? AND json_extract(data_json,'$.resultContentId')=? UNION ALL SELECT 1 FROM events, json_tree(events.data_json) AS reference WHERE events.group_id=? AND reference.key IN ('contentId','resultContentId') AND reference.value=? LIMIT 1")
        .get(groupId, contentId, groupId, contentId, groupId, contentId);
      if (referenced) throw new Error('content is still referenced');
      const row = this.db.prepare('SELECT logical_bytes FROM contents WHERE group_id=? AND content_id=?').get(groupId, contentId) as { logical_bytes: number };
      this.db.prepare('DELETE FROM contents WHERE group_id=? AND content_id=?').run(groupId, contentId);
      this.db.prepare('UPDATE groups SET byte_usage=byte_usage-? WHERE group_id=?').run(row.logical_bytes, groupId);
    });
  }

  putOperation(operation: MultiAgentOperation, control = false): void {
    if (operation.command === 'approval_request') operation = captureApprovalOperationForWrite(operation);
    const existing = this.getOperation(operation.groupId, operation.operationId);
    if (existing && existing.requestHash !== operation.requestHash) throw new Error('operation_id_conflict');
    this.write('operations', operation.groupId, { group_id: operation.groupId, operation_id: operation.operationId }, {}, operation, control);
  }
  getOperation(groupId: string, operationId: string): MultiAgentOperation | null { return this.readScoped('operations', groupId, 'operation_id', operationId); }

  /** Caller supplies a service-validated invocation; this store never issues a waiter or grant. */
  commitApprovalRequest(input: ApprovalRequestOperation): { created: boolean; operation: ApprovalRequestOperation } {
    const operation = captureApprovalOperationForWrite(input), approval = operation.result.approval;
    if (operation.applyState !== 'applied' || approval.status !== 'pending' || approval.persistenceState !== 'confirmed') throw new Error('invalid new approval request');
    return this.transaction(() => {
      this.assertWritable(operation.groupId);
      const group = this.requireGroup(operation.groupId), thread = this.getThread(group.threadId)!;
      if (approval.bootId !== this.bootId || approval.bootId !== group.bootId || approval.threadId !== group.threadId
        || approval.profileId !== thread.profileId || approval.workspaceId !== thread.workspaceId) throw new Error('approval request ownership mismatch');
      const previous = this.getOperation(operation.groupId, operation.operationId);
      if (previous) {
        if (previous.requestHash !== operation.requestHash) throw new Error('operation_id_conflict');
        return { created: false, operation: captureApprovalOperation(previous) };
      }
      this.putOperation(operation);
      this.appendEvent(group.groupId, { kind: 'approval', agentId: approval.agentId, turnId: approval.turnId, payload: { ...approvalEvent(approval) } });
      const changed = this.db.prepare('UPDATE thread_bindings SET pending_approval_count=pending_approval_count+1,thread_revision=thread_revision+1 WHERE thread_id=? AND pending_approval_count<9007199254740991 AND thread_revision<9007199254740991').run(group.threadId);
      if (Number(changed.changes) !== 1) throw new Error('invalid approval thread counter');
      return { created: true, operation };
    });
  }

  finalizeApproval(input: FinalizeApprovalInput): { changed: boolean; operation: ApprovalRequestOperation } {
    return this.finalizeApprovalRecord(input, false);
  }

  private finalizeApprovalRecord(input: FinalizeApprovalInput, recovery: boolean): { changed: boolean; operation: ApprovalRequestOperation } {
    boundedString(input.groupId); boundedString(input.approvalId); boundedString(input.bootId);
    if (!APPROVAL_STATUSES.includes(input.status) || input.status === ('pending' as string)
      || input.reason !== undefined && !APPROVAL_REASONS.includes(input.reason)
      || !recovery && input.bootId !== this.bootId) throw new Error('invalid approval finalization');
    const key = `approval-request:${input.approvalId}`;
    const decision = input.decisionOperation ? JSON.parse(encodeMultiAgentRow(input.decisionOperation)) as MultiAgentOperation : undefined;
    if (decision && (decision.groupId !== input.groupId || decision.operationId === key || decision.command === 'approval_request'
      || Buffer.byteLength(encodeMultiAgentRow(decision)) > 4096)) throw new Error('invalid approval decision receipt');
    return this.transaction(() => {
      const previous = this.getOperation(input.groupId, key);
      if (!previous) throw new Error('unknown approval request');
      const operation = captureApprovalOperation(previous), approval = operation.result.approval, group = this.requireGroup(input.groupId);
      if (approval.bootId !== input.bootId || group.bootId !== approval.bootId || group.threadId !== approval.threadId) throw new Error('stale approval binding');
      if (approval.status !== 'pending' && !(recovery && approval.persistenceState === 'unknown')) return { changed: false, operation };
      if (!recovery && approval.persistenceState !== 'confirmed') throw new Error('approval_persistence_unknown');
      const next = captureApprovalOperation({ ...operation, applyState: 'applied', result: { approval: {
        ...approval, status: input.status, persistenceState: 'confirmed', reason: input.reason,
      } } });
      this.putOperation(next, true);
      if (decision) this.putOperation(decision, true);
      this.appendEvent(group.groupId, { kind: 'approval', agentId: approval.agentId, turnId: approval.turnId, payload: { ...approvalEvent(next.result.approval) } });
      if (recovery) {
        this.updateApprovalCount(group.threadId, this.rawPendingApprovalCount(group.threadId), true);
      } else {
        const changed = this.db.prepare('UPDATE thread_bindings SET pending_approval_count=pending_approval_count-1,thread_revision=thread_revision+1 WHERE thread_id=? AND pending_approval_count>0 AND thread_revision<9007199254740991').run(group.threadId);
        if (Number(changed.changes) !== 1) throw new Error('invalid approval thread counter');
      }
      return { changed: true, operation: next };
    });
  }

  listApprovalRequests(input: { groupId: string; bootId: string; cursor?: string; limit?: number }): MultiAgentPage<ApprovalRequestOperation> {
    boundedString(input.groupId); boundedString(input.bootId); if (input.cursor !== undefined) boundedString(input.cursor);
    const limit = this.limit(input.limit ?? 50, 50);
    const rows = this.db.prepare("SELECT data_json,logical_bytes FROM operations WHERE group_id=? AND json_extract(data_json,'$.result.approval.bootId')=? AND json_extract(data_json,'$.command')='approval_request' AND operation_id>? ORDER BY operation_id LIMIT ?")
      .all(input.groupId, input.bootId, input.cursor ?? '', limit + 1) as unknown as JsonRow[];
    const items = rows.slice(0, limit).map(row => captureApprovalOperation(this.parse(row)));
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.operationId : null };
  }

  private rawPendingApprovalCount(threadId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM operations o JOIN groups g ON g.group_id=o.group_id WHERE g.thread_id=? AND json_extract(o.data_json,'$.command')='approval_request' AND json_extract(o.data_json,'$.result.approval.status')='pending'")
      .get(threadId) as { count: number };
    safeInteger(row.count); return row.count;
  }
  private updateApprovalCount(threadId: string, count: number, changedFact = false): void {
    safeInteger(count);
    const thread = this.getThread(threadId);
    if (!thread) throw new Error('unknown approval thread');
    if (!changedFact && thread.pendingApprovalCount === count) return;
    const changed = this.db.prepare('UPDATE thread_bindings SET pending_approval_count=?,thread_revision=thread_revision+1 WHERE thread_id=? AND thread_revision<9007199254740991').run(count, threadId);
    if (Number(changed.changes) !== 1) throw new Error('invalid approval thread counter');
  }

  private recoverApprovalRequests(): void {
    // Same original store recovery transaction/readiness stage. No host/Goal
    // callbacks or live authority are created here, including on an old boot.
    for (const group of this.previousGroups()) {
      let cursor: string | undefined;
      do {
        const page = this.listApprovalRequests({ groupId: group.groupId, bootId: group.bootId, cursor });
        for (const operation of page.items) {
          const approval = operation.result.approval;
          if (approval.status === 'pending' || approval.persistenceState === 'unknown') this.finalizeApprovalRecord({
            groupId: group.groupId, approvalId: approval.approvalId, bootId: group.bootId, status: 'invalidated', reason: 'restart',
          }, true);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      this.updateApprovalCount(group.threadId, this.rawPendingApprovalCount(group.threadId));
    }
  }
  pendingCloseOperations(groupId: string): MultiAgentOperation[] {
    return (this.db.prepare("SELECT data_json,logical_bytes FROM operations WHERE group_id=? AND json_extract(data_json,'$.command')='close' AND json_extract(data_json,'$.applyState')='applied' AND json_extract(data_json,'$.result.state')='cleanup_pending'")
      .all(groupId) as unknown as JsonRow[]).map(row => this.parse<MultiAgentOperation>(row));
  }
  putRootBinding(binding: MultiAgentRootBinding, control = false): void {
    const existing = this.getRootBinding(binding.sourceTaskId);
    if (existing && (existing.groupId !== binding.groupId || existing.preparationId !== binding.preparationId)) throw new Error('source task binding conflict');
    this.write('root_turns', binding.groupId, { source_task_id: binding.sourceTaskId }, { group_id: binding.groupId, preparation_id: binding.preparationId, boot_id: binding.bootId }, binding, control);
  }
  getRootBinding(taskId: string): MultiAgentRootBinding | null { return this.readOne('root_turns', 'source_task_id', taskId); }
  *previousRootBindings(): Generator<MultiAgentRootBinding> {
    let cursor = '';
    for (;;) {
      const rows = this.db.prepare('SELECT data_json,logical_bytes FROM root_turns WHERE boot_id<>? AND source_task_id>? ORDER BY source_task_id LIMIT 50')
        .all(this.bootId, cursor) as unknown as JsonRow[];
      for (const row of rows) { const binding = this.parse<MultiAgentRootBinding>(row); cursor = binding.sourceTaskId; yield binding; }
      if (rows.length < 50) break;
    }
  }
  putResource(resource: MultiAgentManagedResource, control = false): void {
    this.write('managed_resources', resource.groupId, { resource_id: resource.resourceId }, { group_id: resource.groupId, agent_id: resource.agentId }, resource, control);
  }
  resources(groupId: string): MultiAgentManagedResource[] { return this.readGroupRows('managed_resources', groupId); }
  listResources(groupId: string, cursor?: string): MultiAgentPage<MultiAgentManagedResource> {
    if (cursor !== undefined && (!cursor || cursor.length > 256)) throw new Error('invalid resource cursor');
    const rows = (this.db.prepare('SELECT data_json,logical_bytes FROM managed_resources WHERE group_id=? AND resource_id>? ORDER BY resource_id LIMIT 51')
      .all(groupId, cursor ?? '') as unknown as JsonRow[]).map(row => this.parse<MultiAgentManagedResource>(row));
    const items: MultiAgentManagedResource[] = []; let bytes = 256;
    for (const row of rows.slice(0, 50)) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (size > 48 * 1024) throw new Error('resource exceeds wire page limit');
      if (bytes + size > 48 * 1024) break;
      items.push(row); bytes += size;
    }
    return { items, nextCursor: items.length < rows.length ? items.at(-1)!.resourceId : null };
  }

  recoverPreviousBoot(): void {
    this.transaction(() => {
      this.recoverApprovalRequests();
      // User resource disposition is allowed on historical groups too. A crash
      // during that operation must not preserve an old live/pending receipt.
      const uncertain = this.db.prepare(`SELECT o.data_json,o.logical_bytes FROM operations o JOIN groups g ON g.group_id=o.group_id
        WHERE g.boot_id<>? AND (json_extract(o.data_json,'$.applyState')='prepared'
          OR json_extract(o.data_json,'$.result.state')='cleanup_pending' OR json_extract(o.data_json,'$.result.phase')='cleanup_pending')`)
        .all(this.bootId) as unknown as JsonRow[];
      for (const row of uncertain) {
        const operation = this.parse<MultiAgentOperation>(row);
        if (operation.applyState !== 'unknown') this.putOperation({ ...operation, applyState: 'unknown' }, true);
      }
      const groups = (this.db.prepare('SELECT data_json,logical_bytes FROM groups WHERE boot_id<>? AND historical_only=0').all(this.bootId) as unknown as JsonRow[]).map(row => this.parse<DesktopMultiAgentGroup>(row));
      for (const group of groups) {
        this.repairByteUsage(group.groupId);
        for (const agent of this.allAgents(group.groupId)) this.putAgent(group.groupId, {
          ...agent, status: agent.status === 'pending' || agent.status === 'running' ? 'interrupted' : agent.status,
          executionActive: false, sessionResident: false, runtimeResident: false, resumable: false,
          closeReason: 'restart', activationState: 'settled',
        }, true);
        for (const message of this.readGroupRows<MultiAgentMessage>('messages', group.groupId)) {
          if (message.deliveryState === 'consuming') this.putMessage({ ...message, deliveryState: 'unread', claimId: null, turnId: null }, true);
        }
        for (const binding of this.readGroupRows<MultiAgentRootBinding>('root_turns', group.groupId)) {
          if (binding.phase !== 'settled' && binding.phase !== 'abandoned') this.putRootBinding({ ...binding, status: 'interrupted', phase: 'abandoned' }, true);
        }
        this.putGroup({ ...group, historicalOnly: true, byteUsage: this.getByteUsage(group.groupId) }, true);
        this.clearActiveGroup(group.threadId, group.groupId);
      }
    });
  }

  getByteUsage(groupId: string): number {
    return (this.db.prepare('SELECT byte_usage FROM groups WHERE group_id=?').get(groupId) as { byte_usage: number } | undefined)?.byte_usage ?? 0;
  }
  recomputeByteUsage(groupId: string): number {
    return TABLES.reduce((total, table) => total + (this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE group_id=?`).all(groupId) as unknown as JsonRow[])
      .reduce((sum, row) => sum + Buffer.byteLength(encodeMultiAgentRow(JSON.parse(row.data_json))), 0), 0);
  }
  private repairByteUsage(groupId: string): void {
    for (const table of TABLES) {
      const rows = this.db.prepare(`SELECT rowid,data_json FROM ${table} WHERE group_id=?`).all(groupId) as unknown as Array<{ rowid: number; data_json: string }>;
      for (const row of rows) this.db.prepare(`UPDATE ${table} SET logical_bytes=? WHERE rowid=?`).run(Buffer.byteLength(encodeMultiAgentRow(JSON.parse(row.data_json))), row.rowid);
    }
    this.db.prepare('UPDATE groups SET byte_usage=? WHERE group_id=?').run(this.recomputeByteUsage(groupId), groupId);
  }
  private assertWritable(groupId: string, settlement = false): void {
    const group = this.requireGroup(groupId);
    if (group.historicalOnly || group.bootId !== this.bootId) throw new Error('historical group is read-only');
    if (group.mutationBlockedReason && !settlement) throw new Error(group.mutationBlockedReason);
  }
  private putMessage(message: MultiAgentMessage, control = false): void {
    this.write('messages', message.groupId, { message_id: message.messageId }, {
      group_id: message.groupId, sender_kind: message.sender.kind,
      sender_agent_id: message.sender.kind === 'agent' ? message.sender.agentId : null,
      sender_actor_id: message.sender.kind === 'user' ? message.sender.actorId : null,
      receiver_id: message.receiverId, delivery_state: message.deliveryState,
      claim_id: message.claimId, turn_id: message.turnId, created_at: message.createdAt,
    }, message, control);
  }

  private write(table: Table, groupId: string, key: Record<string, SqlValue>, indexes: Record<string, SqlValue>, data: unknown, control: boolean): void {
    this.transaction(() => {
      const json = encodeMultiAgentRow(data);
      const size = Buffer.byteLength(json);
      const where = Object.keys(key).map(column => `${column}=?`).join(' AND ');
      const previous = this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE ${where}`).get(...Object.values(key)) as JsonRow | undefined;
      if (control && size > 4 * 1024 && (!previous || size > previous.logical_bytes)) throw new Error('control row exceeds reserve record limit');
      const delta = size - (previous?.logical_bytes ?? 0);
      const usage = this.getByteUsage(groupId);
      if (delta > 0 && usage + delta > this.maxBytes - (control ? 0 : this.reserveBytes)) throw new Error('multi_agent_quota_exhausted');
      const columns = { ...key, ...indexes, data_json: json, logical_bytes: size };
      const names = Object.keys(columns);
      const updates = names.filter(column => !(column in key)).map(column => `${column}=excluded.${column}`).join(',');
      this.db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')}) ON CONFLICT(${Object.keys(key).join(',')}) DO UPDATE SET ${updates}`)
        .run(...Object.values(columns));
      this.db.prepare('UPDATE groups SET byte_usage=byte_usage+? WHERE group_id=?').run(delta, groupId);
    });
  }

  private readOne<T>(table: Table, column: string, value: string): T | null {
    const row = this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE ${column}=?`).get(value) as JsonRow | undefined;
    return row ? this.parse<T>(row) : null;
  }
  private readScoped<T>(table: Table, groupId: string, column: string, value: string): T | null {
    const row = this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE group_id=? AND ${column}=?`).get(groupId, value) as JsonRow | undefined;
    return row ? this.parse<T>(row) : null;
  }
  private readGroupRows<T>(table: Table, groupId: string): T[] {
    return (this.db.prepare(`SELECT data_json,logical_bytes FROM ${table} WHERE group_id=? ORDER BY rowid`).all(groupId) as unknown as JsonRow[]).map(row => this.parse<T>(row));
  }
  private parse<T>(row: JsonRow): T { return JSON.parse(row.data_json) as T; }
  private limit(value: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid page limit');
    return Math.min(maximum, value);
  }
  private cursor(value: string | undefined, time: number, id: string): [number, string] {
    if (!value) return [time, id];
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isFinite(parsed[0]) || typeof parsed[1] !== 'string') throw new Error('invalid page cursor');
    return parsed as [number, string];
  }
  private page<T>(items: T[], limit: number, identity: (value: T) => [number, string]): MultiAgentPage<T> {
    const size = this.limit(limit, 50);
    const visible = items.slice(0, size);
    return { items: visible, nextCursor: items.length > size ? Buffer.from(JSON.stringify(identity(visible.at(-1)!))).toString('base64url') : null };
  }

  private applySchema(version: number): void {
    const base = `
      CREATE TABLE IF NOT EXISTS thread_bindings(thread_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cwd TEXT NOT NULL,active_group_id TEXT,thread_revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS boot_owners(boot_id TEXT PRIMARY KEY,owner_pid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','exited','quiesced')));
      CREATE TABLE IF NOT EXISTS groups(group_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES thread_bindings(thread_id),boot_id TEXT NOT NULL,historical_only INTEGER NOT NULL,created_at INTEGER NOT NULL,byte_usage INTEGER NOT NULL DEFAULT 0,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agents(group_id TEXT NOT NULL REFERENCES groups(group_id),agent_id TEXT NOT NULL UNIQUE,parent_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL CHECK(json_extract(data_json,'$.status') IN ('pending','running','completed','failed','interrupted','closed')),logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,agent_id),FOREIGN KEY(group_id,parent_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS events(group_id TEXT NOT NULL,seq INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,seq),FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS messages(message_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),sender_kind TEXT NOT NULL,sender_agent_id TEXT,sender_actor_id TEXT,receiver_id TEXT NOT NULL,delivery_state TEXT NOT NULL,claim_id TEXT,turn_id TEXT,created_at INTEGER NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,CHECK((sender_kind='agent' AND sender_agent_id IS NOT NULL AND sender_actor_id IS NULL) OR (sender_kind='user' AND sender_agent_id IS NULL AND sender_actor_id IS NOT NULL)),CHECK(delivery_state IN ('unread','consuming','context_applied')),CHECK(delivery_state<>'unread' OR (claim_id IS NULL AND turn_id IS NULL)),FOREIGN KEY(group_id,sender_agent_id) REFERENCES agents(group_id,agent_id),FOREIGN KEY(group_id,receiver_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS contents(content_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
      CREATE TABLE IF NOT EXISTS operations(group_id TEXT NOT NULL REFERENCES groups(group_id),operation_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,PRIMARY KEY(group_id,operation_id));
      CREATE TABLE IF NOT EXISTS root_turns(source_task_id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(group_id),preparation_id TEXT NOT NULL UNIQUE,boot_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_resources(resource_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,agent_id TEXT NOT NULL,data_json TEXT NOT NULL,logical_bytes INTEGER NOT NULL,FOREIGN KEY(group_id,agent_id) REFERENCES agents(group_id,agent_id));
      CREATE INDEX IF NOT EXISTS agents_page ON agents(group_id,created_at,agent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS agents_presentation_ordinal ON agents(group_id,json_extract(data_json,'$.presentationOrdinal')) WHERE json_extract(data_json,'$.presentationOrdinal') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS messages_receiver ON messages(group_id,receiver_id,created_at);
      CREATE INDEX IF NOT EXISTS messages_claim ON messages(group_id,claim_id);
      CREATE INDEX IF NOT EXISTS root_turns_boot ON root_turns(boot_id);
      CREATE INDEX IF NOT EXISTS groups_page ON groups(thread_id,created_at,group_id);
    `;
    if (version === 2) { this.validateSchema(2, base); return; }
    this.transaction(() => {
      if (version === 0) this.db.exec(base); else this.validateSchema(1, base);
      const columns = new Set((this.db.prepare('PRAGMA table_info(thread_bindings)').all() as unknown as Array<{ name: string }>).map(column => column.name));
      for (const column of THREAD_DELETION_COLUMNS) if (!columns.has(column.split(' ')[0])) this.db.exec(`ALTER TABLE thread_bindings ADD COLUMN ${column}`);
      this.db.exec(WORKSPACE_AUTHORIZATION_SQL);
      this.db.exec(`ALTER TABLE thread_bindings ADD COLUMN ${APPROVAL_COUNT_COLUMN}`);
      this.db.exec(APPROVAL_INDEX_SQL);
      this.db.exec('PRAGMA user_version=2');
      this.validateSchema(2, base);
    });
  }

  private validateSchema(version: 1 | 2, base: string): void {
    const definitions = base.split(';').map(sql => sql.trim()).filter(Boolean);
    if (version === 2) definitions.push(WORKSPACE_AUTHORIZATION_SQL, APPROVAL_INDEX_SQL);
    for (let expected of definitions) {
      const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX)(?: IF NOT EXISTS)? ([a-z_]+)/i.exec(expected);
      if (!match) throw new Error('multi_agent_schema_invalid');
      const [, kind, name] = match;
      if (name === 'thread_bindings') {
        const present = new Set((this.db.prepare('PRAGMA table_info(thread_bindings)').all() as unknown as Array<{ name: string }>).map(column => column.name));
        const extras = [...THREAD_DELETION_COLUMNS.filter(column => version === 2 || present.has(column.split(' ')[0])), ...(version === 2 ? [APPROVAL_COUNT_COLUMN] : [])];
        if (extras.length) expected = expected.replace(/\)$/, `,${extras.join(',')})`);
      }
      const actual = this.db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(kind.toLowerCase(), name) as { sql: string } | undefined;
      if (!actual || schemaSql(actual.sql) !== schemaSql(expected)) throw new Error(`multi_agent_schema_invalid:${name}`);
    }
  }
}
