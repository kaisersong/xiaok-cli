import {persistInstalledMaintenanceRequest,assertInstalledMaintenanceRequestRecorded,type InstalledCleanupCommandFacts} from './installed-maintenance-handoff.js';
import {assertMountedProbeDeleted} from '../isolated-execution/mounted-engine-probe.js';
import type {BlobTransactionWriteContext} from './blob-transaction-command-dispatch.js';
import {consumeBlobTransactionContext} from './blob-budget.js';
import {consumeBlobCommandContext} from './blob-budget.js';
import type {CapacityWriteContext,PreparedCapacityCommandFacts} from './capacity-command.js';
import {createEngineQualificationCapacityOwner,createEngineQualificationAllocation} from './shared-blob-capacity.js';
import {assertVerificationBlobBudgetDatabase} from './blob-budget.js';
import {qualificationDisplayDeadline} from './qualification-display-deadline.js';
import {createMountedEngineProbe} from '../isolated-execution/mounted-engine-probe.js';
import type {QuiescenceExpectation} from '../isolated-execution/physical-quiescence.js';
import type {Database} from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {version as osVersion} from 'node:os';
import {initializeInstalledMacEngine,assertInstalledMacEngineHandle,assertInstalledEngineDatabase,inspectInstalledMacEngineHandle} from './installed-engine.js';
import {createInstalledRootBrokerClient} from './root-broker-client.js';
import type {createVerificationBlobBudget,BlobReservationProposal} from './blob-budget.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {runVerificationTransaction,assertVerificationDatabaseBudget} from './storage-budget.js';
import {ExecutionJournal,type ExecutionRecord} from '../isolated-execution/execution-journal.js';
import {DockerEngineTransport} from '../isolated-execution/docker-engine-transport.js';
import {buildDockerWorkerRequest,WORKER_POLICY_SHA256} from '../isolated-execution/docker-request.js';
const hash=(v:unknown)=>createHash('sha256').update(json(v)).digest('hex');
type EngineHandle=Awaited<ReturnType<typeof initializeInstalledMacEngine>>;
const installedQualifications=new WeakMap<object,{engine:EngineHandle;database:Database;deleted:WeakMap<object,BlobReservationProposal>;mounted:object;baseCurrent():void;assertCurrent():void;assertDrained():void}>();
const cleanupHandoffCommands=new WeakMap<object,InstalledCleanupCommandFacts>();
const unresolvedQualifications=new Set<object>();
export function inspectQualificationCleanupHandoffCommand(command:object):Readonly<InstalledCleanupCommandFacts>|undefined{return cleanupHandoffCommands.get(command);}
export function assertInstalledQualificationDrained(value:object,database:Database):void{const known=installedQualifications.get(value);if(!known||known.database!==database)throw Error('qualification_identity');known.assertDrained();}
export interface QualificationReport {qualificationId:string;engineBinding:{engineId:string;incarnation:string};isolationPolicyHash:string;evidenceHashes:{osIdentity:string;engineInspection:string;escapeSuite:string}}
export function assertInstalledEngineQualificationIdentity(value:object,engine:EngineHandle,database:Database):void{const fact=installedQualifications.get(value);if(!fact||fact.engine!==engine)throw Error('qualification_identity');assertInstalledEngineDatabase(engine,database);}
export function assertInstalledEngineQualification(value:object,engine:EngineHandle):void{const fact=installedQualifications.get(value);if(!fact||fact.engine!==engine)throw Error('qualification_identity');fact.assertCurrent();}
export function assertInstalledQualificationDeleted(value:object,database:Database,proof:object,proposal:Readonly<BlobReservationProposal>,kind:'probe'|'mounted'):void{const known=installedQualifications.get(value);if(!known||known.database!==database)throw Error('qualification_identity');known.baseCurrent();if(kind==='mounted'){assertMountedProbeDeleted(known.mounted,database,proof,proposal);return;}if(kind!=='probe')throw Error('qualification_deletion_kind');const fact=known.deleted.get(proof);if(!fact||hash(fact)!==hash(proposal))throw Error('qualification_deletion_fact');}

/** Fixed commands run only in a container created from the installed immutable
 * image. The challenge is host-generated, never copied from project output. */
