// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { LegacyContinuityImporter } from '../../electron/context-continuity/legacy.js';
import type { TaskSnapshot } from '../../shared/task-types.js';
const roots: string[] = []; const services: ContinuityService[] = [];
afterEach(() => { services.forEach(s => s.close()); roots.forEach(r => rmSync(r, { recursive: true, force: true })); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'continuity-legacy-')); roots.push(root);
  const service = new ContinuityService({ dbPath: join(root, 'state.sqlite'), profileId: 'p' }); services.push(service);
  const actor = { requestSource: 'user' as const, profileId: 'p', actorId: 'desktop-user:p' };
  const snapshot = { taskId: 'task_legacy', sessionId: 'session_legacy', prompt: 'old input', status: 'completed', events: [{ type: 'result', result: { summary: 'old answer', artifacts: [] } }], context: { threadId: 'legacy' }, createdAt: 1, updatedAt: 2 } as TaskSnapshot;
  const inspect = vi.fn(async () => ({ snapshot, publicPrompt: 'old input', includeUser: true, sourceKind: 'desktop_task' as const }));
  return { service, actor, inspect, snapshot, importer: new LegacyContinuityImporter(service, actor, inspect) };
}
it('keeps E3 candidates as previews until an explicit same-manifest user claim commits an audit and source bindings atomically', async () => {
  const f = setup(); const input = { operationId: 'preview', legacyThreadId: 'legacy', title: 'old', taskIds: ['task_legacy'] };
  const preview = await f.importer.preview(input);
  expect(f.service.getConversation(f.actor, 'legacy')).toBeNull();
  const c = await f.importer.claim({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: 'claim' });
  expect(c.id).toBe('legacy'); expect(c.coverage).toBe('partial');
  expect(f.service.listMessages(f.actor, c.id).map(m => m.text)).toEqual(['old input', 'old answer']);
  expect(f.service.store.db.prepare('SELECT profile_id,manifest_hash FROM legacy_claims').get()).toEqual({ profile_id: 'p', manifest_hash: preview.manifestHash });
  f.inspect.mockImplementationOnce(async () => { throw new Error('source temporarily offline after committed claim'); });
  expect((await f.importer.claim({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: 'claim' })).id).toBe(c.id);
});
it('rejects changed source manifests, foreign/Room owners and model callers without partial adoption', async () => {
  const f = setup(); const preview = await f.importer.preview({ operationId: 'preview', legacyThreadId: 'legacy', taskIds: ['task_legacy'] });
  f.inspect.mockImplementationOnce(async () => ({ snapshot: { ...f.snapshot, prompt: 'changed' }, publicPrompt: 'changed', includeUser: true, sourceKind: 'desktop_task' }));
  await expect(f.importer.claim({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: 'claim' })).rejects.toThrow('stale_manifest');
  expect(f.service.listConversations(f.actor)).toEqual([]);
  f.inspect.mockRejectedValueOnce(new Error('not_readable'));
  await expect(f.importer.preview({ operationId: 'foreign', legacyThreadId: 'legacy', taskIds: ['task_legacy'] })).rejects.toThrow('not_readable');
  const agent = new LegacyContinuityImporter(f.service, { ...f.actor, requestSource: 'agent' }, f.inspect);
  await expect(agent.preview({ operationId: 'agent', legacyThreadId: 'legacy', taskIds: ['task_legacy'] })).rejects.toThrow();
});
it('refuses IDB-only empty candidates and never follows context.taskIds to adopt additional sources', async () => {
  const f = setup();
  await expect(f.importer.preview({ operationId: 'empty', legacyThreadId: 'legacy', taskIds: [] })).rejects.toThrow('unverified_source');
  await f.importer.preview({ operationId: 'one', legacyThreadId: 'legacy', taskIds: ['task_legacy'] });
  expect(f.inspect).toHaveBeenCalledTimes(1);
});

