import {createDshBudgetLedger,createDshBudgetTransaction} from './harness-dsh-budget-ledger.mjs';

/** Mechanical initialization on the Worker's one original connection. This
 * helper cannot open/close a DB, issue a role or create another owner. */
export function initializeHarnessWorkerDatabase({db,workerData,protectedCore,one,all,run,meta,put,number,config,transaction,fail,onOutcomeUnknown}) {
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=${protectedCore?'DELETE':'WAL'}; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;`);
  if (one('PRAGMA integrity_check').integrity_check !== 'ok') fail('database_corrupt');
  const existing = all("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name);
  if (existing.length) {
    if (!existing.includes('metadata') || meta('ownerId') !== workerData.ownerId || meta('initOperationId') !== workerData.initOperationId
      || meta('canonicalRoot') !== workerData.root || meta('identity') !== workerData.identity || !['1','2','3','4','5','6','7','8','9'].includes(meta('schemaVersion'))) fail('owner_mismatch');
    if (workerData.initializing) {
      const activityTables = ['grants', 'runs', 'request_attempts', 'daily_budget', 'formal_trials', 'outbox', 'applied_operations', 'intents', 'forward_steps', 'disabled_bindings'];
      if(meta('schemaVersion')!=='1')fail('initialization_has_activity');
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
  let writerDepth=0;
  db.function('xiaok_harness_dsh_budget_v3',()=>writerDepth>0?1:0);
  db.function('xiaok_harness_dsh_budget_v4',()=>writerDepth>0?1:0);
  db.function('xiaok_harness_dsh_budget_v6',()=>writerDepth>0?1:0);
  db.function('xiaok_harness_dsh_budget_v7',()=>writerDepth>0?1:0);
  db.function('xiaok_harness_dsh_budget_v8',()=>writerDepth>0?1:0);
  db.function('xiaok_harness_dsh_budget_v9',()=>writerDepth>0?1:0);
  db.function('xiaok_harness_dsh_budget_v5',()=>writerDepth>0?1:0);
  const originalDshTransaction=createDshBudgetTransaction(db,onOutcomeUnknown);
  const dshTransaction=action=>{writerDepth++;try{return originalDshTransaction(action);}finally{writerDepth--;}};
  const dshLedger=createDshBudgetLedger({db,transaction:dshTransaction,ownerId:workerData.ownerId,profileId:workerData.profileId,workspaceId:workerData.workspaceId});
  if(meta('schemaVersion')!=='1'){dshLedger.schema(meta('schemaVersion'));dshLedger.graph();}
  return {dshTransaction,dshLedger};
}