function probe(challenge:string){return `set -eu
[ "$(id -u)" = 10000 ]
grep -Eq '^CapEff:[[:space:]]+0000000000000000$' /proc/self/status
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
grep -Eq '^Seccomp:[[:space:]]+2$' /proc/self/status
[ "$(cat /sys/fs/cgroup/pids.max)" = 64 ]
[ "$(cat /sys/fs/cgroup/memory.max)" = 268435456 ]
[ "$(cat /sys/fs/cgroup/memory.swap.max)" = 0 ]
[ "$(cat /sys/fs/cgroup/cpu.max)" = '100000 100000' ]
[ "$(ls /sys/class/net)" = lo ]
[ ! -S /var/run/docker.sock ]
[ ! -S /run/xiaok-engine/docker.sock ]
[ ! -e '/Library/Application Support/xiaok-verification' ]
awk '$2=="/" { if ($4 !~ /(^|,)ro(,|$)/) exit 1; found=1 } END { if (!found) exit 1 }' /proc/mounts
if touch /xiaok-forbidden-write 2>/tmp/ro-error; then exit 1; fi
grep -q 'Read-only file system' /tmp/ro-error
command -v unshare >/dev/null
if unshare -U /bin/true 2>/tmp/unshare-error; then exit 1; fi
grep -q 'Operation not permitted' /tmp/unshare-error
printf '%s' '${challenge}'
`;}
interface ProbeRecord {expected:ExecutionRecord['expected'];body:ReturnType<typeof buildDockerWorkerRequest>;allocation:BlobReservationProposal;engineHash:string;deleted:boolean;challenge:string;mountedExpected?:QuiescenceExpectation;mountedDeleted?:boolean}
const mountedQualificationRecords=new WeakMap<object,{database:Database;engine:EngineHandle;record:ProbeRecord}>();
export function persistMountedQualificationExpected(owner:object,database:Database,expected:QuiescenceExpectation):void{const fact=mountedQualificationRecords.get(owner);if(!fact||fact.database!==database||!database.inTransaction)throw Error('mounted_qualification_identity');assertInstalledEngineDatabase(fact.engine,database);fact.record.mountedExpected=JSON.parse(json(expected));fact.record.mountedDeleted=false;persistQualificationRecord(database,fact.record);}
const qualificationTransactionCommands=new WeakMap<object,{database:Database;budget:ReturnType<typeof createVerificationBlobBudget>;engine:EngineHandle;journal:ExecutionJournal;challenge:string;command:string[];scopeDigest:string;operation:string;engineHash:string;capacityOwner:object|undefined;record?:ProbeRecord}>();
export function inspectQualificationTransactionCommand(command:object,budget:object,database:Database):boolean{const fact=qualificationTransactionCommands.get(command);if(!fact)return false;if(fact.budget!==budget||fact.database!==database)throw Error('blob_transaction_command_owner');assertInstalledEngineDatabase(fact.engine,database);return true;}
export function executeQualificationTransactionCommand(command:object,context:BlobTransactionWriteContext):boolean{
 const fact=qualificationTransactionCommands.get(command);if(!fact)return false;const {database:db,budget,engine:installed,journal,challenge,scopeDigest,operation,engineHash,capacityOwner}=fact,transaction=consumeBlobTransactionContext(context,budget,db,command);assertInstalledEngineDatabase(installed,db);
 const reserved=journal.reserve({sessionIdentity:'private-engine-qualification',compoundOperationId:operation,validationInvocationId:operation,scopeDigest,commandDigest:hash(fact.command),materializationDigest:hash([]),engineBindingId:installed.observation.engineId,engineEpoch:1,imageId:installed.imageDigest});
 const body=buildDockerWorkerRequest({imageDigest:installed.imageDigest,argv:fact.command,attemptId:reserved.expected.executionIdentity,scopeDigest}),allocation:BlobReservationProposal={ownerKey:'private-engine-qualification',resourceId:'qualification-'+reserved.expected.executionIdentity,kind:'guest-output',bytes:32*1024**2,scopeDigest,engineBinding:{engineId:installed.observation.engineId,incarnation:engineHash}};
 const record:ProbeRecord={expected:reserved.expected,body,allocation,engineHash,deleted:false,challenge},prepared=Object.freeze({});qualificationPrepareCommands.set(prepared,{database:db,budget,engine:installed,record:JSON.parse(json(record)) as ProbeRecord,capacityBinding:capacityOwner?createEngineQualificationAllocation(capacityOwner,allocation):undefined});try{budget.reserveBatchCommand(prepared,transaction);}finally{qualificationPrepareCommands.delete(prepared);}assertInstalledEngineDatabase(installed,db);fact.record=record;return true;
}
const qualificationPrepareCommands=new WeakMap<object,{database:Database;budget:object;engine:EngineHandle;record:ProbeRecord;capacityBinding:object|undefined}>();
function persistQualificationRecord(db:Database,record:ProbeRecord){runVerificationTransaction(db,()=>{assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json(record))+4096});db.prepare('INSERT INTO verification_engine_qualification VALUES(1,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json').run(json(record));});}
export function inspectQualificationPrepareCommand(command:object,budget:object,database:Database):Readonly<PreparedCapacityCommandFacts>|undefined{const fact=qualificationPrepareCommands.get(command);if(!fact)return undefined;if(fact.database!==database||fact.budget!==budget)throw Error('capacity_command_owner');assertInstalledEngineDatabase(fact.engine,database);return Object.freeze({allocations:Object.freeze([fact.record.allocation]),capacityBinding:fact.capacityBinding});}
export function executeQualificationPrepareCommand(command:object,context:CapacityWriteContext):boolean{const fact=qualificationPrepareCommands.get(command);if(!fact)return false;const tickets=consumeBlobCommandContext(context,fact.budget,fact.database,command);assertInstalledEngineDatabase(fact.engine,fact.database);if(tickets.length!==1||!tickets[0]!.created)throw Error('qualification_database');persistQualificationRecord(fact.database,fact.record);return true;}
/** Actual installed probe lifecycle; not a general callback qualification issuer.
 * Ordinary UID and copied handles fail before any DB/engine operation. */
