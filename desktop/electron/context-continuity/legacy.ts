import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TaskSnapshot } from '../../shared/task-types.js';
import type { ContinuityConversation, LegacyContextPreview, LegacyContextMetadataPage } from '../../shared/context-continuity-types.js';
import { ContinuityService, type ContinuityActor } from './service.js';
import { TaskContinuitySource } from './task-source.js';
import { digest } from './store.js';
import { projectPublicTaskMessages } from '../../shared/context-continuity-projection.js';
import type { ContinuityMessage } from '../../shared/context-continuity-types.js';
const id = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const timestamp=z.number().int().min(0).max(8640000000000000);
export const legacyDisplayMetadata=z.object({createdAt:timestamp.optional(),updatedAt:timestamp.optional(),mode:z.enum(['chat','work']).optional(),starred:z.boolean().optional(),pinnedAt:timestamp.nullable().optional(),gtdBucket:z.enum(['inbox','todo','waiting','someday','archived']).nullable().optional(),sidebar_work_folder:z.string().max(4096).nullable().optional()}).strict();
export const legacyPreviewInput = z.object({ operationId: id, legacyThreadId: id, title: z.string().max(1024).optional(), metadata:legacyDisplayMetadata.optional(), taskIds: z.array(z.string().max(256).regex(/^task_[A-Za-z0-9_-]+$/)).min(1).max(100) }).strict();
export const legacyClaimInput = z.object({ previewId: id, expectedManifestHash: z.string().regex(/^[a-f0-9]{64}$/), operationId: id }).strict();
export interface LegacyTaskSource { snapshot: TaskSnapshot; publicPrompt: string; includeUser: boolean; sourceKind: 'desktop_task' | 'native_codex' }
export type LegacySourceInspector = (taskId: string, legacyThreadId: string) => Promise<LegacyTaskSource>;
/** Inspection is supplied by main's source owner; E3 IDs never become ownership evidence. */
export class LegacyContinuityImporter {
  constructor(private readonly service: ContinuityService, private readonly actor: ContinuityActor, private readonly inspect: LegacySourceInspector) {}
  importMetadata(raw: unknown): void {
    this.service.assertActor(this.actor, true);
    const parsed = legacyPreviewInput.extend({ taskIds: legacyPreviewInput.shape.taskIds.min(0) }).safeParse(raw);
    if (!parsed.success) throw new Error('invalid_argument');
    const input = parsed.data, state = this.service.inspectConversations(this.actor, [input.legacyThreadId])[0].state;
    if (state === 'deleted' || state === 'blocked') throw new Error('not_readable');
    const db = this.service.store.db;
    if (state === 'active' && !db.prepare('SELECT preview_id FROM legacy_claims WHERE conversation_id=? LIMIT 1').get(input.legacyThreadId)) throw new Error('source_binding_conflict');
    this.service.store.operation('importLegacyMetadata', input.operationId, input, () => {
      db.prepare('INSERT OR IGNORE INTO legacy_metadata VALUES (?,?)').run(input.legacyThreadId, input.title ?? null);
      if(input.metadata)db.prepare('INSERT OR IGNORE INTO legacy_display_metadata VALUES (?,?)').run(input.legacyThreadId,JSON.stringify(input.metadata));
      for (const taskId of input.taskIds) db.prepare('INSERT OR IGNORE INTO legacy_candidates VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM legacy_candidates WHERE thread_id=?))').run(input.legacyThreadId, taskId, input.legacyThreadId);
      return null;
    });
  }
  metadata(input: { legacyThreadId: string; offset?: number; limit?: number }): LegacyContextMetadataPage | null {
    this.service.assertActor(this.actor, true);
    const parsed = z.object({ legacyThreadId: id, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().safeParse(input);
    if (!parsed.success) throw new Error('invalid_argument');
    const state = this.service.inspectConversations(this.actor, [input.legacyThreadId])[0].state;
    if (state === 'deleted' || state === 'blocked') throw new Error('not_readable');
    const db = this.service.store.db, row = db.prepare('SELECT title FROM legacy_metadata WHERE id=?').get(input.legacyThreadId); if (!row) return null;
    const offset = input.offset ?? 0, limit = input.limit ?? 100;
    const taskIds = db.prepare('SELECT task_id FROM legacy_candidates WHERE thread_id=? AND position>=? ORDER BY position LIMIT ?').all(input.legacyThreadId, offset, limit).map(row => String(row.task_id));
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM legacy_candidates WHERE thread_id=?').get(input.legacyThreadId)!.count);
    const display=db.prepare('SELECT record FROM legacy_display_metadata WHERE thread_id=?').get(input.legacyThreadId);
    return { id: input.legacyThreadId, title: row.title === null ? null : String(row.title), ...(display?{metadata:legacyDisplayMetadata.parse(JSON.parse(String(display.record)))}:{}),taskIds, total, ...(offset + taskIds.length < total ? { nextOffset: offset + taskIds.length } : {}) };
  }
  private async read(input: z.infer<typeof legacyPreviewInput>): Promise<LegacyTaskSource[]> {
    const rows = await Promise.all([...new Set(input.taskIds)].map(async taskId => {
      const row = await this.inspect(taskId, input.legacyThreadId);
      if (row.snapshot.taskId !== taskId || row.snapshot.context?.threadId !== input.legacyThreadId || !row.snapshot.sessionId) throw new Error('not_readable');
      if (!['completed','failed','cancelled'].includes(row.snapshot.status)) throw new Error('blocked_unsettled');
      return row;
    }));
    return rows.sort((a, b) => a.snapshot.createdAt - b.snapshot.createdAt || a.snapshot.taskId.localeCompare(b.snapshot.taskId));
  }
  async preview(raw: unknown): Promise<LegacyContextPreview> {
    this.service.assertActor(this.actor, true);
    if (typeof raw === 'object' && raw && 'taskIds' in raw && Array.isArray(raw.taskIds) && raw.taskIds.length === 0) throw new Error('unverified_source');
    const parsed = legacyPreviewInput.safeParse(raw); if (!parsed.success) throw new Error('invalid_argument');
    const input = parsed.data;
    const assertVisible = () => { const state = this.service.inspectConversations(this.actor, [input.legacyThreadId])[0].state; if (state === 'deleted' || state === 'blocked') throw new Error('not_readable'); };
    assertVisible(); const rows = await this.read(input), manifestHash = digest(rows); assertVisible();
    return this.service.store.operation('previewLegacy', input.operationId, input, () => {
      const previewId = randomUUID(); const record = { previewId, legacyThreadId: input.legacyThreadId, title: input.title ?? null, manifestHash,
        sources: rows.map(row => ({ taskId: row.snapshot.taskId, messageCount: row.snapshot.events.filter(event => ['result','task_cancelled','error'].includes(event.type)).length,
          preview: row.includeUser ? row.publicPrompt.slice(0, 240) : '', status: row.snapshot.status })), coverage: 'partial' as const };
      this.service.store.db.prepare('INSERT INTO legacy_previews VALUES (?,?,?)').run(previewId, JSON.stringify(input), JSON.stringify(record)); return record;
    });
  }
  async claim(raw: unknown) {
    this.service.assertActor(this.actor, true);
    const parsed = legacyClaimInput.safeParse(raw); if (!parsed.success) throw new Error('invalid_argument');
    const input = parsed.data, db = this.service.store.db;
    const committed = this.service.store.existingOperation<ContinuityConversation>('claimLegacy', input.operationId, input);
    if (committed) { this.service.requireConversation(this.actor, committed.result.id); return committed.result; }
    const stored = db.prepare('SELECT input,record FROM legacy_previews WHERE id=?').get(input.previewId); if (!stored) throw new Error('not_readable');
    const preview = JSON.parse(String(stored.record)) as LegacyContextPreview, candidate = legacyPreviewInput.parse(JSON.parse(String(stored.input)));
    if (preview.manifestHash !== input.expectedManifestHash) throw new Error('stale_manifest');
    const rows = await this.read(candidate); if (digest(rows) !== preview.manifestHash) throw new Error('stale_manifest');
    return this.service.store.operation('claimLegacy', input.operationId, input, () => {
      const priorConversation=this.service.getConversation(this.actor,candidate.legacyThreadId),metadata=this.metadata({legacyThreadId:candidate.legacyThreadId});
      const display=metadata?.metadata??candidate.metadata;
      const conversation = this.service.adoptLegacyConversation(this.actor, { id: candidate.legacyThreadId, title: metadata?.title??candidate.title,metadata:display });
      db.prepare('INSERT OR IGNORE INTO legacy_claims VALUES (?,?,?,?)').run(input.previewId, this.actor.profileId, preview.manifestHash, conversation.id);
      const source = new TaskContinuitySource(this.service, this.actor);
      for (const row of rows) {
        try{this.service.assertHistorySourceClosed(row.snapshot.taskId,row.snapshot);}
        catch(error){
          if(!(error instanceof Error)||error.message!=='blocked_unsettled')throw error;
          // An archive claim can introduce a source after the startup inventory.
          // User confirmation never proves its former execution owner exited.
          this.service.recordUnprovenEffect(this.actor,row.snapshot.taskId,'legacy-claim','legacy_unqualified_source');
        }
        this.service.bindTask(this.actor, { conversationId: conversation.id, taskId: row.snapshot.taskId });
        const prior = db.prepare('SELECT prompt,source_kind,include_user FROM task_public_inputs WHERE task_id=?').get(row.snapshot.taskId);
        if (prior && (prior.prompt !== row.publicPrompt || prior.source_kind !== row.sourceKind || Number(prior.include_user) !== (row.includeUser ? 1 : 0))) throw new Error('source_binding_conflict');
        db.prepare('INSERT OR IGNORE INTO task_public_inputs VALUES (?,?,?,?)').run(row.snapshot.taskId, row.publicPrompt, row.sourceKind, row.includeUser ? 1 : 0);
        source.capture(row.snapshot); // Legacy terminal strings cannot manufacture physical receipts.
        // Only main's verified manifest projection can authorize exact archival versions.
        // A later anchor revision, equal text in another message, or appended event inherits nothing.
        for (const message of projectPublicTaskMessages({ ...row.snapshot, prompt: row.publicPrompt })) {
          if (message.role === 'user' && !row.includeUser) continue;
          const selected = db.prepare('SELECT a.id,a.source_epoch,v.revision,v.record FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.source_revision=1 WHERE a.conversation_id=? AND a.source_kind=? AND a.source_id=? AND a.source_epoch=? AND a.source_message_id=? AND a.deleted=0')
            .get(conversation.id, row.sourceKind, row.snapshot.taskId, row.snapshot.sessionId, message.sourceMessageId);
          if (!selected) throw new Error('stale_manifest');
          const record = JSON.parse(String(selected.record)) as ContinuityMessage;
          if (record.role !== message.role || record.text !== message.text || record.contentHash !== digest(message.text)) throw new Error('stale_manifest');
          db.prepare('INSERT OR IGNORE INTO archive_visibilities VALUES (?,?,?,?,?)').run(String(selected.id), Number(selected.revision), String(selected.source_epoch), record.contentHash, input.previewId);
        }
      }
      return this.service.finishLegacyDisplayImport(this.actor,conversation.id,priorConversation?.updatedAt??display?.updatedAt);
    });
  }
}
