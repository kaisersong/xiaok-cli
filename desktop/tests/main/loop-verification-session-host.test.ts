// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LoopStore } from '../../electron/loop-store.js';
import { ArtifactEvidenceRegressionScanner } from '../../electron/artifact-evidence-regression-loop.js';
import { CompletionEvidenceStore } from '../../electron/completion-evidence-store.js';
import { FileSessionStore } from '../../../src/ai/runtime/session-store/file-store.js';
import { createLoopVerificationSessionHost } from '../../electron/loop-verification-session-host.js';
const definition = (id: string) => ({ version: 1, obligations: [{ obligationId: id, predicateId: 'content', predicateVersion: '1', semantics: 'current-subject', recipe: { kind: 'artifact-content', checks: [{ id: 'check', path: 'report', sha256: 'a'.repeat(64), structure: 'bytes' }] } }] });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'loop-verification-host-')), file = join(root, 'loop.sqlite'), store = new LoopStore(file), sessionRoot = join(root, 'sessions');
  const loopId = 'artifact-evidence-regression'; store.ensureBuiltInLoops(1);
  store.saveLoopPublicationConfiguration({ loopId, expectedRevision: null, requestSource: 'user', now: 2, configuration: { version: 1, contract: { kind: 'builtin-diagnostic', scanner: loopId, objective: 'Original', completionCriterion: 'Original criterion' }, verificationDefinitions: { run: definition('run-original'), stages: { scan: definition('scan-original') } } } });
  const began = store.beginLoopRun(loopId, { kind: 'manual' }, 3, 1000, { requestSource: 'user' }); if (began.status !== 'started') throw Error('begin');
  const stage = store.startLoopStage(began.run.id, loopId, 'scan', 4), producer = store.openLoopPublicationProducer(began.run), evidencePath = join(root, 'evidence.sqlite'), evidence = new CompletionEvidenceStore(evidencePath), scanner = new ArtifactEvidenceRegressionScanner(evidencePath);
  try { producer.recordScan(stage.id, scanner.scan({ loopRunId: began.run.id, now: 10 }), 10); } finally { scanner.close(); evidence.close(); }
  const candidate = store.recoverLoopPublicationCandidates({ runId: began.run.id, requestSource: 'user' }).find(c => c.stageId === null)!;
  // Local history prerequisite only: this fixture does not grant native approval.
  let native = store.reserveLoopNativeAttempt({ candidateId: candidate.candidateId, expectedLatestAttemptId: null, requestSource: 'user', now: 20 });
  for (const phase of ['enrolling', 'enrolled', 'binding', 'ready'] as const) native = store.advanceLoopNativeAttempt({ attemptId: native.attemptId, expectedRevision: native.revision, phase, requestSource: 'user', now: 21 });
  const options = { store, sessionRoot, workspaceRoot: root, assertAdmission() {}, now: () => 30 };
  const host = createLoopVerificationSessionHost(options), input = { nativeAttemptId: native.attemptId, obligationId: 'run-original', requestSource: 'user' as const };
  return { root, file, store, sessionRoot, native, candidate, host, options, input, async close() { await host.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
it('creates a real canonical session and durable host invocation without inventing provider or tool history', async () => {
  const f = fixture(); try {
    const row = await f.host.prepare(f.input), snapshot = await new FileSessionStore(f.sessionRoot).load(row.sessionId);
    expect(row.phase).toBe('session_ready'); expect(row.sessionId).not.toBe(f.candidate.runId);
    expect(snapshot).toMatchObject({ sessionId: row.sessionId, cwd: realpathSync(f.root), executionProtected: true, storeRevision: 1 });
    expect(snapshot!.messages.map(m => m.role)).toEqual(['user']);
    expect(JSON.stringify(snapshot!.messages)).toContain(row.validationInvocationId);
    expect(JSON.stringify(snapshot!.messages)).not.toContain('tool_use');
    expect(await f.host.prepare(f.input)).toEqual(row);
    expect(f.store.getLoopRunLifecycle(f.candidate.runId)?.businessState).toBe('publication_pending');
  } finally { await f.close(); }
});
it('recovers the same actual session after both host and SQLite reopen', async () => {
  const f = fixture(); let reopened: LoopStore | undefined;
  try {
    const row = await f.host.prepare(f.input); await f.host.close(); f.store.close(); reopened = new LoopStore(f.file);
    const host = createLoopVerificationSessionHost({ ...f.options, store: reopened });
    try { expect(await host.recover({ id: row.id, requestSource: 'scheduler' })).toEqual(row); expect(await new FileSessionStore(f.sessionRoot).load(row.sessionId)).toHaveProperty('storeRevision', 1); }
    finally { await host.close(); }
  } finally { if (reopened) reopened.close(); else f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
it('recovers an actual file commit followed by failed Loop acknowledgement without writing the file twice', async () => {
  const f = fixture(), db = new DatabaseSync(f.file); try {
    db.exec("CREATE TRIGGER reject_session_ack BEFORE UPDATE ON loop_verification_sessions BEGIN SELECT RAISE(ABORT,'ack failure'); END");
    await expect(f.host.prepare(f.input)).rejects.toThrow('ack failure');
    const row = f.store.listLoopVerificationSessions(f.native.attemptId)[0]!; expect(row.phase).toBe('reserved');
    const path = join(f.sessionRoot, row.sessionId + '.json'), before = readFileSync(path), beforeStat = statSync(path);
    db.exec('DROP TRIGGER reject_session_ack'); expect((await f.host.recover({ id: row.id, requestSource: 'scheduler' })).phase).toBe('session_ready');
    expect(readFileSync(path)).toEqual(before); expect(statSync(path).mtimeMs).toBe(beforeStat.mtimeMs);
  } finally { db.close(); await f.close(); }
});
it.each(['missing', 'changed'] as const)('does not recreate or overwrite a %s canonical session after ready', async mode => {
  const f = fixture(); try {
    const row = await f.host.prepare(f.input), path = join(f.sessionRoot, row.sessionId + '.json');
    if (mode === 'missing') unlinkSync(path); else { const value = JSON.parse(readFileSync(path, 'utf8')); value.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'unrelated' }] }); writeFileSync(path, JSON.stringify(value)); }
    await expect(f.host.recover({ id: row.id, requestSource: 'scheduler' })).rejects.toThrow();
    expect(f.store.getLoopVerificationSession(row.id)).toEqual(row);
  } finally { await f.close(); }
});
it('scheduler cannot allocate a fresh session and closed host cannot resume one', async () => {
  const f = fixture(); try {
    await expect(f.host.prepare({ ...f.input, requestSource: 'scheduler' })).rejects.toThrow();
    expect(f.store.listLoopVerificationSessions(f.native.attemptId)).toEqual([]);
    await f.host.close(); await expect(f.host.prepare(f.input)).rejects.toThrow('loop_verification_host_closed');
  } finally { await f.close(); }
});
it('retries only the original reserved session when its first canonical file write failed', async () => {
  const f = fixture(); try {
    const row = f.store.reserveLoopVerificationSession({ ...f.input, sessionId: 'sess_fixed', now: 30 });
    mkdirSync(join(f.sessionRoot, row.sessionId + '.json'), { recursive: true });
    await expect(f.host.recover({ id: row.id, requestSource: 'scheduler' })).rejects.toThrow();
    expect(f.store.getLoopVerificationSession(row.id)?.phase).toBe('reserved');
    rmSync(join(f.sessionRoot, row.sessionId + '.json'), { recursive: true });
    const recovered = await f.host.recover({ id: row.id, requestSource: 'scheduler' });
    expect(recovered).toMatchObject({ id: row.id, sessionId: row.sessionId, phase: 'session_ready' });
  } finally { await f.close(); }
});

it('reads the actual canonical file after a clock callback before acknowledging its existence', async () => {
  const f = fixture(), db = new DatabaseSync(f.file); let host: ReturnType<typeof createLoopVerificationSessionHost> | undefined;
  try {
    db.exec("CREATE TRIGGER reject_session_ack BEFORE UPDATE ON loop_verification_sessions BEGIN SELECT RAISE(ABORT,'ack failure'); END");
    await expect(f.host.prepare(f.input)).rejects.toThrow('ack failure');
    await f.host.close(); db.exec('DROP TRIGGER reject_session_ack');
    const row = f.store.listLoopVerificationSessions(f.native.attemptId)[0]!, path = join(f.sessionRoot, row.sessionId + '.json');
    host = createLoopVerificationSessionHost({ ...f.options, now() { const value = JSON.parse(readFileSync(path, 'utf8')); value.cwd = '/changed'; writeFileSync(path, JSON.stringify(value)); return 31; } });
    await expect(host.recover({ id: row.id, requestSource: 'scheduler' })).rejects.toThrow('loop_verification_session_snapshot_changed');
    expect(f.store.getLoopVerificationSession(row.id)?.phase).toBe('reserved');
  } finally { await host?.close(); db.close(); await f.close(); }
});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
it('rejects asynchronous admission before session reservation',async()=>{const f=fixture(),host=createLoopVerificationSessionHost({...f.options,assertAdmission:async()=>{}});try{await expect(host.prepare(f.input)).rejects.toThrow('loop_verification_host_admission_sync');expect(f.store.listLoopVerificationSessions(f.native.attemptId)).toEqual([]);}finally{await host.close();await f.close();}});
it('pause while canonical read waits prevents fresh file creation but preserves original reservation',async()=>{
 const f=fixture(),entered=gate(),release=gate(),original=FileSessionStore.prototype.load;let once=true;
 const spy=vi.spyOn(FileSessionStore.prototype,'load').mockImplementation(async function(this: FileSessionStore,id){const result=await original.call(this,id);if(once){once=false;entered.resolve();await release.promise;}return result;});
 try{const pending=f.host.prepare(f.input);await entered.promise;f.store.setLoopStatus('artifact-evidence-regression','paused',31);release.resolve();await expect(pending).rejects.toThrow();const row=f.store.listLoopVerificationSessions(f.native.attemptId)[0]!;expect(row.phase).toBe('reserved');expect(await original.call(new FileSessionStore(f.sessionRoot),row.sessionId)).toBeNull();}finally{release.resolve();spy.mockRestore();await f.close();}
});
it('close waits for actual pending file work then rejects late creation',async()=>{
 const f=fixture(),entered=gate(),release=gate(),original=FileSessionStore.prototype.load;let once=true;
 const spy=vi.spyOn(FileSessionStore.prototype,'load').mockImplementation(async function(this: FileSessionStore,id){const result=await original.call(this,id);if(once){once=false;entered.resolve();await release.promise;}return result;});
 try{const pending=f.host.prepare(f.input);await entered.promise;let drained=false;const closing=f.host.close().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);await expect(f.host.prepare(f.input)).rejects.toThrow('loop_verification_host_closed');release.resolve();await expect(pending).rejects.toThrow('loop_verification_host_closed');await closing;expect(drained).toBe(true);expect(f.store.listLoopVerificationSessions(f.native.attemptId)[0]?.phase).toBe('reserved');}finally{release.resolve();spy.mockRestore();await f.close();}
});
it('two host instances cannot hold the same actual session execution owner concurrently',async()=>{
 const f=fixture(),otherStore=new LoopStore(f.file),other=createLoopVerificationSessionHost({...f.options,store:otherStore}),entered=gate(),release=gate(),original=FileSessionStore.prototype.load;let once=true;
 const spy=vi.spyOn(FileSessionStore.prototype,'load').mockImplementation(async function(this: FileSessionStore,id){const result=await original.call(this,id);if(once){once=false;entered.resolve();await release.promise;}return result;});
 try{const pending=f.host.prepare(f.input);await entered.promise;await expect(other.prepare(f.input)).rejects.toThrow();expect(f.store.listLoopVerificationSessions(f.native.attemptId)).toHaveLength(1);release.resolve();const row=await pending;expect(row.phase).toBe('session_ready');expect(await other.recover({id:row.id,requestSource:'scheduler'})).toEqual(row);}finally{release.resolve();spy.mockRestore();await other.close();otherStore.close();await f.close();}
});
