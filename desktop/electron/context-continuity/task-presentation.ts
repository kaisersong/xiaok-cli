import type { TaskSnapshot } from '../../shared/task-types.js';
import type { TaskHistoryRead, TaskPublicPresentation } from '../../shared/task-history.js';
import type { NativeActor } from '../codex-native-service.js';
import type { ContinuityService } from './service.js';
import { digest, effectSnapshotHash, key } from './store.js';

/** Read original prepare-time semantics. Existing disk history is never backfilled. */
export function readPreparedTaskPresentation(service: ContinuityService, snapshot: TaskSnapshot): {
  presentation: TaskPublicPresentation | null; fingerprint: string;
} {return readPreparedPresentation(service,snapshot,false);}
export function readPreparedTaskPresentationForCanonicalExport(service:ContinuityService,snapshot:TaskSnapshot):{presentation:TaskPublicPresentation|null;fingerprint:string}{return readPreparedPresentation(service,snapshot,true);}
function readPreparedPresentation(service:ContinuityService,snapshot:TaskSnapshot,readOnly:boolean):{presentation:TaskPublicPresentation|null;fingerprint:string}{
  const db = service.store.db, id = snapshot.taskId;
  const binding = db.prepare('SELECT conversation_id,revoked FROM task_bindings WHERE task_id=?').get(id);
  const input = db.prepare('SELECT prompt,source_kind,include_user FROM task_public_inputs WHERE task_id=?').get(id);
  const source = db.prepare('SELECT * FROM task_presentation_sources WHERE task_id=?').get(id);
  const fingerprint = digest([binding ?? null, input ?? null, source ?? null]);
  const guard = db.prepare('SELECT source_epoch,policy FROM guarded_effect_runs WHERE task_id=?').get(id);
  const cursors = db.prepare('SELECT source_epoch,prompt_hash FROM source_cursors WHERE source_id=? AND source_kind=?').all(id, 'desktop_task');
  if (!source) {
    // Positive old-owner/claim proof, never classification from a missing Goal binding.
    if (!binding || binding.revoked || binding.conversation_id !== snapshot.context?.threadId || snapshot.executionScope
      || !input || input.source_kind !== 'desktop_task' || input.include_user !== 1 || input.prompt !== snapshot.prompt
      || cursors.length !== 1 || cursors[0].source_epoch !== snapshot.sessionId || cursors[0].prompt_hash !== digest(snapshot.prompt)) {
      return { presentation: null, fingerprint };
    }
    const receipt = db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(id);
    if (guard?.policy === 2 && guard.source_epoch === snapshot.sessionId && receipt?.source_epoch === snapshot.sessionId
      && receipt.snapshot_hash === effectSnapshotHash(snapshot)) {
      let closed = true;
      try { readOnly?service.assertHistorySourceClosedForCanonicalExport(id,snapshot):service.assertHistorySourceClosed(id, snapshot); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'blocked_unsettled') throw error; closed = false; }
      if (closed) return { presentation: { version: 1, basis: 'qualified_legacy_owner', taskId: id,
        sourceEpoch: snapshot.sessionId, prompt: String(input.prompt), includeUser: true }, fingerprint: digest([fingerprint, guard, cursors, receipt]) };
    }
    const archived = db.prepare(`SELECT a.id,a.latest_revision,a.source_kind,a.source_epoch,a.conversation_id,
      v.revision,v.record,x.content_hash,x.claim_id,c.profile_id,c.conversation_id AS claimed_conversation,c.manifest_hash,p.record AS preview
      FROM message_anchors a JOIN message_versions v ON v.message_id=a.id AND v.revision=a.latest_revision
      JOIN archive_visibilities x ON x.message_id=a.id AND x.revision=v.revision AND x.source_epoch=a.source_epoch
      JOIN legacy_claims c ON c.preview_id=x.claim_id JOIN legacy_previews p ON p.id=c.preview_id
      WHERE a.source_id=? AND a.source_kind='desktop_task' AND a.source_epoch=? AND a.source_message_id='user' AND a.deleted=0`).all(id, snapshot.sessionId);
    if (archived.length === 1) {
      const row = archived[0], message = JSON.parse(String(row.record)), preview = JSON.parse(String(row.preview));
      if (row.profile_id === service.store.profileId && row.conversation_id === binding.conversation_id
        && row.claimed_conversation === binding.conversation_id && preview.manifestHash === row.manifest_hash
        && message.messageId === row.id && message.revision === row.revision && message.sourceKind === 'desktop_task'
        && message.sourceId === id && message.role === 'user' && message.text === input.prompt
        && message.contentHash === row.content_hash && row.content_hash === digest(message.text)) {
        return { presentation: { version: 1, basis: 'claimed_archive', taskId: id, sourceEpoch: snapshot.sessionId,
          prompt: message.text, includeUser: true }, fingerprint: digest([fingerprint, cursors, row]) };
      }
    }
    return { presentation: null, fingerprint };
  }
  if (!binding || binding.revoked || binding.conversation_id !== snapshot.context?.threadId || !input
    || source.version !== 1 || source.source_epoch !== snapshot.sessionId || input.source_kind !== 'desktop_task'
    || ![0, 1].includes(Number(input.include_user)) || typeof input.prompt !== 'string'
    || source.raw_prompt_hash !== digest(snapshot.prompt) || source.scope_hash !== digest(snapshot.executionScope ?? null)
    || source.input_hash !== digest([input.prompt, input.source_kind, input.include_user])
    || guard?.policy !== 2 || guard.source_epoch !== snapshot.sessionId || cursors.length !== 1
    || cursors[0].source_epoch !== snapshot.sessionId || cursors[0].prompt_hash !== digest(snapshot.prompt)) {
    throw new Error('task_history_unavailable');
  }
  return { presentation: { version: 1, taskId: id, sourceEpoch: snapshot.sessionId,
    prompt: input.prompt, includeUser: input.include_user === 1 }, fingerprint: digest([fingerprint, guard, cursors]) };
}