it('stores paginated E3 metadata without reading sources or granting any task association', () => {
  const f = setup(); const ids = Array.from({ length: 201 }, (_, index) => `task_${index}`);
  for (let start = 0; start < ids.length; start += 100) f.importer.importMetadata({ operationId: `batch-${start}`, legacyThreadId: 'legacy', title: 'old', taskIds: ids.slice(start, start + 100) });
  expect(f.inspect).not.toHaveBeenCalled(); expect(f.service.listConversations(f.actor)).toEqual([]);
  expect(f.service.store.db.prepare('SELECT task_id FROM task_bindings').all()).toEqual([]);
  const page = f.importer.metadata({ legacyThreadId: 'legacy' })!;
  expect(page.taskIds).toEqual(ids.slice(0, 100)); expect(page.total).toBe(201); expect(page.nextOffset).toBe(100);
  expect(f.importer.metadata({ legacyThreadId: 'legacy', offset: 200 })?.taskIds).toEqual(['task_200']);
  f.importer.importMetadata({ operationId: 'batch-0', legacyThreadId: 'legacy', title: 'old', taskIds: ids.slice(0, 100) });
  expect(f.importer.metadata({ legacyThreadId: 'legacy' })?.total).toBe(201);
});
it('claims additional verified batches into the same main conversation without adopting the remaining candidates', async () => {
  const f = setup();
  f.importer.importMetadata({ operationId: 'metadata', legacyThreadId: 'legacy', taskIds: ['task_first', 'task_second'] });
  f.inspect.mockImplementation(async taskId => ({ snapshot: { ...f.snapshot, taskId, sessionId: `session_${taskId}` }, publicPrompt: 'old input', includeUser: true, sourceKind: 'desktop_task' }));
  for (const taskId of ['task_first', 'task_second']) {
    const closed={...f.snapshot,taskId,sessionId:`session_${taskId}`};
    f.service.registerGuardedRun(f.actor,taskId,closed.sessionId);f.service.recordEffectOwnerReceipt(f.actor,closed);
    const preview = await f.importer.preview({ operationId: `preview-${taskId}`, legacyThreadId: 'legacy', taskIds: [taskId] });
    await f.importer.claim({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: `claim-${taskId}` });
    if (taskId === 'task_first') expect(f.service.getConversation(f.actor, 'legacy')?.taskIds).toEqual(['task_first']);
  }
  expect(f.service.getConversation(f.actor, 'legacy')?.taskIds).toEqual(['task_first', 'task_second']);
  f.service.tombstoneConversation(f.actor, 'legacy');
  expect(() => f.importer.importMetadata({ operationId: 'revive', legacyThreadId: 'legacy', taskIds: ['task_third'] })).toThrow('not_readable');
  expect(() => f.importer.metadata({ legacyThreadId: 'legacy' })).toThrow('not_readable');
});

it('allows exact user-claimed archival evidence without asserting physical settlement or authorizing future versions', async () => {
  const f = setup(); const preview = await f.importer.preview({ operationId: 'preview', legacyThreadId: 'legacy', taskIds: ['task_legacy'] });
  await f.importer.claim({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: 'claim' });
  expect(f.service.listMessages(f.actor, 'legacy').every(m => m.executionState === 'unknown')).toBe(true);
  expect(f.service.store.db.prepare('SELECT task_id FROM source_settlements').all()).toEqual([]);
  const source = f.service.getConversation(f.actor, 'legacy')!;
  const ref = f.service.createReference(f.actor, { conversationId: source.id, expectedRevision: source.revision, operationId: 'ref' });
  const target = f.service.createConversation(f.actor, { operationId: 'target' });
  f.service.bindTask(f.actor, { conversationId: target.id, taskId: 'consumer' });
  const agent = { ...f.actor, requestSource: 'agent' as const, taskId: 'consumer' };
  const grant = f.service.attachReference(f.actor, { refId: ref.refId, targetConversationId: target.id, operationId: 'grant' });
  expect(f.service.resolveReference(agent, { refId: ref.refId }).messages.map(m => [m.text, m.executionState, m.visibilityBasis])).toEqual([
    ['old input', 'unknown', 'user_claimed_archive'], ['old answer', 'unknown', 'user_claimed_archive'],
  ]);
  f.service.recordMessage(f.actor, { conversationId: source.id, sourceKind: 'desktop_task', sourceId: 'task_legacy', sourceDataEpoch: 'session_legacy', sourceMessageId: 'user', sourceRevision: 2, role: 'user', text: 'new version', executionState: 'unknown' });
  const future = f.service.createReference(f.actor, { conversationId: source.id, expectedRevision: f.service.getConversation(f.actor, source.id)!.revision, operationId: 'future' });
  f.service.attachReference(f.actor, { refId: future.refId, targetConversationId: target.id, operationId: 'future-grant' });
  expect(() => f.service.resolveReference(agent, { refId: future.refId })).toThrow('not_readable');
  expect(f.service.resolveReference(agent, { refId: ref.refId }).messages[0].text).toBe('old input');
  f.service.revokeGrant(f.actor, grant); expect(() => f.service.resolveReference(agent, { refId: ref.refId })).toThrow('not_readable');
});

