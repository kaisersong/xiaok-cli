import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';

let db;
const fail = code => { throw new Error(code); };
const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const meta = key => one('SELECT value FROM metadata WHERE key=?', key)?.value;
const put = (key, value) => run('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)', key, String(value));
const number = key => Number(meta(key));
const config = () => JSON.parse(one('SELECT body FROM config WHERE id=1').body);
const save = value => run('UPDATE config SET body=? WHERE id=1', JSON.stringify(value));
const day = now => new Date(now).toISOString().slice(0, 10);
const activity = () => put('activitySeq', number('activitySeq') + 1);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function observeTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('clock_invalid');
  return transaction(() => {
    const previous = number('lastSeenMs');
    if (now < previous - 2000) { put('clockGuard', 1); return false; }
    if (now - previous >= 300000) run('INSERT INTO forward_steps VALUES(?,?,?,?,0)', randomUUID(), previous, now, number('activitySeq'));
    put('lastSeenMs', Math.max(previous, now));
    return number('clockGuard') === 0;
  });
}
function requireTime(now) { if (!observeTime(now)) fail('clock_rollback'); }
function live(runId, now) {
  const r = one('SELECT r.*,g.state AS grantState,g.epoch,g.generation FROM runs r JOIN grants g ON g.runId=r.id WHERE r.id=?', runId);
  if (!r || r.grantState !== 'active' || r.status !== 'active' || r.epoch !== number('epoch') || r.generation !== config().researchGeneration) fail('grant_revoked');
  if (now >= r.deadline || day(now) !== r.day) fail('research_expired');
  if (one('SELECT 1 FROM disabled_bindings WHERE hash=?', r.bindingHash)) fail('binding_unavailable');
  return r;
}
function stopRun(id, reason) {
  const r = one('SELECT * FROM runs WHERE id=?', id);
  if (!r) return;
  run("UPDATE request_attempts SET status='not_sent' WHERE runId=? AND status='prepared'", id);
  run("UPDATE request_attempts SET status='unknown' WHERE runId=? AND status IN ('pre_send','sent')", id);
  const unknown = one("SELECT COALESCE(SUM(tokens),0) AS tokens,COUNT(*) AS requests FROM request_attempts WHERE runId=? AND status='unknown'", id);
  run('UPDATE daily_budget SET reservedTokens=reservedTokens-?,reservedRequests=reservedRequests-? WHERE day=?',
    r.remainingTokens - unknown.tokens, r.remainingRequests - unknown.requests, r.day);
  run('UPDATE runs SET status=?,remainingTokens=?,remainingRequests=?,reason=? WHERE id=?',
    'cancelled', unknown.tokens, unknown.requests, reason, id);
  run("UPDATE grants SET state='revoked' WHERE runId=?", id);
  activity();
}
function snapshot() {
  if (!['epoch', 'lastSeenMs', 'activitySeq'].every(key => Number.isSafeInteger(number(key)) && number(key) >= 0)
    || !['clockGuard', 'recoveryGuard'].every(key => [0, 1].includes(number(key)))) fail('metadata_corrupt');
  return { ownerId: meta('ownerId'), ownerEpoch: number('epoch'), config: config(), recoveryGuard: number('recoveryGuard') === 1, highWaterMark: number('lastSeenMs'), clockGuard: number('clockGuard') === 1 };
}

