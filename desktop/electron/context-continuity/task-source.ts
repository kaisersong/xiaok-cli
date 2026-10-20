import type { TaskSnapshot } from '../../shared/task-types.js';
import { projectPublicTaskMessages } from '../../shared/context-continuity-projection.js';
import { ContinuityService, type ContinuityActor } from './service.js';
import { digest, key } from './store.js';

export interface SourceSettlementReceipt {
  physicallySettled: boolean;
  sourceEpoch?: string;
  eventCount?: number;
  prefixHash?: string;
}

/** A task's context echo never establishes a binding. Only a prepared/claimed main task does. */
export class TaskContinuitySource {
  constructor(private readonly service: ContinuityService, private readonly actor: ContinuityActor) {}
  async bindPrepared(input: { conversationId: string; taskId: string; publicPrompt: string; includeUser?: boolean; sourceKind?: 'desktop_task' | 'native_codex' },
    inspect: (taskId: string) => Promise<TaskSnapshot | null>): Promise<void> {
    key(input.taskId);
    if (!/^task_[A-Za-z0-9_-]+$/.test(input.taskId) || typeof input.publicPrompt !== 'string') throw new Error('invalid_argument');
    const snapshot = await inspect(input.taskId);
    if (!snapshot || snapshot.taskId !== input.taskId || snapshot.context?.threadId !== input.conversationId) throw new Error('not_readable');
    this.service.store.transaction(() => {
      if((input.sourceKind??'desktop_task')==='desktop_task')this.service.registerGuardedRun(this.actor,input.taskId,snapshot.sessionId);
      this.service.bindTask(this.actor, input);
      const db = this.service.store.db, kind = input.sourceKind ?? 'desktop_task', includeUser = input.includeUser === false ? 0 : 1;
      const prior = db.prepare('SELECT prompt,source_kind,include_user FROM task_public_inputs WHERE task_id=?').get(input.taskId);
      if (prior && (prior.prompt !== input.publicPrompt || prior.source_kind !== kind || prior.include_user !== includeUser)) throw new Error('source_binding_conflict');
      db.prepare('INSERT OR IGNORE INTO task_public_inputs VALUES (?,?,?,?)').run(input.taskId, input.publicPrompt, kind, includeUser);
      const origin = [1, snapshot.sessionId, digest(snapshot.prompt), digest(snapshot.executionScope ?? null), digest([input.publicPrompt, kind, includeUser])] as const;
      const previousOrigin = db.prepare('SELECT version,source_epoch,raw_prompt_hash,scope_hash,input_hash FROM task_presentation_sources WHERE task_id=?').get(input.taskId);
      if (prior && !previousOrigin) throw new Error('source_binding_conflict');
      if (previousOrigin && digest(Object.values(previousOrigin)) !== digest(origin)) throw new Error('source_binding_conflict');
      // Only this actual preparation transaction can establish adapter semantics.
      // capture/reconcile and migrations never mint a missing historical origin.
      db.prepare('INSERT OR IGNORE INTO task_presentation_sources VALUES (?,?,?,?,?,?)').run(input.taskId, ...origin);
      this.capture(snapshot);
    });
  }
  capture(snapshot: TaskSnapshot, receipt?: SourceSettlementReceipt): boolean {
    if (receipt?.physicallySettled && !['completed','failed','cancelled'].includes(snapshot.status)) throw new Error('settlement_receipt_missing');
    const bounded = receipt && (receipt.sourceEpoch !== undefined || receipt.eventCount !== undefined || receipt.prefixHash !== undefined);
    if (receipt?.physicallySettled && bounded && (receipt.sourceEpoch !== snapshot.sessionId || !Number.isSafeInteger(receipt.eventCount)
      || receipt.eventCount! < 0 || receipt.eventCount! > snapshot.events.length
      || receipt.prefixHash !== digest(snapshot.events.slice(0, receipt.eventCount)))) throw new Error('settlement_receipt_missing');
    const db = this.service.store.db;
    const binding = db.prepare('SELECT t.conversation_id,p.prompt,p.source_kind,p.include_user FROM task_bindings t JOIN task_public_inputs p ON p.task_id=t.task_id WHERE t.task_id=? AND t.revoked=0').get(snapshot.taskId);
    const qualifiedReceipt=receipt?.physicallySettled&&binding?.source_kind!=='native_codex'&&this.service.recordEffectOwnerReceipt(this.actor,snapshot);
    if (!binding) return false;
    if (snapshot.context?.threadId !== binding.conversation_id || !snapshot.sessionId || !Array.isArray(snapshot.events)) throw new Error('blocked_reconciliation');
    const kind = String(binding.source_kind) as 'desktop_task' | 'native_codex', id = snapshot.taskId, epoch = snapshot.sessionId;
    if(kind==='native_codex'&&receipt?.physicallySettled)throw new Error('native_settlement_unavailable');
    return this.service.store.transaction(() => {
      const previous = db.prepare('SELECT * FROM source_cursors WHERE source_kind=? AND source_id=? AND source_epoch=?').get(kind, id, epoch);
      const otherEpoch = db.prepare('SELECT source_epoch FROM source_cursors WHERE source_kind=? AND source_id=? AND source_epoch<>? LIMIT 1').get(kind, id, epoch);
      if (otherEpoch || previous && previous.prompt_hash !== digest(snapshot.prompt)) throw new Error('blocked_reconciliation');
      const read = db.prepare('SELECT event_hash FROM source_event_digests WHERE source_kind=? AND source_id=? AND source_epoch=? AND sequence=?');
      for (const [index, event] of snapshot.events.entries()) {
        const old = read.get(kind, id, epoch, index);
        if (old && old.event_hash !== digest(event)) throw new Error('blocked_reconciliation');
        if (!old && previous && index < Number(previous.event_count)) throw new Error('blocked_reconciliation');
      }
      if (previous && snapshot.events.length < Number(previous.event_count)) return true; // Verified older prefix; never regress coverage/state.
      const terminal = ['completed','failed','cancelled'].includes(snapshot.status);
      if (previous?.terminal_status && !terminal) return true;
      if (previous?.terminal_status && previous.terminal_status !== snapshot.status) throw new Error('blocked_reconciliation');
      const unproven=db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=? LIMIT 1').get(id);
      if (receipt?.physicallySettled && !unproven && qualifiedReceipt) {
        // Only the owner invokes this after its execution and original IO have physically exited.
        if (!terminal) throw new Error('settlement_receipt_missing');
        db.prepare('INSERT INTO source_settlements VALUES (?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET source_epoch=excluded.source_epoch,event_count=excluded.event_count,prefix_hash=excluded.prefix_hash')
          .run(id, epoch, bounded ? receipt.eventCount! : snapshot.events.length, bounded ? receipt.prefixHash! : digest(snapshot.events));
      }
      const settled = db.prepare('SELECT * FROM source_settlements WHERE task_id=?').get(id);
      const verifiedPrefix = settled && settled.source_epoch === epoch && Number(settled.event_count) <= snapshot.events.length
        && settled.prefix_hash === digest(snapshot.events.slice(0, Number(settled.event_count)));
      const insert = db.prepare('INSERT OR IGNORE INTO source_event_digests VALUES (?,?,?,?,?)');
      snapshot.events.forEach((event, index) => insert.run(kind, id, epoch, index, digest(event)));
      for (const message of projectPublicTaskMessages({ taskId: id, prompt: String(binding.prompt), events: snapshot.events })) {
        if (message.role === 'user' && !binding.include_user) continue;
        // A source replay advances its cursor without re-creating a deleted public message.
        if (db.prepare('SELECT deleted FROM message_anchors WHERE source_kind=? AND source_id=? AND source_epoch=? AND source_message_id=?')
          .get(kind, id, epoch, message.sourceMessageId)?.deleted) continue;
        const eventIndex = message.sourceMessageId === 'user' ? -1 : Number(message.sourceMessageId.split(':').at(-1));
        const physicallySettled = verifiedPrefix && Number.isSafeInteger(eventIndex) && eventIndex < Number(settled!.event_count);
        this.service.recordMessage(this.actor, { conversationId: String(binding.conversation_id), sourceKind: kind, sourceId: id, sourceDataEpoch: epoch,
          sourceMessageId: message.sourceMessageId, sourceRevision: 1, role: message.role, text: message.text, executionState: physicallySettled ? 'settled' : terminal ? 'unknown' : 'pending' });
      }
      db.prepare('INSERT INTO source_cursors VALUES (?,?,?,?,?,?) ON CONFLICT(source_kind,source_id,source_epoch) DO UPDATE SET event_count=excluded.event_count,terminal_status=excluded.terminal_status')
        .run(kind, id, epoch, snapshot.events.length, digest(snapshot.prompt), terminal ? snapshot.status : null);
      db.prepare('DELETE FROM projection_failures WHERE task_id=?').run(id);
      return true;
    });
  }
}
