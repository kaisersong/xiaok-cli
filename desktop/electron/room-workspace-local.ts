import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { lstat, realpath, open, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import path, { dirname, join, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** R3 protocol digest. Only the JSON data model is accepted, never coercions. */
export function canonicalWorkspaceJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('workspace_noncanonical_json');
    return `[${value.map(canonicalWorkspaceJson).join(',')}]`;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalWorkspaceJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('workspace_noncanonical_json');
}

export function workspaceDigest(kind: string, value: unknown): string {
  return createHash('sha256').update(`xiaok.room-workspace.v1/${kind}\n${canonicalWorkspaceJson(value)}`).digest('hex');
}

export function pathWithin(root: string, target: string, implementation = path): boolean {
  const relative = implementation.relative(implementation.resolve(root), implementation.resolve(target));
  return relative === '' || (!implementation.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${implementation.sep}`));
}

export interface WorkspaceRoot {
  canonicalRoot: string;
  identity: { dev: string; ino: string; birthtimeNs: string };
}
export interface LocalWorkspaceBinding extends WorkspaceRoot {
  bindingId: string; workspaceId: string; roomId: string; hostId: string; generation: number;
  requestId: string; payloadDigest: string; createdBy: string;
  state: 'prepared' | 'active' | 'retired' | 'activation_failed';
}
type BindingInput = Omit<LocalWorkspaceBinding, 'state'>;

export async function prepareWorkspaceRoot(selected: string): Promise<WorkspaceRoot> {
  if (!path.isAbsolute(selected) || selected.includes('\0')) throw new Error('workspace_path_invalid');
  const canonicalRoot = await realpath(selected);
  const stat = await lstat(canonicalRoot, { bigint: true });
  if (!stat.isDirectory()) throw new Error('workspace_directory_required');
  return { canonicalRoot, identity: { dev: stat.dev.toString(), ino: stat.ino.toString(), birthtimeNs: stat.birthtimeNs.toString() } };
}

async function verifyRoot(binding: WorkspaceRoot): Promise<void> {
  const observed = await prepareWorkspaceRoot(binding.canonicalRoot);
  if (observed.canonicalRoot !== binding.canonicalRoot || canonicalWorkspaceJson(observed.identity) !== canonicalWorkspaceJson(binding.identity)) throw new Error('workspace_identity_changed');
}

/** Validate each existing component, including a terminal symlink/junction. */
export async function resolveWorkspacePath(binding: WorkspaceRoot, relativePath: string, allowMissing = false): Promise<string> {
  await verifyRoot(binding);
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || path.isAbsolute(relativePath) || win32.isAbsolute(relativePath) || /^[a-z]:/i.test(relativePath)) throw new Error('workspace_path_invalid');
  const components = relativePath.split(/[\\/]/).filter(part => part && part !== '.');
  if (components.some(part => part === '..')) throw new Error('workspace_path_escape');
  let current = binding.canonicalRoot;
  for (const component of components) {
    current = join(current, component);
    try {
      const resolved = await realpath(current);
      if (!pathWithin(binding.canonicalRoot, resolved)) throw new Error('workspace_path_escape');
      current = resolved;
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Continue resolving later components too: an existing symlink with a missing
      // target is not a valid new file location.
      try { const stat = await lstat(current); if (stat.isSymbolicLink()) throw new Error('workspace_path_escape'); }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
    }
  }
  if (!pathWithin(binding.canonicalRoot, current)) throw new Error('workspace_path_escape');
  return current;
}

export async function observeWorkspaceFile(binding: WorkspaceRoot, relativePath: string) {
  const target = await resolveWorkspacePath(binding, relativePath);
  const handle = await open(target, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error('workspace_file_required');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat({ bigint: true });
    const pathname = await lstat(target, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || pathname.dev !== after.dev || pathname.ino !== after.ino) throw new Error('workspace_file_changed');
    await verifyRoot(binding);
    return { relativePath, contentHash: hash.digest('hex'), size: Number(after.size), observedAt: new Date().toISOString() };
  } finally { await handle.close(); }
}

// The application-level OS owner gate guards entry to this module; locks here
// serialize physical paths (not Room IDs) within that sole mutation process.
const writes = new Map<string, Promise<void>>();
export async function managedWorkspaceWrite(binding: WorkspaceRoot, relativePath: string, content: string | Uint8Array, expectedHash: string | null) {
  const target = await resolveWorkspacePath(binding, relativePath, true);
  const key = process.platform === 'win32' ? target.toLowerCase() : target;
  const previous = writes.get(key) ?? Promise.resolve();
  let finish!: () => void;
  const current = new Promise<void>(resolve => { finish = resolve; });
  writes.set(key, current);
  await previous;
  let temporary: string | undefined;
  try {
    if (await resolveWorkspacePath(binding, relativePath, true) !== target) throw new Error('workspace_identity_changed');
    let actual: string | null = null;
    try { actual = (await observeWorkspaceFile(binding, relativePath)).contentHash; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (actual !== expectedHash) throw new Error('workspace_write_conflict');
    // Preserve the ordinary write tool's requested-parent behavior. Resolve
    // and verify each component, never recursively create through an unchecked
    // symlink/junction. Partial directories are user data and are not rolled back.
    const parentParts = path.relative(binding.canonicalRoot, dirname(target)).split(path.sep).filter(Boolean);
    for (let index=0;index<parentParts.length;index++) {
      const parentRelative=parentParts.slice(0,index+1).join(path.sep);
      const parent=await resolveWorkspacePath(binding,parentRelative,true);
      try { await mkdir(parent); }
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      if(await resolveWorkspacePath(binding,parentRelative)!==parent||!(await lstat(parent)).isDirectory())throw new Error('workspace_identity_changed');
    }
    if(await resolveWorkspacePath(binding,relativePath,true)!==target)throw new Error('workspace_identity_changed');
    temporary = join(dirname(target), `.xiaok-write-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await resolveWorkspacePath(binding, relativePath, true);
    await rename(temporary, target); temporary = undefined;
    return await observeWorkspaceFile(binding, relativePath);
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
    finish(); if (writes.get(key) === current) writes.delete(key);
  }
}

export interface WorkspaceTemplateEntry { relativePath: string; kind: 'directory' | 'file'; text?: string }
export async function previewWorkspaceTemplate(binding: WorkspaceRoot, entries: WorkspaceTemplateEntry[]) {
  const result = [];
  for (const entry of entries) {
    if (!entry.relativePath || !['directory', 'file'].includes(entry.kind)) throw new Error('workspace_template_invalid');
    const target = await resolveWorkspacePath(binding, entry.relativePath, true);
    let state: 'create' | 'exists' | 'conflict' = 'create';
    try { const stat = await lstat(target); state = entry.kind === 'directory' ? stat.isDirectory() ? 'exists' : 'conflict' : stat.isFile() ? 'exists' : 'conflict'; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    result.push({ ...entry, state });
  }
  return result;
}

export async function applyWorkspaceTemplate(binding: WorkspaceRoot, entries: WorkspaceTemplateEntry[]) {
  const preview = await previewWorkspaceTemplate(binding, entries);
  if (preview.some(entry => entry.state === 'conflict')) throw new Error('workspace_template_conflict');
  for (const entry of entries) {
    const target = await resolveWorkspacePath(binding, entry.relativePath, true);
    try {
      if (entry.kind === 'directory') await mkdir(target);
      else { const handle = await open(target, 'wx', 0o600); try { await handle.writeFile(entry.text ?? ''); await handle.sync(); } finally { await handle.close(); } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await lstat(target);
      if (entry.kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error('workspace_template_conflict');
    }
  }
}

export async function listWorkspaceDirectory(binding: WorkspaceRoot, relativePath: string, cursor = 0, limit = 100) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('workspace_cursor_invalid');
  const target = await resolveWorkspacePath(binding, relativePath);
  const entries = (await readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const page = entries.slice(cursor, cursor + Math.min(100, Math.max(1, limit)));
  return { entries: page.map(entry => ({ name: entry.name, relativePath: join(relativePath, entry.name).replace(/\\/g, '/'), kind: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file' })), nextCursor: cursor + page.length < entries.length ? cursor + page.length : undefined };
}

interface LocalSubmission { submissionId: string; subjectKey: string; payloadDigest: string; manifest: Record<string, unknown> }
interface CommitTicket { ticketId: string; submissionId: string; payloadDigest: string; commitSequence: number }

/** Local physical facts only; broker remains sole authorization/active pointer owner. */
export class RoomWorkspaceLocalStore {
  private readonly db: DatabaseSync;
  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS room_workspace_local_journal (kind TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,key));
      CREATE TABLE IF NOT EXISTS room_workspace_bindings (binding_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL, room_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_workspace_submissions (subject_key TEXT NOT NULL, submission_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, ticket_id TEXT UNIQUE, PRIMARY KEY(subject_key,submission_id));
      CREATE TABLE IF NOT EXISTS room_workspace_artifacts (version_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, ticket_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_workspace_outbox (event_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, event_kind TEXT NOT NULL, data TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, UNIQUE(ticket_id,event_kind));`);
  }
  close() { this.db.close(); }
  localCommandsAllowed(scope: {bindingId:string;roomId:string;generation:number}):boolean {
    const grant=this.getRecord<{enabled:boolean;roomId:string;generation:number}>('local-command-grant',scope.bindingId);
    return grant===null || grant.enabled===true&&grant.roomId===scope.roomId&&grant.generation===scope.generation;
  }
  getRecord<T>(kind: string, key: string): T | null {
    const row = this.db.prepare('SELECT data FROM room_workspace_local_journal WHERE kind=? AND key=?').get(kind, key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : null;
  }
  saveRecord(kind: string, key: string, data: unknown) { this.db.prepare('INSERT INTO room_workspace_local_journal VALUES (?,?,?) ON CONFLICT(kind,key) DO UPDATE SET data=excluded.data').run(kind, key, canonicalWorkspaceJson(data)); }
  listRecords<T>(kind: string): T[] { return this.db.prepare('SELECT data FROM room_workspace_local_journal WHERE kind=?').all(kind).map(row => JSON.parse(row.data as string) as T); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  prepareBinding(input: BindingInput): LocalWorkspaceBinding {
    return this.transaction(() => {
      const old = this.db.prepare('SELECT data FROM room_workspace_bindings WHERE request_id=? OR binding_id=?').get(input.requestId, input.bindingId) as { data: string } | undefined;
      if (old) {
        const parsed = JSON.parse(old.data) as BindingInput;
        if (canonicalWorkspaceJson(parsed) !== canonicalWorkspaceJson(input)) throw new Error('workspace_idempotency_conflict');
        return this.getBinding(parsed.bindingId)!;
      }
      this.db.prepare("INSERT INTO room_workspace_bindings VALUES (?,?,?,?,'prepared',?)").run(input.bindingId, input.requestId, input.workspaceId, input.roomId, canonicalWorkspaceJson(input));
      return { ...input, state: 'prepared' };
    });
  }
  getBinding(bindingId: string): LocalWorkspaceBinding | null {
    const row = this.db.prepare('SELECT data,state FROM room_workspace_bindings WHERE binding_id=?').get(bindingId) as { data: string; state: LocalWorkspaceBinding['state'] } | undefined;
    return row ? { ...JSON.parse(row.data), state: row.state } : null;
  }
  listBindings(roomId?: string): LocalWorkspaceBinding[] {
    const rows = roomId ? this.db.prepare('SELECT binding_id FROM room_workspace_bindings WHERE room_id=?').all(roomId) : this.db.prepare('SELECT binding_id FROM room_workspace_bindings').all();
    return rows.map(row => this.getBinding(row.binding_id as string)!);
  }
  activateBinding(bindingId: string, committed: { workspaceId: string; activeBindingId: string; generation: number }) {
    this.transaction(() => {
      const binding = this.getBinding(bindingId);
      if (!binding || binding.bindingId !== committed.activeBindingId || binding.workspaceId !== committed.workspaceId || binding.generation !== committed.generation) throw new Error('workspace_binding_mismatch');
      this.db.prepare("UPDATE room_workspace_bindings SET state='retired' WHERE workspace_id=? AND binding_id != ? AND state='active'").run(binding.workspaceId, binding.bindingId);
      this.db.prepare("UPDATE room_workspace_bindings SET state='active' WHERE binding_id=?").run(bindingId);
    });
  }
  markActivationFailed(bindingId: string) { this.db.prepare("UPDATE room_workspace_bindings SET state='activation_failed' WHERE binding_id=?").run(bindingId); }
  prepareSubmission(input: LocalSubmission) {
    this.transaction(() => {
      const old = this.db.prepare('SELECT digest,data FROM room_workspace_submissions WHERE subject_key=? AND submission_id=?').get(input.subjectKey, input.submissionId) as { digest: string; data: string } | undefined;
      const data = canonicalWorkspaceJson(input.manifest);
      if (old) { if (old.digest !== input.payloadDigest || old.data !== data) throw new Error('workspace_idempotency_conflict'); return; }
      if (workspaceDigest('manifest', input.manifest) !== input.payloadDigest) throw new Error('workspace_digest_mismatch');
      this.db.prepare('INSERT INTO room_workspace_submissions VALUES (?,?,?,?,NULL)').run(input.subjectKey, input.submissionId, input.payloadDigest, data);
    });
  }
  listPendingSubmissions(roomId?: string) {
    return this.db.prepare('SELECT subject_key,submission_id,digest,data FROM room_workspace_submissions WHERE ticket_id IS NULL').all().flatMap(row => {
      const manifest = JSON.parse(String(row.data)) as Record<string, unknown>;
      return roomId !== undefined && manifest.roomId !== roomId ? [] : [{ subjectKey: String(row.subject_key), submissionId: String(row.submission_id), payloadDigest: String(row.digest), manifest }];
    });
  }
  commitSubmission(subjectKey: string, ticket: CommitTicket) {
    this.transaction(() => {
      const pending = this.db.prepare('SELECT digest,data,ticket_id FROM room_workspace_submissions WHERE subject_key=? AND submission_id=?').get(subjectKey, ticket.submissionId) as { digest: string; data: string; ticket_id: string | null } | undefined;
      if (!pending || pending.digest !== ticket.payloadDigest || (pending.ticket_id && pending.ticket_id !== ticket.ticketId)) throw new Error('workspace_ticket_mismatch');
      if (pending.ticket_id) return;
      const manifest = JSON.parse(pending.data) as { roomId: string; artifacts?: Record<string, unknown>[] };
      this.db.prepare('UPDATE room_workspace_submissions SET ticket_id=? WHERE subject_key=? AND submission_id=?').run(ticket.ticketId, subjectKey, ticket.submissionId);
      for (const [index, artifact] of (manifest.artifacts ?? []).entries()) {
        const versionId = workspaceDigest('artifact-version', { ticketId: ticket.ticketId, index });
        const data = { ...manifest, artifacts: undefined, ...artifact, versionId, artifactId: versionId, commitTicketId: ticket.ticketId, state: 'draft' };
        delete data.artifacts;
        this.db.prepare('INSERT INTO room_workspace_artifacts VALUES (?,?,?,?)').run(versionId, manifest.roomId, ticket.ticketId, canonicalWorkspaceJson(data));
      }
      const eventKind = 'artifact.registered'; const eventId = workspaceDigest('event', { ticketId: ticket.ticketId, eventKind });
      this.db.prepare('INSERT INTO room_workspace_outbox VALUES (?,?,?,?,0)').run(eventId, ticket.ticketId, eventKind, canonicalWorkspaceJson({ eventId, eventKind, ticket, manifest }));
    });
  }
  confirmArtifact(roomId: string, versionId: string, ticket: { ticketId: string; payloadDigest: string; commitSequence: number }) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT data FROM room_workspace_artifacts WHERE room_id=? AND version_id=?').get(roomId, versionId) as { data: string } | undefined;
      if (!row) throw new Error('workspace_version_not_found');
      const artifact = JSON.parse(row.data);
      if (ticket.payloadDigest !== workspaceDigest('confirmation', { artifactId: artifact.artifactId, versionId })) throw new Error('workspace_digest_mismatch');
      const eventKind = 'artifact.confirmed'; const eventId = workspaceDigest('event', { ticketId: ticket.ticketId, eventKind });
      if (this.db.prepare('SELECT event_id FROM room_workspace_outbox WHERE event_id=?').get(eventId)) return;
      this.db.prepare('UPDATE room_workspace_artifacts SET data=? WHERE version_id=?').run(canonicalWorkspaceJson({ ...artifact, state: 'confirmed', confirmationTicketId: ticket.ticketId }), versionId);
      this.db.prepare('INSERT INTO room_workspace_outbox VALUES (?,?,?,?,0)').run(eventId, ticket.ticketId, eventKind, canonicalWorkspaceJson({ eventId, eventKind, ticket, manifest: { roomId, versionId } }));
    });
  }
  listArtifacts(roomId: string): Record<string, unknown>[] { return this.db.prepare('SELECT data FROM room_workspace_artifacts WHERE room_id=?').all(roomId).map(row => JSON.parse(row.data as string)); }
  listHandoffs(roomId: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT data,ticket_id FROM room_workspace_submissions WHERE ticket_id IS NOT NULL').all().flatMap(row => {
      const manifest = JSON.parse(row.data as string);
      return manifest.roomId === roomId && manifest.handoff ? [{ roomId, workspaceId: manifest.workspaceId, bindingId: manifest.bindingId, generation: manifest.generation, contextScope: manifest.contextScope, handoffId: row.ticket_id, ...manifest.handoff }] : [];
    });
  }
  pendingOutbox(): Array<{ eventId: string; [key: string]: unknown }> { return this.db.prepare('SELECT data FROM room_workspace_outbox WHERE delivered=0').all().map(row => JSON.parse(row.data as string)); }
  acknowledgeOutbox(eventId: string) { this.db.prepare('UPDATE room_workspace_outbox SET delivered=1 WHERE event_id=?').run(eventId); }
}
