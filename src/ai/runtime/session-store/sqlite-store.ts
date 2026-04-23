import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Message } from '../../../types.js';
import type { PersistedSessionSnapshot, SessionListEntry, SessionStore } from './store.js';
import { applySessionStoreSchema } from './schema.js';

interface SessionRow {
  session_id: string;
  cwd: string;
  model: string | null;
  created_at: number;
  updated_at: number;
  forked_from_session_id: string | null;
  lineage_json: string;
  usage_json: string;
  compactions_json: string;
  prompt_snapshot_id: string | null;
  memory_refs_json: string;
  approval_refs_json: string;
  background_job_refs_json: string;
  intent_delegation_json: string | null;
  skill_eval_json: string | null;
}

interface SessionMessageRow {
  message_id: number;
  session_id: string;
  message_index: number;
  role: Message['role'];
  content_json: string;
  text_content: string;
}

export interface SessionMessageSearchHit {
  sessionId: string;
  messageIndex: number;
  role: Message['role'];
  textContent: string;
}

export class SQLiteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    applySessionStoreSchema(this.db);
  }

  createSessionId(): string {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async save(snapshot: PersistedSessionSnapshot): Promise<void> {
    const saveTransaction = this.db.transaction((nextSnapshot: PersistedSessionSnapshot) => {
      this.db.prepare(`
        INSERT INTO sessions (
          session_id, cwd, model, created_at, updated_at, forked_from_session_id,
          lineage_json, usage_json, compactions_json, prompt_snapshot_id,
          memory_refs_json, approval_refs_json, background_job_refs_json,
          intent_delegation_json, skill_eval_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          cwd = excluded.cwd,
          model = excluded.model,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          forked_from_session_id = excluded.forked_from_session_id,
          lineage_json = excluded.lineage_json,
          usage_json = excluded.usage_json,
          compactions_json = excluded.compactions_json,
          prompt_snapshot_id = excluded.prompt_snapshot_id,
          memory_refs_json = excluded.memory_refs_json,
          approval_refs_json = excluded.approval_refs_json,
          background_job_refs_json = excluded.background_job_refs_json,
          intent_delegation_json = excluded.intent_delegation_json,
          skill_eval_json = excluded.skill_eval_json
      `).run(
        nextSnapshot.sessionId,
        nextSnapshot.cwd,
        nextSnapshot.model ?? null,
        nextSnapshot.createdAt,
        nextSnapshot.updatedAt,
        nextSnapshot.forkedFromSessionId ?? null,
        JSON.stringify(nextSnapshot.lineage),
        JSON.stringify(nextSnapshot.usage),
        JSON.stringify(nextSnapshot.compactions),
        nextSnapshot.promptSnapshotId ?? null,
        JSON.stringify(nextSnapshot.memoryRefs),
        JSON.stringify(nextSnapshot.approvalRefs),
        JSON.stringify(nextSnapshot.backgroundJobRefs),
        JSON.stringify(nextSnapshot.intentDelegation ?? null),
        JSON.stringify(nextSnapshot.skillEval ?? null),
      );

      this.db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(nextSnapshot.sessionId);
      this.db.prepare('DELETE FROM session_messages_fts WHERE session_id = ?').run(nextSnapshot.sessionId);

      const insertMessage = this.db.prepare(`
        INSERT INTO session_messages (
          session_id, message_index, role, content_json, text_content
        ) VALUES (?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO session_messages_fts (
          rowid, session_id, message_index, text_content
        ) VALUES (?, ?, ?, ?)
      `);

      nextSnapshot.messages.forEach((message, index) => {
        const textContent = extractMessageText(message);
        const result = insertMessage.run(
          nextSnapshot.sessionId,
          index,
          message.role,
          JSON.stringify(message.content),
          textContent,
        );
        insertFts.run(result.lastInsertRowid, nextSnapshot.sessionId, index, textContent);
      });

      this.db.prepare(`
        INSERT INTO session_meta (key, value)
        VALUES ('last_session', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(nextSnapshot.sessionId);
    });

    saveTransaction(snapshot);
  }

  async loadLast(): Promise<PersistedSessionSnapshot | null> {
    const row = this.db.prepare(`
      SELECT value
      FROM session_meta
      WHERE key = 'last_session'
    `).get() as { value?: string } | undefined;
    const sessionId = row?.value?.trim();
    if (!sessionId) {
      return null;
    }
    return this.load(sessionId);
  }

  async load(sessionId: string): Promise<PersistedSessionSnapshot | null> {
    const row = this.db.prepare(`
      SELECT *
      FROM sessions
      WHERE session_id = ?
    `).get(sessionId) as SessionRow | undefined;
    if (!row) {
      return null;
    }

    const messages = this.db.prepare(`
      SELECT *
      FROM session_messages
      WHERE session_id = ?
      ORDER BY message_index ASC
    `).all(sessionId) as SessionMessageRow[];

    return {
      sessionId: row.session_id,
      cwd: row.cwd,
      model: row.model ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      forkedFromSessionId: row.forked_from_session_id ?? undefined,
      lineage: JSON.parse(row.lineage_json) as string[],
      messages: messages.map((message) => ({
        role: message.role,
        content: JSON.parse(message.content_json),
      })),
      usage: JSON.parse(row.usage_json),
      compactions: JSON.parse(row.compactions_json),
      promptSnapshotId: row.prompt_snapshot_id ?? undefined,
      memoryRefs: JSON.parse(row.memory_refs_json) as string[],
      approvalRefs: JSON.parse(row.approval_refs_json) as string[],
      backgroundJobRefs: JSON.parse(row.background_job_refs_json) as string[],
      intentDelegation: row.intent_delegation_json ? (JSON.parse(row.intent_delegation_json) ?? undefined) : undefined,
      skillEval: row.skill_eval_json ? (JSON.parse(row.skill_eval_json) ?? undefined) : undefined,
    };
  }

  async list(): Promise<SessionListEntry[]> {
    const rows = this.db.prepare(`
      SELECT
        s.session_id,
        s.cwd,
        s.updated_at,
        COALESCE((
          SELECT sm.text_content
          FROM session_messages sm
          WHERE sm.session_id = s.session_id
            AND sm.text_content != ''
          ORDER BY sm.message_index DESC
          LIMIT 1
        ), '') AS preview
      FROM sessions s
      ORDER BY s.updated_at DESC
    `).all() as Array<{
      session_id: string;
      cwd: string;
      updated_at: number;
      preview: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      cwd: row.cwd,
      updatedAt: row.updated_at,
      preview: row.preview,
    }));
  }

  async fork(sessionId: string): Promise<PersistedSessionSnapshot> {
    const source = await this.load(sessionId);
    if (!source) {
      throw new Error(`session not found: ${sessionId}`);
    }

    const now = Date.now();
    const sourceLineage = source.lineage ?? [source.sessionId];
    const lineage = sourceLineage.at(-1) === source.sessionId
      ? [...sourceLineage]
      : [...sourceLineage, source.sessionId];
    const forked: PersistedSessionSnapshot = {
      ...source,
      sessionId: this.createSessionId(),
      createdAt: now,
      updatedAt: now,
      forkedFromSessionId: source.sessionId,
      lineage,
      messages: cloneMessages(source.messages),
      usage: { ...source.usage },
      compactions: (source.compactions ?? []).map((compaction) => ({ ...compaction })),
      memoryRefs: [...(source.memoryRefs ?? [])],
      approvalRefs: [...(source.approvalRefs ?? [])],
      backgroundJobRefs: [...(source.backgroundJobRefs ?? [])],
    };
    await this.save(forked);
    return forked;
  }

  searchMessages(query: string, limit = 10): SessionMessageSearchHit[] {
    const rows = this.db.prepare(`
      SELECT
        sm.session_id,
        sm.message_index,
        sm.role,
        sm.text_content
      FROM session_messages_fts fts
      JOIN session_messages sm ON sm.message_id = fts.rowid
      WHERE session_messages_fts MATCH ?
      ORDER BY bm25(session_messages_fts), sm.message_index ASC
      LIMIT ?
    `).all(query, limit) as Array<{
      session_id: string;
      message_index: number;
      role: Message['role'];
      text_content: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      messageIndex: row.message_index,
      role: row.role,
      textContent: row.text_content,
    }));
  }

  dispose(): void {
    this.db.close();
  }
}

function extractMessageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<Message['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((block) => ({ ...block })),
  }));
}