function initialize() {
  db = new DatabaseSync(workerData.dbPath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  if (one('PRAGMA integrity_check').integrity_check !== 'ok') fail('database_corrupt');
  const existing = all("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name);
  if (existing.length) {
    if (!existing.includes('metadata') || meta('ownerId') !== workerData.ownerId || meta('initOperationId') !== workerData.initOperationId
      || meta('canonicalRoot') !== workerData.root || meta('identity') !== workerData.identity || meta('schemaVersion') !== '1') fail('owner_mismatch');
    if (workerData.initializing) {
      const activityTables = ['grants', 'runs', 'request_attempts', 'daily_budget', 'formal_trials', 'outbox', 'applied_operations', 'intents', 'forward_steps', 'disabled_bindings'];
      if (existing.some(table => !['metadata', 'config', ...activityTables].includes(table))) fail('initialization_unknown_schema');
      for (const table of activityTables) if (!existing.includes(table) || one(`SELECT COUNT(*) AS count FROM ${table}`).count !== 0) fail('initialization_has_activity');
      const c = config();
      if (c.enabled || c.mode !== 'none' || c.configRevision !== 0 || number('activitySeq') !== 0) fail('initialization_has_activity');
    }
  } else {
    if (!workerData.initializing) fail('database_missing_schema');
    transaction(() => {
      db.exec(`
        CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE config(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);
        CREATE TABLE intents(id TEXT PRIMARY KEY,manifestId TEXT NOT NULL,hash TEXT NOT NULL,runId TEXT);
        CREATE TABLE runs(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,manifestHash TEXT NOT NULL,bindingHash TEXT NOT NULL,day TEXT NOT NULL,deadline INTEGER NOT NULL,status TEXT NOT NULL,remainingTokens INTEGER NOT NULL,remainingRequests INTEGER NOT NULL,reason TEXT);
        CREATE TABLE grants(runId TEXT PRIMARY KEY,state TEXT NOT NULL,epoch INTEGER NOT NULL,generation INTEGER NOT NULL);
        CREATE TABLE request_attempts(id TEXT PRIMARY KEY,runId TEXT NOT NULL,stepId TEXT NOT NULL,bodyHash TEXT NOT NULL,tokens INTEGER NOT NULL,nonce TEXT NOT NULL,status TEXT NOT NULL,usage TEXT,preSend INTEGER NOT NULL DEFAULT 0,sendStarted INTEGER NOT NULL DEFAULT 0,UNIQUE(runId,stepId));
        CREATE TABLE daily_budget(day TEXT PRIMARY KEY,usedTokens INTEGER NOT NULL DEFAULT 0,reservedTokens INTEGER NOT NULL DEFAULT 0,usedRequests INTEGER NOT NULL DEFAULT 0,reservedRequests INTEGER NOT NULL DEFAULT 0,guidanceUsed INTEGER NOT NULL DEFAULT 0,guidanceReserved INTEGER NOT NULL DEFAULT 0,CHECK(reservedTokens>=0 AND reservedRequests>=0));
        CREATE TABLE formal_trials(ownerId TEXT PRIMARY KEY,manifestHash TEXT NOT NULL,spent INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE applied_operations(id TEXT PRIMARY KEY,summary TEXT NOT NULL);
        CREATE TABLE disabled_bindings(hash TEXT PRIMARY KEY);
        CREATE TABLE forward_steps(id TEXT PRIMARY KEY,beforeMark INTEGER NOT NULL,afterMark INTEGER NOT NULL,activitySeq INTEGER NOT NULL,consumed INTEGER NOT NULL);
      `);
      for (const [key, value] of Object.entries({ ownerId: workerData.ownerId, initOperationId: workerData.initOperationId,
        canonicalRoot: workerData.root, identity: workerData.identity, schemaVersion: 1, epoch: 0,
        recoveryGuard: 0, activitySeq: 0, lastSeenMs: workerData.now, clockGuard: 0 })) put(key, value);
      run('INSERT INTO config VALUES(1,?)', JSON.stringify(workerData.defaultConfig));
    });
  }
  return snapshot();
}

function execute(command, p) {
  if (command === 'read') return snapshot();
  if (command === 'observe_time') { observeTime(p.now); return snapshot(); }
  if (command === 'reset_clock') return transaction(() => {
    const previous = number('lastSeenMs');
    if (p.expectedHighWaterMark !== previous) fail('clock_reset_forbidden');
    if (p.now < previous) {
      const event = one('SELECT * FROM forward_steps WHERE id=? AND consumed=0', p.correctionEventId ?? '');
      if (!event || p.now < event.beforeMark || p.now >= event.afterMark || event.activitySeq !== number('activitySeq')
        || one("SELECT 1 FROM runs WHERE status='active'") || one("SELECT 1 FROM request_attempts WHERE status IN ('pre_send','sent','unknown')")) fail('clock_reset_forbidden');
      put('lastSeenMs', Math.max(p.now, event.beforeMark)); run('UPDATE forward_steps SET consumed=1 WHERE id=?', event.id);
    } else put('lastSeenMs', p.now);
    put('clockGuard', 0); return snapshot();
  });
  if (command === 'activate') return transaction(() => {
    put('epoch', number('epoch') + 1);
    if (p.dirty) put('recoveryGuard', 1);
    for (const r of all("SELECT id FROM runs WHERE status='active'")) stopRun(r.id, 'owner_restarted');
    run("UPDATE grants SET state='revoked'");
    return snapshot();
  });
  if (command === 'save_config') return transaction(() => {
    const c = config(), next = { ...c, ...p.patch };
    if (JSON.stringify(c) === JSON.stringify(next)) return snapshot();
    next.configRevision++;
    if (next.maxGuidanceTokensPerUtcDay < c.maxGuidanceTokensPerUtcDay || next.maxTotalOptimizationTokensPerUtcDay < c.maxTotalOptimizationTokensPerUtcDay) next.publicGeneration++;
    if (next.maxExtraRequestTokensPerUtcDay < c.maxExtraRequestTokensPerUtcDay || next.maxExtraRequestsPerUtcDay < c.maxExtraRequestsPerUtcDay || next.maxTotalOptimizationTokensPerUtcDay < c.maxTotalOptimizationTokensPerUtcDay) {
      for (const r of all("SELECT id FROM runs WHERE status='active'")) stopRun(r.id, 'budget_reduced');
    }
    save(next); return snapshot();
  });
  if (command === 'intent') {
    requireTime(p.now);
    const requestId = randomUUID();
    run('INSERT INTO intents VALUES(?,?,?,NULL)', requestId, p.manifest.id, hash(p.manifest));
    return { requestId };
  }
  if (command === 'start') {
    requireTime(p.now);
    return transaction(() => {
      const m = p.manifest, h = hash(m), intent = one('SELECT * FROM intents WHERE id=?', p.requestId);
      if (!intent || intent.hash !== h || intent.manifestId !== m.id || m.ownerId !== meta('ownerId')) fail('intent_invalid');
      if (intent.runId) return { runId: intent.runId };
      if (one("SELECT 1 FROM runs WHERE status='active'") || one("SELECT 1 FROM request_attempts WHERE status='unknown'")) fail('research_busy');
      if (one('SELECT 1 FROM disabled_bindings WHERE hash=?', m.bindingHash)) fail('binding_unavailable');
      const deadline = Math.min(m.expiresAt, p.now + m.perRun.timeoutMs, Date.parse(`${day(p.now)}T00:00:00Z`) + 86400000);
      if (deadline - p.now < m.machineBoundMs) fail('research_expired');
      const bucket = day(p.now), c = config();
      run('INSERT OR IGNORE INTO daily_budget(day) VALUES(?)', bucket);
      const b = one('SELECT * FROM daily_budget WHERE day=?', bucket);
      if (![b.usedTokens, b.reservedTokens, b.usedRequests, b.reservedRequests, b.guidanceUsed, b.guidanceReserved].every(value => Number.isSafeInteger(value) && value >= 0)) fail('budget_corrupt');
      if (b.usedTokens + b.reservedTokens + m.perRun.tokens > c.maxExtraRequestTokensPerUtcDay
        || b.usedRequests + b.reservedRequests + m.perRun.requests > c.maxExtraRequestsPerUtcDay
        || b.usedTokens + b.reservedTokens + b.guidanceUsed + b.guidanceReserved + m.perRun.tokens > c.maxTotalOptimizationTokensPerUtcDay) fail('budget_insufficient');
      if (m.executionKind === 'formal-evaluation') {
        const trial = one('SELECT * FROM formal_trials WHERE ownerId=?', meta('ownerId'));
        if (trial?.spent) fail('formal_trial_spent');
        if (trial && trial.manifestHash !== h) fail('formal_trial_conflict');
        run('INSERT OR IGNORE INTO formal_trials VALUES(?,?,0)', meta('ownerId'), h);
      }
      const runId = randomUUID();
      run("INSERT INTO runs VALUES(?,?,?,?,?,?,'active',?,?,NULL)", runId, JSON.stringify(m), h, m.bindingHash, bucket, deadline, m.perRun.tokens, m.perRun.requests);
      run("INSERT INTO grants VALUES(?,'active',?,?)", runId, number('epoch'), c.researchGeneration);
      run('UPDATE intents SET runId=? WHERE id=?', runId, p.requestId);
      run('UPDATE daily_budget SET reservedTokens=reservedTokens+?,reservedRequests=reservedRequests+? WHERE day=?', m.perRun.tokens, m.perRun.requests, bucket);
      activity(); return { runId };
    });
  }
  if (command === 'prepare') {
    requireTime(p.now);
    return transaction(() => {
      const r = live(p.runId, p.now), m = JSON.parse(r.manifest), index = m.steps.findIndex(step => step.id === p.stepId), step = m.steps[index];
      if (!step || step.bodyHash !== p.bodyHash) fail('body_mismatch');
      if (index > 0 && !one("SELECT 1 FROM request_attempts WHERE runId=? AND stepId=? AND status='settled'", r.id, m.steps[index - 1].id)) fail('step_out_of_order');
      if (one('SELECT 1 FROM request_attempts WHERE runId=? AND stepId=?', r.id, step.id)) fail('step_already_claimed');
      const assigned = one("SELECT COALESCE(SUM(tokens),0) AS tokens,COUNT(*) AS requests FROM request_attempts WHERE runId=? AND status IN ('prepared','pre_send','sent','unknown')", r.id);
      if (assigned.tokens + step.tokens > r.remainingTokens || assigned.requests + 1 > r.remainingRequests || p.now + step.timeoutMs > r.deadline) fail('run_budget_insufficient');
      const ticket = { invocationId: randomUUID(), runId: r.id, bodyHash: step.bodyHash, ownerId: meta('ownerId'), ownerEpoch: number('epoch'), researchGeneration: config().researchGeneration, nonce: randomUUID(), latestSendAt: r.deadline - step.timeoutMs, utcDay: r.day };
      run("INSERT INTO request_attempts(id,runId,stepId,bodyHash,tokens,nonce,status) VALUES(?,?,?,?,?,?,'prepared')", ticket.invocationId, r.id, step.id, step.bodyHash, step.tokens, ticket.nonce);
      activity(); return ticket;
    });
  }
  if (command === 'marker') {
    requireTime(p.now);
    return transaction(() => {
      const r = live(p.ticket.runId, p.now), t = p.ticket, a = one('SELECT * FROM request_attempts WHERE id=?', t.invocationId);
      if (!a || a.status !== 'prepared' || a.runId !== t.runId || a.nonce !== t.nonce || a.bodyHash !== t.bodyHash || t.ownerId !== meta('ownerId') || t.ownerEpoch !== number('epoch') || t.researchGeneration !== config().researchGeneration) fail('ticket_invalid');
      run("UPDATE request_attempts SET status='pre_send',preSend=1 WHERE id=?", a.id);
      if (JSON.parse(r.manifest).executionKind === 'formal-evaluation') run('UPDATE formal_trials SET spent=1 WHERE ownerId=?', meta('ownerId'));
      activity(); return snapshot();
    });
  }
  if (command === 'send_started') { run("UPDATE request_attempts SET status='sent',sendStarted=1 WHERE id=? AND status='pre_send'", p.invocationId); return null; }
  if (command === 'cancel_run') { transaction(() => stopRun(p.runId, 'admission_changed')); return null; }
  if (command === 'settle') return transaction(() => {
    const a = one('SELECT * FROM request_attempts WHERE id=?', p.invocationId);
    if (!a || !a.preSend) fail('invocation_unknown');
    const usage = JSON.stringify({ inputTokens: p.inputTokens, outputTokens: p.outputTokens });
    if (a.usage) { if (a.usage !== usage) fail('usage_conflict'); return snapshot(); }
    if (!['pre_send', 'sent', 'unknown'].includes(a.status)) fail('usage_invalid');
    const r = one('SELECT * FROM runs WHERE id=?', a.runId), actual = p.inputTokens + p.outputTokens;
    run('UPDATE daily_budget SET reservedTokens=reservedTokens-?,reservedRequests=reservedRequests-1,usedTokens=usedTokens+?,usedRequests=usedRequests+1 WHERE day=?', a.tokens, actual, r.day);
    run('UPDATE runs SET remainingTokens=remainingTokens-?,remainingRequests=remainingRequests-1 WHERE id=?', a.tokens, r.id);
    run("UPDATE request_attempts SET status='settled',usage=? WHERE id=?", usage, a.id);
    if (actual > a.tokens) {
      run('INSERT OR IGNORE INTO disabled_bindings VALUES(?)', r.bindingHash);
      for (const other of all("SELECT id FROM runs WHERE bindingHash=? AND status='active'", r.bindingHash)) stopRun(other.id, 'usage_over_reservation');
    }
    activity(); return snapshot();
  });
  if (command === 'revoke') return transaction(() => {
    if (p.ownerId !== meta('ownerId') || !Number.isSafeInteger(p.ownerEpoch) || p.ownerEpoch > number('epoch')) fail('journal_owner_mismatch');
    const previous = one('SELECT summary FROM applied_operations WHERE id=?', p.operationId);
    if (previous) return JSON.parse(previous.summary);
    const c = config(), affected = all("SELECT id,manifest FROM runs WHERE status IN ('active','awaiting_scores') OR EXISTS(SELECT 1 FROM request_attempts a WHERE a.runId=runs.id AND a.status='unknown')").filter(r => !p.manifestId || JSON.parse(r.manifest).id === p.manifestId);
    for (const r of affected) stopRun(r.id, 'user_revoked');
    if (p.scope === 'all') { c.publicGeneration++; c.researchGeneration++; if (p.disable) c.enabled = false; c.configRevision++; save(c); }
    const affectedIds = new Set(affected.map(r => r.id));
    const attempts = all('SELECT * FROM request_attempts').filter(a => affectedIds.has(a.runId));
    const known = new Set(attempts.filter(a => a.sendStarted || p.knownSends.includes(a.id)).map(a => a.id));
    const summary = { operationId: p.operationId, affectedRunIds: affected.map(r => r.id),
      knownSendStartedCount: known.size, preSendMarkerCount: attempts.filter(a => a.preSend).length,
      unknownDispatchCount: attempts.filter(a => a.preSend && !known.has(a.id)).length,
      unknownUsageCount: attempts.filter(a => a.status === 'unknown').length,
      trialSpentStatus: one('SELECT spent FROM formal_trials LIMIT 1')?.spent === 1, noOp: false };
    run('INSERT INTO applied_operations VALUES(?,?)', p.operationId, JSON.stringify(summary)); activity();
    return summary;
  });
  if (command === 'audit') return {
    budget: one('SELECT COALESCE(SUM(usedTokens),0) AS usedTokens,COALESCE(SUM(reservedTokens),0) AS reservedTokens,COALESCE(SUM(usedRequests),0) AS usedRequests,COALESCE(SUM(reservedRequests),0) AS reservedRequests FROM daily_budget'),
    buckets: all('SELECT * FROM daily_budget'), attempts: all('SELECT * FROM request_attempts'), runs: all('SELECT id,status,reason FROM runs'), trials: all('SELECT * FROM formal_trials'), ...snapshot(),
  };
  if (command === 'shutdown') {
    transaction(() => { for (const r of all("SELECT id FROM runs WHERE status='active'")) stopRun(r.id, 'app_shutdown'); });
    db.close(); return null;
  }
  fail('command_forbidden');
}

try { parentPort.postMessage({ ready: initialize() }); }
catch { try { db?.close(); } catch {} parentPort.postMessage({ bootError: 'optimization_store_unavailable' }); }
parentPort.on('message', message => {
  try { parentPort.postMessage({ id: message.id, value: execute(message.command, message.payload) }); }
  catch (error) { parentPort.postMessage({ id: message.id, error: /^[a-z_]+$/.test(error.message) ? error.message : 'optimization_store_failure' }); }
});