it('scrubs preview bodies and cached operation results when the physical deletion owner tombstones legacy history', async () => {
  const f = setup(); const input = { operationId: 'preview', legacyThreadId: 'legacy', title: 'PRIVATE_TITLE', taskIds: ['task_legacy'] };
  // This content-scrubbing case has a qualified owner; an archive claim alone is unknown.
  f.service.registerGuardedRun(f.actor,f.snapshot.taskId,f.snapshot.sessionId);f.service.recordEffectOwnerReceipt(f.actor,f.snapshot);
  const preview = await f.importer.preview(input);
  await f.importer.claim({ previewId: preview.previewId, expectedManifestHash: preview.manifestHash, operationId: 'claim' });
  f.service.tombstoneConversation(f.actor, 'legacy');
  const db = f.service.store.db;
  const retained = JSON.stringify([db.prepare('SELECT input,record FROM legacy_previews').all(), db.prepare('SELECT result FROM operations').all(), db.prepare('SELECT record FROM conversations').all()]);
  expect(retained).not.toMatch(/PRIVATE_TITLE|old input|old answer/);
  await expect(f.importer.preview(input)).rejects.toThrow('not_readable');
});
it('preserves display metadata on first claim without granting folder or task ownership, and never overwrites later main edits',async()=>{
 const f=setup(),metadata={createdAt:1000,updatedAt:2000,mode:'chat' as const,starred:true,pinnedAt:1800,gtdBucket:'waiting' as const,sidebar_work_folder:'/display-only-folder'};
 f.importer.importMetadata({operationId:'metadata',legacyThreadId:'legacy',title:'Old display title',taskIds:['task_legacy'],metadata});
 const preview=await f.importer.preview({operationId:'preview',legacyThreadId:'legacy',taskIds:['task_legacy']});
 const claimed=await f.importer.claim({previewId:preview.previewId,expectedManifestHash:preview.manifestHash,operationId:'claim'});
 expect(claimed).toMatchObject({...metadata,title:'Old display title',taskIds:['task_legacy'],coverage:'partial'});
 f.service.updateConversation(f.actor,'legacy',{title:'Main edited title',starred:false,mode:'work'});
 f.importer.importMetadata({operationId:'later-metadata',legacyThreadId:'legacy',title:'Stale title',taskIds:[],metadata});
 await f.importer.claim({previewId:preview.previewId,expectedManifestHash:preview.manifestHash,operationId:'claim'});
 expect(f.service.getConversation(f.actor,'legacy')).toMatchObject({title:'Main edited title',starred:false,mode:'work',createdAt:1000});
 expect(()=>f.importer.importMetadata({operationId:'forged',legacyThreadId:'unclaimed',taskIds:[],metadata:{...metadata,profileId:'forged'}})).toThrow('invalid_argument');
});