export function createInstalledEngineQualification(input:{engine:EngineHandle;database:Database;budget:ReturnType<typeof createVerificationBlobBudget>}){
 const installed=input.engine;assertInstalledMacEngineHandle(installed);const {database:db,budget}=input;assertInstalledEngineDatabase(installed,db);assertVerificationBlobBudgetDatabase(budget,db);
 const capacityOwner=budget.usesSharedCapacity?createEngineQualificationCapacityOwner(installed,db):undefined;
 const transport=new DockerEngineTransport({socketPath:installed.hostSocket}),journal=new ExecutionJournal({database:db}),broker=createInstalledRootBrokerClient();
 const engineHash=hash(installed.observation),initialOs=osVersion(),deleted=new WeakMap<object,BlobReservationProposal>();let closed=false,busy=false,admissionClosed=false,currentWork:Promise<QualificationReport>|undefined,closePromise:Promise<void>|undefined,qualification:Readonly<{id:string;escapeHash:string;expires:number;domain:string;clockEpoch:number;engineInspection:string;osIdentity:string;wallSample:number;wallDeadline:number}>|undefined;
 db.exec('CREATE TABLE IF NOT EXISTS verification_engine_qualification(id INTEGER PRIMARY KEY CHECK(id=1),record_json TEXT NOT NULL)');
 function baseCurrent(){if(closed)throw Error('qualification_closed');assertInstalledMacEngineHandle(installed);if(osVersion()!==initialOs)throw Error('qualification_os_changed');}
 function currentClock(){baseCurrent();if(!qualification)throw Error('qualification_not_ready');const c=broker.clock();if(c.domainId!==qualification.domain||c.qualificationEpoch!==qualification.clockEpoch||c.upperBound>=qualification.expires)throw Error('qualification_expired');return c;}
 function assertCurrent(){currentClock();}
 function persist(record:ProbeRecord){persistQualificationRecord(db,record);}
 function read(){const row=db.prepare('SELECT record_json FROM verification_engine_qualification WHERE id=1').get() as {record_json:string}|undefined;if(!row)return undefined;if(Buffer.byteLength(row.record_json)>65536)throw Error('qualification_record');const record=JSON.parse(row.record_json) as ProbeRecord;if(record.engineHash!==engineHash)throw Error('qualification_engine_changed');journal.read(record.expected);return record;}
 async function inspectExact(record:ProbeRecord,id:string){const actual=await transport.inspect(id);baseCurrent();if(actual.Image!==installed.imageDigest||hash(actual.Config.Cmd)!==hash(record.body.Cmd)||hash(actual.Config.Labels)!==hash(record.body.Labels))throw Error('qualification_container_identity');
  for(const [key,value] of Object.entries(record.body.HostConfig)){const found=actual.HostConfig[key];if(key==='RestartPolicy'&&hash(found)===hash({Name:'no',MaximumRetryCount:0}))continue;if(hash(found)!==hash(value))throw Error('qualification_container_policy');}
  return actual;
 }
 const mounted=createMountedEngineProbe({database:db,budget,engine:transport,engineBinding:{engineId:installed.observation.engineId,incarnation:engineHash,epoch:1},imageId:installed.imageDigest,assertCurrent:baseCurrent,capacityOwner});
 const delegated=new Map<string,{record:ProbeRecord;error:unknown}>(),retirementUnknown:unknown[]=[],settledWorkFailures:unknown[]=[];
 // Journal terminal alone does not prove challenge/logs or engine inspection.
 // This live private fact is never reconstructed from a restarted durable row.
 const terminalReady=new Map<string,string>();
 function terminalIdentity(record:ProbeRecord){return hash({expected:record.expected,body:record.body,allocation:record.allocation,engineHash:record.engineHash,challenge:record.challenge});}
 function safeHandoff(record:ProbeRecord){const state=journal.read(record.expected);return !record.mountedExpected&&(state.state==='prepared'||state.state==='created'||state.state==='terminal'&&terminalReady.get(record.expected.executionIdentity)===terminalIdentity(record))&&json(read())===json(record);}
 function handoff(record:ProbeRecord,action:'request'|'ack',verifyOnly=false){
  const command=Object.freeze({}),facts:InstalledCleanupCommandFacts={source:api,database:db,kind:'probe',resourceId:record.expected.executionIdentity,expected:record.expected,allocations:[record.allocation],action,...(action==='ack'?{evidence:json({record,attempt:journal.read(record.expected),state:budget.getState(record.allocation)})}:{})};cleanupHandoffCommands.set(command,facts);
  try{
   if(verifyOnly){assertInstalledMaintenanceRequestRecorded(command);return;}
   try{persistInstalledMaintenanceRequest(command);}catch(error){
    if(action==='request'){
     let safe=false;try{safe=safeHandoff(record);if(safe)assertInstalledMaintenanceRequestRecorded(command);}catch(check){throw new AggregateError([error,check],'qualification_handoff_unknown',{cause:error});}
     if(safe)delegated.set(record.expected.executionIdentity,{record:JSON.parse(json(record)),error});
    }
    throw error;
   }
  }finally{cleanupHandoffCommands.delete(command);}
 }
 async function retire(record:ProbeRecord){
  try{

  if(record.mountedExpected&&!record.mountedDeleted){await mounted.reconcile(record.mountedExpected);record.mountedDeleted=true;persist(record);}
  let state=journal.read(record.expected);
  if(!record.mountedExpected)handoff(record,'request');
  if(state.state==='prepared'){journal.cancelPrepared(record.expected);state=journal.read(record.expected);}
  else if(!record.deleted){
   if(state.state==='created'){journal.beginCancelCreated(record.expected,state.containerId!);state=journal.read(record.expected);}
   if(state.state==='cancelling-created'){const id=state.containerId!;if(!await transport.isContainerAbsent(id)){const actual=await inspectExact(record,id);if(actual.State.Running||actual.State.Pid!==0||actual.State.Status!=='created')throw Error('qualification_cancel_unknown');await transport.remove(id);}if(!await transport.isContainerAbsent(id))throw Error('qualification_cancel_unknown');journal.recordCancelledCreated(record.expected,id);state=journal.read(record.expected);}

   if(!state.containerId){journal.markUnknown(record.expected);const found=await transport.recoverAttempt(record.body);await inspectExact(record,found.Id);journal.reconcileContainer(record.expected,{containerId:found.Id,engineBindingId:installed.observation.engineId,engineEpoch:1});state=journal.read(record.expected);}
   const id=state.containerId!;
   if(!await transport.isContainerAbsent(id)){const actual=await inspectExact(record,id);if(actual.State.Running){await transport.kill(id);await transport.wait(id,{timeoutMs:30000});}const terminal=await inspectExact(record,id);if(terminal.State.Running||terminal.State.Pid!==0||terminal.State.Status!=='exited')throw Error('qualification_drain_unknown');journal.recordPhysicalTerminal(record.expected,id,terminal.State.ExitCode);await transport.remove(id);}
   else if(state.state!=='terminal')throw Error('qualification_missing_unknown');
   if(!await transport.isContainerAbsent(id))throw Error('qualification_cleanup_unknown');
  }
  baseCurrent();record.deleted=true;persist(record);
  if(budget.getState(record.allocation)!=='released'){const token=budget.reserve(record.allocation).token,proof=Object.freeze({});deleted.set(proof,record.allocation);budget.release(token,proof);}
  if(!record.mountedExpected)handoff(record,'ack');delegated.delete(record.expected.executionIdentity);
  }catch(error){if(delegated.get(record.expected.executionIdentity)?.error!==error)retirementUnknown.push(error);throw error;}
 }
 const deletionAuthority=Object.freeze({assertDeleted(proof:object,proposal:Readonly<BlobReservationProposal>){baseCurrent();const expected=deleted.get(proof);if(!expected){mounted.deletionAuthority.assertDeleted(proof,proposal);return;}if(hash(expected)!==hash(proposal))throw Error('qualification_deletion_fact');}});
 async function qualifyWork(signal?:AbortSignal):Promise<QualificationReport>{
  qualification=undefined;let record:ProbeRecord|undefined;
  try{
   baseCurrent();budget.assertExternalOperationBoundary();signal?.throwIfAborted();await inspectInstalledMacEngineHandle(installed);const previous=read();if(previous)await retire(previous);
   const challenge=randomUUID(),command=['/bin/sh','-c',probe(challenge)],scopeDigest=hash({engineHash,policy:WORKER_POLICY_SHA256,challenge}),operation=randomUUID();
   const transactionCommand=Object.freeze({}),preparedFacts={database:db,budget,engine:installed,journal,challenge,command,scopeDigest,operation,engineHash,capacityOwner,record:undefined as ProbeRecord|undefined};qualificationTransactionCommands.set(transactionCommand,preparedFacts);try{budget.executeTransactionCommand(transactionCommand);if(!preparedFacts.record)throw Error('qualification_database');record=preparedFacts.record;}finally{qualificationTransactionCommands.delete(transactionCommand);}
   signal?.throwIfAborted();journal.beginDispatch(record.expected);
   const created=await transport.create(record.body);journal.bindContainer(record.expected,created.Id);signal?.throwIfAborted();journal.markStartRequested(record.expected);await transport.start(created.Id);journal.markRunning(record.expected);await transport.wait(created.Id,{timeoutMs:30000,signal});const terminal=await inspectExact(record,created.Id);if(terminal.State.Running||terminal.State.Pid!==0||terminal.State.Status!=='exited')throw Error('qualification_terminal_unknown');journal.recordPhysicalTerminal(record.expected,created.Id,terminal.State.ExitCode);const logs=await transport.logs(created.Id);if(terminal.State.ExitCode!==0||logs!==challenge)throw Error('qualification_probe_failed');await inspectInstalledMacEngineHandle(installed);terminalReady.set(record.expected.executionIdentity,terminalIdentity(record));await retire(record);mountedQualificationRecords.set(api,{database:db,engine:installed,record});let mountedReport:Awaited<ReturnType<typeof mounted.run>>;try{mountedReport=await mounted.run({signal,qualification:api});}finally{mountedQualificationRecords.delete(api);}record.mountedDeleted=true;persist(record);await inspectInstalledMacEngineHandle(installed);const c=broker.clock(),wallSample=Date.now();qualification=Object.freeze({id:randomUUID(),escapeHash:hash({body:record.body,logs,terminal,mountedEvidence:mountedReport.evidenceHash}),expires:c.upperBound+30000,domain:c.domainId,clockEpoch:c.qualificationEpoch,engineInspection:hash(terminal),osIdentity:hash({observation:installed.observation,os:initialOs}),wallSample,wallDeadline:wallSample+30000});return Object.freeze({qualificationId:qualification.id,engineBinding:{engineId:installed.observation.engineId,incarnation:engineHash},isolationPolicyHash:WORKER_POLICY_SHA256,evidenceHashes:{osIdentity:hash({observation:installed.observation,os:initialOs}),engineInspection:hash(terminal),escapeSuite:qualification.escapeHash}});
  }catch(primary){
   if(record&&!delegated.has(record.expected.executionIdentity)){
    try{const state=journal.read(record.expected).state;if(!['prepared','created','cancelling-created','terminal'].includes(state))journal.markUnknown(record.expected);await retire(record);}
    catch(cleanup){throw new AggregateError([primary,cleanup],primary instanceof Error?primary.message+': qualification_retirement_failed':'qualification_retirement_failed',{cause:primary});}
   }
   throw primary;
  }
 }
 const activeEnsures=new Set<Promise<void>>();
 let refresh:Promise<void>|undefined;
 const api=Object.freeze({deletionAuthority,assertCurrent,
  ensureCurrent(signal?:AbortSignal):Promise<void>{
   if(admissionClosed)return Promise.reject(Error('qualification_closed'));
   const work=Promise.resolve().then(async()=>{
    if(admissionClosed)throw Error('qualification_closed');try{assertCurrent();return;}catch(error){if(!(error instanceof Error)||!['qualification_not_ready','qualification_expired'].includes(error.message))throw error;}
    if(!refresh)refresh=api.qualify(signal).then(()=>{}).finally(()=>{refresh=undefined;});await refresh;signal?.throwIfAborted();assertCurrent();
   });
   activeEnsures.add(work);void work.then(()=>activeEnsures.delete(work),error=>{activeEnsures.delete(work);if(!settledWorkFailures.includes(error))settledWorkFailures.push(error);});return work;
  },
  currentFacts(){const sample=currentClock(),q=qualification!;const validUntil=qualificationDisplayDeadline({originalWallSample:q.wallSample,originalWallDeadline:q.wallDeadline,currentWallSample:Date.now(),continuousRemainingMs:q.expires-sample.upperBound});return Object.freeze({qualificationId:q.id,engineBinding:Object.freeze({engineId:installed.observation.engineId,incarnation:engineHash}),isolationPolicyHash:WORKER_POLICY_SHA256,validUntil,clock:Object.freeze({domainId:q.domain,qualificationEpoch:q.clockEpoch,evidenceHash:sample.evidenceHash}),evidenceHashes:Object.freeze({osIdentity:q.osIdentity,engineInspection:q.engineInspection,escapeSuite:q.escapeHash})});},
  qualify(signal?:AbortSignal):Promise<QualificationReport>{
   if(admissionClosed)return Promise.reject(Error('qualification_closed'));if(busy)return Promise.reject(Error('qualification_busy'));busy=true;
   // Publish the exact work promise before the first effect; close joins it.
   const work=Promise.resolve().then(()=>qualifyWork(signal)).finally(()=>{busy=false;});currentWork=work;void work.catch(error=>{if(!settledWorkFailures.includes(error))settledWorkFailures.push(error);});return work;
  },
  close():Promise<void>{
   if(closePromise)return closePromise;
   let resolve!:()=>void,reject!:(error:unknown)=>void;closePromise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
   // Legacy idle callers may ignore the returned promise. Keep the exact rejected
   // promise available to owners, without creating an unhandled rejection.
   void closePromise.catch(()=>{});admissionClosed=true;
   function finish(workFailures:readonly unknown[],disposeIdleUnknown:boolean){
    const errors:unknown[]=[...retirementUnknown];
    try{
     const record=read();if(record&&!(record.deleted&&budget.getState(record.allocation)==='released')){
      const held=delegated.get(record.expected.executionIdentity);if(!held||json(held.record)!==json(record)||!safeHandoff(record))throw Error('qualification_retirement_unknown');handoff(record,'request',true);
     }
    }catch(error){errors.push(error);}
    // No owned I/O remains in this branch. Idle legacy teardown must be complete
    // before its caller closes DB/budget; descriptor disposal grants no drain fact.
    if(!errors.length||disposeIdleUnknown)for(const stop of [()=>mounted.close(),()=>journal.close(),()=>broker.dispose()])try{stop();}catch(error){errors.push(error);}
    if(errors.length){unresolvedQualifications.add(api);reject(new AggregateError([...workFailures,...errors],'qualification_shutdown_unknown',{cause:workFailures[0]}));return;}
    closed=true;qualification=undefined;unresolvedQualifications.delete(api);resolve();
   }
   if(!busy&&!activeEnsures.size&&!refresh){finish(settledWorkFailures,true);return closePromise;}
   // Pending work keeps the single original close attempt and all actual callers.
   void (async()=>{
    const workFailures=[...settledWorkFailures];
    for(const result of await Promise.allSettled([...activeEnsures,...(currentWork?[currentWork]:[]),...(refresh?[refresh]:[])]))if(result.status==='rejected'&&!workFailures.includes(result.reason))workFailures.push(result.reason);
    finish(workFailures,false);
   })().catch(error=>{unresolvedQualifications.add(api);reject(error);});
   return closePromise;
  },
 });
 installedQualifications.set(api,{engine:installed,database:db,deleted,mounted,baseCurrent,assertCurrent,assertDrained(){if(!closed||busy||activeEnsures.size)throw Error('qualification_drain_unknown');}});return api;
}
