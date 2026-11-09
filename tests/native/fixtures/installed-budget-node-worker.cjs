// Fixed component entry; no Main/production role is created.
const {parentPort,workerData}=require('node:worker_threads');
require('node:worker_threads').threadId=999999;
workerData.threadId=999999;
let namespaceSetterTraps=0;
Object.defineProperty(Object.prototype,'__namespaceBirth',{set(){namespaceSetterTraps++;throw undefined;},configurable:true});
const addon=require(workerData.addon);
let traps=0;const fake=new Proxy({},{get(){traps++;throw undefined;},ownKeys(){traps++;throw undefined;},getPrototypeOf(){traps++;throw undefined;}});
for(const candidate of [fake,new SharedArrayBuffer(32)]){let denied=false;try{addon.adoptOriginalBudgetWorker(candidate);}catch{denied=true;}if(!denied)throw Error('FOREIGN_WORKER_CARRIER_ACCEPTED');}
if(traps)throw Error('FOREIGN_WORKER_CARRIER_TRAP');
const core=addon.adoptOriginalBudgetWorker(workerData.carrier);
let replayDenied=false;try{addon.adoptOriginalBudgetWorker(workerData.carrier);}catch{replayDenied=true;}
if(!replayDenied||namespaceSetterTraps)throw Error('WORKER_SOURCE_REPLAY_OR_SETTER');
delete Object.prototype.__namespaceBirth;
const api=require(workerData.adapter).wrapOriginalProtectedSQLiteNamespace(core);
const db=new api.Database();
db.exec('BEGIN IMMEDIATE;CREATE TABLE actual_budget_worker(id INTEGER PRIMARY KEY,spent INTEGER NOT NULL);INSERT INTO actual_budget_worker VALUES(1,17);COMMIT;');
const row=db.prepare('SELECT spent FROM actual_budget_worker WHERE id=1').get();
if(row.spent!==17)throw Error('ACTUAL_WORKER_SQL_MISMATCH');
db.close();core.closeOwned();
addon.retireOriginalBudgetWorker(workerData.carrier);
parentPort.postMessage({kind:'actual-budget-worker-sql',spent:row.spent,foreignCarrierRejected:true,replayDenied,namespaceSetterTraps,spoofedPublicThreadId:require('node:worker_threads').threadId,proxyTraps:traps,productionQualified:false});