interface PresentationOwner {
  ready(): Promise<void>;
  assertOwnerCurrent(): void;
  authorize(taskId: string, actor: NativeActor): Promise<void>;
  assertSnapshotCurrent(snapshot: TaskSnapshot, actor: NativeActor): void;
  readCurrent(taskId: string): TaskSnapshot | null;
  readPresentation(snapshot: TaskSnapshot): ReturnType<typeof readPreparedTaskPresentation>;
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

/** Main issues a read proof only for its own raw snapshot and prepare-time record. */
export function createTaskPresentationReader(owner: PresentationOwner) {
  const proofs = new WeakMap<object, { actor: NativeActor; taskId: string; epoch: string; hash: string; input: string; output: string }>();
  function assertTaskCurrent(value: TaskHistoryRead, actor: NativeActor): void {
    try {
      owner.assertOwnerCurrent();
      const proof = proofs.get(value);
      if (!proof || proof.actor !== actor || proof.output !== digest(value)) throw new Error('task_history_unavailable');
      const actual = owner.readCurrent(proof.taskId);
      if (!actual || actual.taskId !== proof.taskId || actual.sessionId !== proof.epoch
        || effectSnapshotHash(actual) !== proof.hash) throw new Error('task_history_unavailable');
      owner.assertSnapshotCurrent(actual, actor);
      const origin = owner.readPresentation(actual);
      if (origin.fingerprint !== proof.input || digest(origin.presentation) !== digest(value.presentation)) throw new Error('task_history_unavailable');
      owner.assertOwnerCurrent();
    } catch { throw new Error('task_history_unavailable'); }
  }
  return Object.freeze({
    assertTaskCurrent,
    async readTask(taskId: string, actor: NativeActor): Promise<TaskHistoryRead> {
      try {
        key(taskId);
        await owner.ready(); owner.assertOwnerCurrent();
        await owner.authorize(taskId, actor);
        const actual = owner.readCurrent(taskId);
        if (!actual || actual.taskId !== taskId) throw new Error('task_history_unavailable');
        owner.assertSnapshotCurrent(actual, actor);
        const origin = owner.readPresentation(actual);
        const value = freezeJson(JSON.parse(JSON.stringify({ snapshot: actual, presentation: origin.presentation })) as TaskHistoryRead);
        proofs.set(value, { actor, taskId, epoch: actual.sessionId, hash: effectSnapshotHash(actual),
          input: origin.fingerprint, output: digest(value) });
        assertTaskCurrent(value, actor);
        return value;
      } catch { throw new Error('task_history_unavailable'); }
    },
  });
}
