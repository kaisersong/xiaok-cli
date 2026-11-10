import { DatabaseSync } from 'node:sqlite';
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContinuityService } from '../../electron/context-continuity/service.js';
import { parseContextLink } from '../../shared/context-continuity-types.js';

const user = { requestSource: 'user' as const, profileId: 'profile-a', actorId: 'desktop-user:profile-a' };
const alien = { ...user, profileId: 'profile-b', actorId: 'desktop-user:profile-b' };
const agent = { ...user, requestSource: 'agent' as const, taskId: 'consumer' };
let dir: string;
let service: ContinuityService;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'continuity-'));
  service = new ContinuityService({ dbPath: join(dir, 'continuity.sqlite'), profileId: user.profileId });
});
afterEach(() => { service.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });
function conversation() { return service.createConversation(user, { operationId: crypto.randomUUID(), title: 'Context' }); }
function append(id: string, sourceMessageId: string, text: string, revision = 1) {
  return service.recordMessage(user, { conversationId: id, sourceKind: 'desktop_task', sourceId: 'task-one', sourceDataEpoch: 'epoch-one',
    sourceMessageId, sourceRevision: revision, role: 'user', text, executionState: 'settled' });
}
function reference(id: string, operationId = crypto.randomUUID()) {
  return service.createReference(user, { conversationId: id, expectedRevision: service.getConversation(user, id)!.revision, operationId });
}

it('refuses ambiguous source cursor epochs instead of pairing one binding with another cursor count',()=>{
  const c=conversation();for(const taskId of ['task_source','task_target'])service.bindTask(user,{conversationId:c.id,taskId});
  service.recordMessage(user,{conversationId:c.id,sourceKind:'desktop_task',sourceId:'task_source',sourceDataEpoch:'epoch-bound',sourceMessageId:'m',sourceRevision:1,role:'assistant',text:'body',executionState:'settled'});
  const write=service.store.db.prepare('INSERT INTO source_cursors VALUES (?,?,?,?,?,?)');
  write.run('desktop_task','task_source','epoch-other',3,'hash','completed');write.run('desktop_task','task_source','epoch-bound',9,'hash','completed');
  expect(()=>service.recordSourceTasks(user,'task_target',['task_source'])).toThrow('not_readable');
  expect(service.store.db.prepare('SELECT * FROM task_history_dependencies').all()).toEqual([]);
});

describe('continuity identity and immutable authorized references (A01–A07/A11)', () => {
  it('fences only the original resolver-produced page, actor and exact request while preserving frozen old versions',()=>{
    const c=conversation();append(c.id,'one','frozen v1');const ref=reference(c.id),input={refId:ref.refId,limit:1};
    const page=service.resolveReference(user,input);service.assertReferenceCurrent(page,user,input);
    expect(()=>service.assertReferenceCurrent(structuredClone(page),user,input)).toThrow('not_readable');
    expect(()=>service.assertReferenceCurrent(page,{...user},input)).toThrow('not_readable');
    expect(()=>service.assertReferenceCurrent(page,user,{...input,limit:2})).toThrow('not_readable');
    append(c.id,'one','new v2',2);append(c.id,'two','future');service.assertReferenceCurrent(page,user,input);
    page.messages[0].text='edited DTO';expect(()=>service.assertReferenceCurrent(page,user,input)).toThrow('not_readable');
  });
  it('owns durable conversation identity and preserves it after restart', () => {
    const c = conversation(); append(c.id, 'one', 'original');
    service.close(); service = new ContinuityService({ dbPath: join(dir, 'continuity.sqlite'), profileId: user.profileId });
    expect(service.getConversation(user, c.id)?.id).toBe(c.id);
    expect(service.listMessages(user, c.id).map(x => x.text)).toEqual(['original']);
  });
  it('rejects user mutation from agent/scheduler/forged profile and does not leak another profile', () => {
    const c = conversation();
    for (const actor of [agent, { ...user, requestSource: 'scheduler' as const }, alien, { ...user, actorId: 'invented' }]) {
      expect(() => service.createConversation(actor, { operationId: 'create', title: 'bad' })).toThrow();
      expect(() => service.createReference(actor, { conversationId: c.id, expectedRevision: c.revision, operationId: 'ref' })).toThrow();
    }
    expect(() => service.getConversation(alien, c.id)).toThrow('not_readable');
  });
  it('uses independent operationId uniqueness, not operationId+hash uniqueness', () => {
    const c = service.createConversation(user, { operationId: 'same', title: 'first' });
    expect(service.createConversation(user, { operationId: 'same', title: 'first' }).id).toBe(c.id);
    expect(() => service.createConversation(user, { operationId: 'same', title: 'different' })).toThrow('operation_conflict');
  });
  it('keeps a content-free deletion audit and refuses a cached create result after deletion', () => {
    const input = { operationId: 'deleted-create', title: 'PRIVATE_TITLE' }, c = service.createConversation(user, input);
    service.tombstoneConversation(user, c.id);
    expect(() => service.createConversation(user, input)).toThrow('not_readable');
    expect(JSON.stringify(service.store.db.prepare('SELECT record FROM conversations').all())).not.toContain('PRIVATE_TITLE');
    service.tombstoneConversation(user, 'legacy-not-yet-adopted');
    expect(service.inspectConversations(user, ['legacy-not-yet-adopted'])).toEqual([{ id: 'legacy-not-yet-adopted', state: 'deleted' }]);
  });
  it('keeps fixed message versions when source is edited and new messages arrive', () => {
    const c = conversation(), original = append(c.id, 'one', 'v1'); const ref = reference(c.id);
    const edited = append(c.id, 'one', 'v2', 2); append(c.id, 'two', 'future');
    expect(edited.messageId).toBe(original.messageId);
    expect(service.resolveReference(user, { refId: ref.refId }).messages.map(x => x.text)).toEqual(['v1']);
    expect(service.listMessages(user, c.id).map(x => x.text)).toEqual(['v2', 'future']);
  });
  it('deduplicates the same committed source identity and preserves identical text with different source IDs', () => {
    const c = conversation(); const a = append(c.id, 'one', 'same');
    expect(append(c.id, 'one', 'same').messageId).toBe(a.messageId);
    expect(append(c.id, 'two', 'same').messageId).not.toBe(a.messageId);
    expect(service.listMessages(user, c.id)).toHaveLength(2);
    expect(() => append(c.id, 'one', 'conflicting bytes')).toThrow('source_revision_conflict');
  });
  it('does not allow the same source binding to be adopted by another conversation', () => {
    const a = conversation(), b = conversation(); append(a.id, 'one', 'private');
    expect(() => append(b.id, 'one', 'private')).toThrow('source_binding_conflict');
  });
  it('rejects stale createRef, retries the same operation against its original result', () => {
    const c = conversation(); append(c.id, 'one', 'original');
    expect(() => service.createReference(user, { conversationId: c.id, expectedRevision: c.revision, operationId: 'old' })).toThrow('stale_revision');
    const input = { conversationId: c.id, expectedRevision: service.getConversation(user, c.id)!.revision, operationId: 'good' };
    const a = service.createReference(user, input); append(c.id, 'two', 'new');
    expect(service.createReference(user, input).refId).toBe(a.refId);
  });
  it('requires a trusted consumer binding and explicit exact-snapshot grant, then rechecks revocation on each page', () => {
    const source = conversation(), target = conversation();
    append(source.id, 'one', 'secret'); append(source.id, 'two', 'more'); const ref = reference(source.id);
    service.bindTask(user, { conversationId: target.id, taskId: 'consumer' });
    expect(() => service.resolveReference(agent, { refId: ref.refId })).toThrow('not_readable');
    const grant = service.attachReference(user, { refId: ref.refId, targetConversationId: target.id, operationId: 'attach' });
    const page = service.resolveReference(agent, { refId: ref.refId, limit: 1 });
    expect(page.messages[0].text).toBe('secret'); expect(page.nextCursor).toBeTruthy();
    service.revokeGrant(user, { grantId: grant.grantId });
    expect(() => service.resolveReference(agent, { refId: ref.refId, cursor: page.nextCursor, limit: 1 })).toThrow('not_readable');
  });
  it('does not accept a model-supplied conversation/profile as a task binding', () => {
    const c = conversation(); append(c.id, 'one', 'private'); const ref = reference(c.id);
    expect(() => service.resolveReference({ ...agent, conversationId: c.id } as typeof agent, { refId: ref.refId })).toThrow('not_readable');
    expect(() => service.bindTask(agent, { conversationId: c.id, taskId: 'consumer' })).toThrow();
  });
  it('binds cursors to the ref and consumer and refuses forged or oversized pagination', () => {
    const c = conversation(); append(c.id, 'one', 'one'); append(c.id, 'two', 'two'); const a = reference(c.id), b = reference(c.id);
    const page = service.resolveReference(user, { refId: a.refId, limit: 1 });
    expect(() => service.resolveReference(user, { refId: b.refId, limit: 1, cursor: page.nextCursor })).toThrow('invalid_cursor');
    expect(() => service.resolveReference(user, { refId: a.refId, cursor: `${page.nextCursor}x` })).toThrow('invalid_cursor');
    for (const limit of [0, -1, 101, 1.5, NaN]) expect(() => service.resolveReference(user, { refId: a.refId, limit })).toThrow('invalid_argument');
  });
  it('pages UTF-8 content within the byte budget without corrupting emoji or losing text', () => {
    const c = conversation(), text = '上下文😀'.repeat(12000); append(c.id, 'one', text); const ref = reference(c.id);
    let cursor: string | undefined; let combined = ''; let pages = 0;
    do {
      const page = service.resolveReference(user, { refId: ref.refId, cursor });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(65536);
      expect(page.messages[0].text).not.toContain('\uFFFD');
      combined += page.messages.map(x => x.text).join(''); cursor = page.nextCursor; pages++;
    } while (cursor && pages < 20);
    expect(combined).toBe(text); expect(pages).toBeGreaterThan(1);
  });
  it('deletion wins over references, retries, backfill and restart', () => {
    const c = conversation(), message = append(c.id, 'one', 'canary'), ref = reference(c.id);
    service.deleteMessage(user, { conversationId: c.id, messageId: message.messageId });
    expect(() => service.resolveReference(user, { refId: ref.refId })).toThrow('not_readable');
    expect(() => append(c.id, 'one', 'canary')).toThrow('not_readable');
    service.close(); service = new ContinuityService({ dbPath: join(dir, 'continuity.sqlite'), profileId: user.profileId });
    expect(service.listMessages(user, c.id)).toEqual([]);
    expect(() => service.resolveReference(user, { refId: ref.refId })).toThrow('not_readable');
  });
  it('tombstones a conversation only from the trusted user completion path and keeps every reference unreadable after restart', () => {
    const c = conversation(); append(c.id, 'one', 'canary'); const ref = reference(c.id);
    expect(() => service.tombstoneConversation(agent, c.id)).toThrow();
    service.tombstoneConversation(user, c.id); service.tombstoneConversation(user, c.id);
    expect(service.getConversation(user, c.id)).toBeNull();
    expect(() => service.resolveReference(user, { refId: ref.refId })).toThrow('not_readable');
    service.close(); service = new ContinuityService({ dbPath: join(dir, 'continuity.sqlite'), profileId: user.profileId });
    expect(() => service.resolveReference(user, { refId: ref.refId })).toThrow('not_readable');
    expect(() => append(c.id, 'one', 'canary')).toThrow('not_readable');
  });
  it('rechecks the independent deletion owner on every read, including its pending and committed states', () => {
    const c = conversation(); append(c.id, 'one', 'canary'); const ref = reference(c.id);
    let state: 'readable' | 'blocked' | 'deleted' = 'readable'; service.setScopePolicy(id => id === c.id ? state : 'readable');
    state = 'blocked'; expect(() => service.resolveReference(user, { refId: ref.refId })).toThrow('not_readable');
    state = 'deleted'; expect(() => service.resolveReference(user, { refId: ref.refId })).toThrow('not_readable');
    expect(service.inspectConversations(user, [c.id, 'missing'])).toEqual([{ id: c.id, state: 'deleted' }, { id: 'missing', state: 'missing' }]);
    expect(service.store.db.prepare('SELECT record FROM message_versions').get()?.record).toBe('{}');
  });
  it('keeps one durable active grant per exact reference and target, across duplicate cards and restart', () => {
    const source = conversation(), target = conversation(); append(source.id, 'one', 'secret'); const ref = reference(source.id);
    const first = service.attachReference(user, { refId: ref.refId, targetConversationId: target.id, operationId: 'first' });
    const second = service.attachReference(user, { refId: ref.refId, targetConversationId: target.id, operationId: 'second' });
    expect(second.grantId).toBe(first.grantId);
    expect(service.getReferenceGrant(user, { refId: ref.refId, targetConversationId: target.id })).toEqual(first);
    service.revokeGrant(user, first); expect(service.getReferenceGrant(user, { refId: ref.refId, targetConversationId: target.id })).toBeNull();
  });
  it('invalidates derived context transitively after its exact source grant is revoked, and never cleans it by regranting', () => {
    const source = conversation(), target = conversation(); append(source.id, 'one', 'secret'); const ref = reference(source.id);
    service.bindTask(user, { conversationId: target.id, taskId: 'consumer' });
    const grant = service.attachReference(user, { refId: ref.refId, targetConversationId: target.id, operationId: 'attach' });
    service.resolveReference(agent, { refId: ref.refId });
    service.recordMessage(user, { conversationId: target.id, sourceKind: 'desktop_task', sourceId: 'consumer', sourceDataEpoch: 'epoch', sourceMessageId: 'answer', sourceRevision: 1, role: 'assistant', text: 'derived secret', executionState: 'settled' });
    const derived = reference(target.id);
    expect(service.resolveReference(agent, { refId: derived.refId }).messages[0].text).toBe('derived secret');
    service.revokeGrant(user, grant);
    expect(() => service.resolveReference(agent, { refId: derived.refId })).toThrow('not_readable');
    expect(service.listMessages(user, target.id)).toEqual([]);
    service.attachReference(user, { refId: ref.refId, targetConversationId: target.id, operationId: 'reattach' });
    expect(() => service.resolveReference(agent, { refId: derived.refId })).toThrow('not_readable');
  });
  it('does not adopt or alter an existing foreign database without continuity ownership metadata', () => {
    const path = join(dir, 'foreign.sqlite'); const foreign = new DatabaseSync(path); foreign.exec("CREATE TABLE foreign_canary(value TEXT); INSERT INTO foreign_canary VALUES ('private')"); foreign.close();
    expect(() => new ContinuityService({ dbPath: path, profileId: user.profileId })).toThrow('profile_mismatch');
    const check = new DatabaseSync(path, { readOnly: true });
    expect(check.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()).toEqual([{ name: 'foreign_canary' }]); check.close();
  });
  it('a different profile cannot open the same database and adopt its contents', () => {
    conversation();
    expect(() => new ContinuityService({ dbPath: join(dir, 'continuity.sqlite'), profileId: 'other' })).toThrow('profile_mismatch');
  });
  it('settles an accepted input without inventing an edit revision or exposing a pending input to an agent', () => {
    const c = conversation(); service.bindTask(user, { conversationId: c.id, taskId: 'consumer' });
    const input = { conversationId: c.id, sourceKind: 'desktop_task' as const, sourceId: 'task-one', sourceDataEpoch: 'epoch-one', sourceMessageId: 'one', sourceRevision: 1, role: 'user' as const, text: 'pending' };
    const a = service.recordMessage(user, { ...input, executionState: 'pending' }); const ref = reference(c.id);
    expect(() => service.resolveReference(agent, { refId: ref.refId })).toThrow('not_readable');
    const b = service.recordMessage(user, { ...input, executionState: 'settled' });
    expect([b.messageId, b.revision]).toEqual([a.messageId, a.revision]);
    expect(service.resolveReference(agent, { refId: ref.refId }).messages[0].executionState).toBe('settled');
  });
});

describe('strict navigation-only context links (A03)', () => {
  it('round-trips a generated random ref and rejects additional actions/encoding/paths', () => {
    const c = conversation(); append(c.id, 'one', 'one'); const ref = reference(c.id);
    expect(parseContextLink(ref.url)).toBe(ref.refId);
    for (const url of ['file:///tmp/secret', 'xiaok://context/v2/abc', `${ref.url}?action=run`, `${ref.url}#grant`, `${ref.url}/x`, 'xiaok://context/v1/%252e%252e']) {
      expect(parseContextLink(url)).toBeNull();
    }
  });
});
