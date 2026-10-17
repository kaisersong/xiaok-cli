import {types as utilTypes} from 'node:util';
import {consumeBlobTransactionContext} from '../verification/blob-budget.js';
import type {BlobTransactionWriteContext} from '../verification/blob-transaction-command-dispatch.js';
import type {AttachedOutputCapture,AttachedOutputResult} from './docker-attached-output.js';
import {inspectExecutionPreparationCommand,executeExecutionPreparationCommand,type ExecutionWriteContext} from '../verification/execution-command-dispatch.js';
import {consumeBlobCommandContext} from '../verification/blob-budget.js';
import type {CapacityWriteContext,PreparedCapacityCommandFacts} from '../verification/capacity-command.js';
import {createHash,randomBytes} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import {canonicalVerificationJson} from '../verification/protocol.js';
import {assertVerificationDatabaseBudget,runVerificationTransaction} from '../verification/storage-budget.js';
import {assertVerificationBlobBudgetDatabase,type createVerificationBlobBudget,type BlobReservationProposal,type BlobReservationTransaction} from '../verification/blob-budget.js';
import {ExecutionJournal} from './execution-journal.js';
import {DockerEngineTransport} from './docker-engine-transport.js';
import {buildDockerMountedRequest,type VolumeProposal} from './docker-volume-request.js';
import type {createInputStager} from './staging.js';
import type {ExecutionCommand,HostIssuedMountPlan} from './execution-port.js';
import type {QuiescenceExpectation} from './physical-quiescence.js';
import {buildDockerStdinWorkerRequest,type DockerStdinDescriptor} from './docker-request.js';
import {extractSingleArtifact} from './artifact-export.js';
declare const rawTransactionBrand:unique symbol;
export interface RawReservationTransaction {readonly [rawTransactionBrand]:true}
function captureExecutionInput(raw:Parameters<ReturnType<typeof createDockerRunner>['reserveExecution']>[0]){
 function fields(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||utilTypes.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('execution_command_data');const descriptors=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(descriptors).length!==keys.length||Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!keys.includes(k)||!('value' in descriptors[k]!)))throw Error('execution_command_data');return Object.fromEntries(keys.map(k=>[k,descriptors[k]!.value]));}
 const v=fields(raw,['ownerKey','sessionIdentity','compoundOperationId','validationInvocationId','scopeDigest','command','materializedInput']),c=fields(v.command,['argv','cwdRelative']),argv=c.argv;
 if(!Array.isArray(argv)||utilTypes.isProxy(argv)||Object.getPrototypeOf(argv)!==Array.prototype||typeof c.cwdRelative!=='string')throw Error('execution_command_data');const entries=Object.getOwnPropertyDescriptors(argv);if(Reflect.ownKeys(entries).length!==argv.length+1)throw Error('execution_command_data');const copied:string[]=[];for(let i=0;i<argv.length;i++){const d=entries[String(i)];if(!d||!('value' in d)||typeof d.value!=='string')throw Error('execution_command_data');copied.push(d.value);}
 for(const k of ['ownerKey','sessionIdentity','compoundOperationId','validationInvocationId','scopeDigest'])if(typeof v[k]!=='string')throw Error('execution_command_data');const plan=v.materializedInput;if(!plan||typeof plan!=='object'||utilTypes.isProxy(plan))throw Error('execution_command_data');
 return Object.freeze({ownerKey:v.ownerKey as string,sessionIdentity:v.sessionIdentity as string,compoundOperationId:v.compoundOperationId as string,validationInvocationId:v.validationInvocationId as string,scopeDigest:v.scopeDigest as string,command:Object.freeze({argv:Object.freeze(copied) as unknown as string[],cwdRelative:c.cwdRelative}),materializedInput:plan as HostIssuedMountPlan});
}
const rawSelfCommands=new WeakMap<object,{raw:ReturnType<typeof createDockerRunner>;database:Database;input:Parameters<ReturnType<typeof createDockerRunner>['reserveExecution']>[0];result?:ReturnType<ReturnType<typeof createDockerRunner>['reserveExecution']>}>();
export function inspectRawReservationCommand(command:object,raw:object,database:Database):boolean{const fact=rawSelfCommands.get(command);if(!fact)return false;if(fact.raw!==raw||fact.database!==database)throw Error('execution_command_owner');return true;}
export function executeRawReservationCommand(command:object,context:ExecutionWriteContext):boolean{const fact=rawSelfCommands.get(command);if(!fact)return false;const transaction=consumeExecutionCommandContext(context,fact.raw,fact.database,command);fact.result=fact.raw.reserveExecution(fact.input,transaction);return true;}
const dockerTransactionCommands=new WeakMap<object,{raw:ReturnType<typeof createDockerRunner>;budget:object;database:Database;executionCommand:object}>();
export function inspectDockerTransactionCommand(command:object,budget:object,database:Database):boolean{const fact=dockerTransactionCommands.get(command);if(!fact)return false;if(fact.budget!==budget||fact.database!==database)throw Error('blob_transaction_command_owner');assertDockerRunnerDatabase(fact.raw,database);return true;}
export function executeDockerTransactionCommand(command:object,context:BlobTransactionWriteContext):boolean{const fact=dockerTransactionCommands.get(command);if(!fact)return false;fact.raw.commitPreparedCommand(command,context);return true;}
const executionCommandContexts=new WeakMap<object,{raw:object;database:Database;command:object;transaction:RawReservationTransaction;used:boolean}>();
export function consumeExecutionCommandContext(context:ExecutionWriteContext,raw:object,database:Database,command:object):RawReservationTransaction{
 const found=executionCommandContexts.get(context);if(!found||found.used||found.raw!==raw||found.database!==database||found.command!==command||!database.inTransaction)throw Error('execution_command_context');found.used=true;return found.transaction;
}
interface ReservationHandoffSource {readonly plan:HostIssuedMountPlan;readonly ownerKey:string;readonly expected:QuiescenceExpectation}
const reservationHandoffTransactions=new WeakMap<object,{database:Database;read(expected:QuiescenceExpectation):ReservationHandoffSource}>();
/** Only a reservation made by this live private transaction can be attached. */
export function readDockerReservationHandoff(transaction:object,database:Database,expected:QuiescenceExpectation):ReservationHandoffSource{
 const known=reservationHandoffTransactions.get(transaction);if(!known||known.database!==database||!database.inTransaction)throw Error('docker_reservation_handoff_transaction');return known.read(snapshot(expected));
}
const capacityExecutions=new WeakMap<object,{database:Database;plan:HostIssuedMountPlan;allocations:readonly BlobReservationProposal[]}>();
export function readDockerCapacityExecution(binding:object,database:Database,allocations:readonly Readonly<BlobReservationProposal>[]){const known=capacityExecutions.get(binding);if(!known||known.database!==database||canonicalVerificationJson(known.allocations)!==canonicalVerificationJson(allocations))throw Error('docker_capacity_binding');return known.plan;}
const runnerDatabases=new WeakMap<object,{database:Database;imageId:string;deleted:WeakMap<object,BlobReservationProposal>;assertCurrent():void;readCapacity(expected:QuiescenceExpectation):Readonly<BlobReservationProposal>}>();
export function assertDockerRunnerDeleted(runner:object,database:Database,proof:object,proposal:Readonly<BlobReservationProposal>):void{const known=runnerDatabases.get(runner);if(!known||known.database!==database)throw Error('docker_runner_database_identity');known.assertCurrent();const fact=known.deleted.get(proof);if(!fact||digest(fact)!==digest(proposal))throw Error('docker_runner_deletion_fact');}
export function readDockerArchiveCapacitySource(runner:object,database:Database,expected:QuiescenceExpectation){const known=runnerDatabases.get(runner);if(!known||known.database!==database)throw Error('docker_capacity_source');known.assertCurrent();return known.readCapacity(expected);}
export function assertDockerRunnerDatabase(runner:object,database:Database,expectedImageId?:string):void{const known=runnerDatabases.get(runner);if(!known||known.database!==database||expectedImageId!==undefined&&known.imageId!==expectedImageId)throw Error('docker_runner_database_identity');known.assertCurrent();}
const digest=(x:unknown)=>createHash('sha256').update(canonicalVerificationJson(x)).digest('hex');
function invocation(x:QuiescenceExpectation|{sessionIdentity:string;compoundOperationId:string;validationInvocationId:string}){return {sessionIdentity:x.sessionIdentity,compoundOperationId:x.compoundOperationId,validationInvocationId:x.validationInvocationId};}
function snapshot<T>(x:T):T{return JSON.parse(canonicalVerificationJson(x));}
function synchronous(x:unknown){if(x!==undefined){void Promise.resolve(x).catch(()=>{});throw Error('docker_runner_authority_sync');}}
type NativeManifest=ReturnType<ReturnType<typeof createInputStager>['getManifest']>;
export interface DockerRunnerStager {getManifest(plan:HostIssuedMountPlan):NativeManifest & {stdin?:DockerStdinDescriptor};readFile(plan:HostIssuedMountPlan,path:string):Buffer;readStdin?(plan:HostIssuedMountPlan):Buffer}
interface Resources {stdin?:DockerStdinDescriptor;ownerKey:string;expected:QuiescenceExpectation;input:VolumeProposal;output:VolumeProposal;inputAllocation:BlobReservationProposal;outputAllocation:BlobReservationProposal;command:ExecutionCommand;holderAttempt:string;workerAttempt:string;imageId:string;engine:{engineId:string;incarnation:string;epoch:number};holderId?:string;sealed:boolean;deleting?:boolean;workerRemoved?:boolean;holderRemoved?:boolean;inputRemoved?:boolean;outputRemoved?:boolean}
const dockerPrepareCommands=new WeakMap<object,{database:Database;budget:object;resources:Resources;capacityBinding:object}>();
export function inspectDockerPrepareCommand(command:object,budget:object,database:Database):Readonly<PreparedCapacityCommandFacts>|undefined{const facts=dockerPrepareCommands.get(command);if(!facts)return undefined;if(facts.database!==database||facts.budget!==budget)throw Error('capacity_command_owner');return Object.freeze({allocations:Object.freeze([facts.resources.inputAllocation,facts.resources.outputAllocation]),capacityBinding:facts.capacityBinding});}
export function executeDockerPrepareCommand(command:object,context:CapacityWriteContext):boolean{const facts=dockerPrepareCommands.get(command);if(!facts)return false;const {database:db,budget,resources:r}=facts,tickets=consumeBlobCommandContext(context,budget,db,command);if(tickets.length!==2||tickets.some(t=>!t.created))throw Error('docker_runner_database_binding');const json=canonicalVerificationJson(r);assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json)+4096});db.prepare('INSERT INTO docker_runner_resources VALUES(?,?)').run(r.expected.executionIdentity,json);return true;}
/** Protected-controller execution machinery. This driver does NOT mint a qualified
 * physical receipt. The installed qualification owner must inspect these exact
 * records and engine facts; development transports/test doubles cannot qualify it. */
export function createDockerRunner(options:{database:Database;budget:ReturnType<typeof createVerificationBlobBudget>;engine:DockerEngineTransport;engineBinding:{engineId:string;incarnation:string;epoch:number};imageId:string;assertCurrent():void;stager:DockerRunnerStager;outputBytes:number}){
 const {database:db,budget,engine,assertCurrent}=options,engineBinding=snapshot(options.engineBinding),imageId=options.imageId,outputBytes=options.outputBytes;
 assertVerificationBlobBudgetDatabase(budget,db);
 const getManifest=options.stager.getManifest.bind(options.stager),readFile=options.stager.readFile.bind(options.stager),readStdin=options.stager.readStdin?.bind(options.stager);
 if(!Number.isSafeInteger(outputBytes)||outputBytes<4096||outputBytes>128*1024**2||!Number.isSafeInteger(engineBinding.epoch)||engineBinding.epoch<1||!/^sha256:[a-f0-9]{64}$/.test(imageId))throw Error('docker_runner_configuration');
 const journal=new ExecutionJournal({database:db}),livePlans=new Map<string,{plan:HostIssuedMountPlan;expected:QuiescenceExpectation;dispatched:boolean}>(),outputs=new WeakMap<object,{expected:QuiescenceExpectation;captured:AttachedOutputResult}>(),deleted=new WeakMap<object,BlobReservationProposal>();let closed=false;
 db.exec('CREATE TABLE IF NOT EXISTS docker_runner_resources(execution_id TEXT PRIMARY KEY,resources_json TEXT NOT NULL)');
 function current(){if(closed)throw Error('docker_runner_closed');synchronous(assertCurrent());}
 function persist(r:Resources){const json=canonicalVerificationJson(r);assertVerificationDatabaseBudget(db,{additionalBytes:Buffer.byteLength(json)+4096});db.prepare('INSERT INTO docker_runner_resources VALUES(?,?) ON CONFLICT(execution_id) DO UPDATE SET resources_json=excluded.resources_json').run(r.expected.executionIdentity,json);}
 function resource(expected:QuiescenceExpectation):Resources{current();journal.read(expected);const row=db.prepare('SELECT resources_json FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity) as {resources_json:string}|undefined;if(!row)throw Error('docker_runner_resources_unknown');const r=JSON.parse(row.resources_json) as Resources;if(digest(r.expected)!==digest(expected)||digest(r.engine)!==digest(engineBinding)||r.imageId!==imageId)throw Error('docker_runner_binding');return r;}
 function body(r:Resources,role:'holder'|'worker'){
  const common={imageDigest:imageId,attemptId:role==='holder'?r.holderAttempt:r.workerAttempt,scopeDigest:r.expected.scopeDigest,inputVolume:r.input.name,outputVolume:r.output.name};
  return role==='holder'?buildDockerMountedRequest({...common,role}):buildDockerMountedRequest({...common,role,command:r.command,...(r.stdin?{stdin:r.stdin}:{})});
 }
 async function inspectExact(r:Resources,role:'holder'|'worker',id:string){
  current();const info=await engine.inspect(id);current();const expected=body(r,role);
  if(info.Image!==imageId||info.Id!==id)throw Error('docker_runner_container_identity');
  for(const [key,value] of Object.entries(expected.HostConfig)){let actual=info.HostConfig[key];if(key==='Mounts'&&Array.isArray(actual))actual=actual.map(m=>({...m,ReadOnly:m.ReadOnly??false}));if(key==='RestartPolicy'&&digest(actual)===digest({Name:'no',MaximumRetryCount:0}))continue;if(digest(actual)!==digest(value))throw Error('docker_runner_policy_'+key,{cause:{expected:value,actual}});}
  for(const key of ['User','Env','WorkingDir','Entrypoint','Cmd','Labels'] as const){if(key==='Entrypoint'&&info.Config[key]===null)continue;if(digest(info.Config[key])!==digest(expected[key]))throw Error('docker_runner_config_'+key);}
  for(const key of ['AttachStdin','OpenStdin','StdinOnce','Tty'] as const)if((info.Config[key]??false)!==((expected as Record<string,unknown>)[key]??false))throw Error('docker_runner_config_'+key);
  return info;
 }
 function stdinBytes(plan:HostIssuedMountPlan,manifest:NativeManifest & {stdin?:DockerStdinDescriptor}){
  if(!('stdin' in manifest))return undefined;
  if(!readStdin||!manifest.stdin)throw Error('docker_runner_stdin_binding');
  buildDockerStdinWorkerRequest({request:{imageDigest:imageId,attemptId:'stdin-check',scopeDigest:manifest.scopeDigest,argv:manifest.command.argv},stdin:manifest.stdin});
  const bytes=readStdin(plan);if(!Buffer.isBuffer(bytes)||bytes.length!==manifest.stdin.bytes||createHash('sha256').update(bytes).digest('hex')!==manifest.stdin.sha256)throw Error('docker_runner_stdin_binding');return Buffer.from(bytes);
 }
 function livePlan(r:Resources){current();if(r.deleting)throw Error('docker_runner_cleanup_started');if(budget.getState(r.inputAllocation)!=='reserved'||budget.getState(r.outputAllocation)!=='reserved')throw Error('docker_runner_capacity_released');const plan=livePlans.get(r.expected.executionIdentity)?.plan;if(!plan)throw Error('docker_runner_restart_inspection_only');const manifest=getManifest(plan);if(digest(manifest.invocation)!==digest(invocation(r.expected))||manifest.scopeDigest!==r.expected.scopeDigest||digest(manifest.command)!==digest(r.command)||digest(manifest.stdin??null)!==digest(r.stdin??null))throw Error('docker_runner_material_changed');return {plan,manifest};}
 async function cancelNeverStarted(r:Resources){
  let record=journal.read(r.expected);if(record.state==='created'){journal.beginCancelCreated(r.expected,record.containerId!);record=journal.read(r.expected);}
  if(record.state!=='cancelling-created'||!record.containerId)throw Error('docker_runner_cancel_state');
  if(!await engine.isContainerAbsent(record.containerId)){const info=await inspectExact(r,'worker',record.containerId);if(info.State.Running||info.State.Pid!==0||info.State.Status!=='created')throw Error('docker_runner_cancel_unknown');await engine.remove(record.containerId);}
  current();if(!await engine.isContainerAbsent(record.containerId))throw Error('docker_runner_cancel_unknown');journal.recordCancelledCreated(r.expected,record.containerId);
 }
 const deletionAuthority=Object.freeze({assertDeleted(proof:object,proposal:Readonly<BlobReservationProposal>):void{current();const fact=deleted.get(proof);if(!fact||digest(fact)!==digest(proposal))throw Error('docker_runner_deletion_fact');}});
 const reservationTransactions=new WeakMap<object,BlobReservationTransaction>();
 const transactionHandoffs=new WeakMap<object,Map<string,{source:ReservationHandoffSource;resource:string;journal:string}>>();
 const consumedCommands=new WeakSet<object>();
 const runner=Object.freeze({
  reserveCommand(command:object):void{inspectExecutionPreparationCommand(command,runner,db);if(consumedCommands.has(command))throw Error('execution_command_consumed');consumedCommands.add(command);const prepared=Object.freeze({});dockerTransactionCommands.set(prepared,{raw:runner,budget,database:db,executionCommand:command});try{budget.executeTransactionCommand(prepared);}finally{dockerTransactionCommands.delete(prepared);}},
  commitPreparedCommand(prepared:object,blobContext:BlobTransactionWriteContext):void{const preparedFact=dockerTransactionCommands.get(prepared);if(!preparedFact||preparedFact.raw!==runner)throw Error('execution_command_owner');const budgetTransaction=consumeBlobTransactionContext(blobContext,budget,db,prepared),command=preparedFact.executionCommand;
   const transaction=Object.freeze({}) as RawReservationTransaction;reservationTransactions.set(transaction,budgetTransaction);
   const made=new Map<string,{source:ReservationHandoffSource;resource:string;journal:string}>();transactionHandoffs.set(transaction,made);
   reservationHandoffTransactions.set(transaction,{database:db,read(expected){
    if(closed||!db.inTransaction)throw Error('docker_reservation_handoff_transaction');const saved=made.get(expected.executionIdentity);
    if(!saved||digest(saved.source.expected)!==digest(expected)
     ||canonicalVerificationJson(db.prepare('SELECT * FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity))!==saved.resource
     ||canonicalVerificationJson(db.prepare('SELECT * FROM execution_attempts WHERE execution_id=?').get(expected.executionIdentity))!==saved.journal)throw Error('docker_reservation_handoff_changed');
    return Object.freeze({...saved.source,expected:Object.freeze(snapshot(saved.source.expected))});
   }});
   const context=Object.freeze({}),facts={raw:runner,database:db,command:command??prepared,transaction,used:false};executionCommandContexts.set(context,facts);
   try{executeExecutionPreparationCommand(command,context);if(!facts.used)throw Error('execution_command_context');}finally{executionCommandContexts.delete(context);reservationHandoffTransactions.delete(transaction);transactionHandoffs.delete(transaction);reservationTransactions.delete(transaction);}
  },
  deletionAuthority,
  reserveExecution(input:{ownerKey:string;sessionIdentity:string;compoundOperationId:string;validationInvocationId:string;scopeDigest:string;command:ExecutionCommand;materializedInput:HostIssuedMountPlan},transaction?:RawReservationTransaction):Readonly<{executionIdentity:string;expected:QuiescenceExpectation}>{
   if(!transaction){const prepared=Object.freeze({}),fact={raw:runner,database:db,input:captureExecutionInput(input),result:undefined as {executionIdentity:string;expected:QuiescenceExpectation}|undefined};rawSelfCommands.set(prepared,fact);try{runner.reserveCommand(prepared);if(!fact.result)throw Error('execution_command_result');return fact.result;}finally{rawSelfCommands.delete(prepared);}}

   const budgetTransaction=transaction&&reservationTransactions.get(transaction);if(transaction&&!budgetTransaction)throw Error('docker_runner_transaction');
   const {materializedInput}=input;const proposed=snapshot({ownerKey:input.ownerKey,sessionIdentity:input.sessionIdentity,compoundOperationId:input.compoundOperationId,validationInvocationId:input.validationInvocationId,scopeDigest:input.scopeDigest,command:input.command});current();
   const manifest=getManifest(materializedInput);if(digest(manifest.invocation)!==digest(invocation(proposed))||manifest.scopeDigest!==proposed.scopeDigest||digest(manifest.command)!==digest(proposed.command))throw Error('docker_runner_material_changed');
   stdinBytes(materializedInput,manifest);
   const inputBytes=Math.max(4096,manifest.files.reduce((n,file)=>n+Math.max(4096,Math.ceil(file.size/4096)*4096)+4096*file.path.split('/').length,0));
   const volume=(bytes:number):VolumeProposal=>({name:'xiaok-'+randomBytes(16).toString('hex'),creationNonce:randomBytes(32).toString('hex'),engineEpoch:engineBinding.incarnation,bytes});const inputVolume=volume(inputBytes),outputVolume=volume(outputBytes);
   const allocation=(v:VolumeProposal,kind:'guest-input'|'guest-output'):BlobReservationProposal=>({ownerKey:proposed.ownerKey,resourceId:v.name,kind,bytes:v.bytes,scopeDigest:proposed.scopeDigest,engineBinding:{engineId:engineBinding.engineId,incarnation:engineBinding.incarnation}});
   return runVerificationTransaction(db,()=>{
    const record=journal.reserve({sessionIdentity:proposed.sessionIdentity,compoundOperationId:proposed.compoundOperationId,validationInvocationId:proposed.validationInvocationId,scopeDigest:proposed.scopeDigest,commandDigest:digest(proposed.command),materializationDigest:digest(manifest),engineBindingId:engineBinding.engineId,engineEpoch:engineBinding.epoch,imageId});
    if(db.prepare('SELECT 1 FROM docker_runner_resources WHERE execution_id=?').get(record.expected.executionIdentity))throw Error('docker_runner_reservation_replay');
    const r:Resources={ownerKey:proposed.ownerKey,expected:record.expected,...(manifest.stdin?{stdin:snapshot(manifest.stdin)}:{}),input:inputVolume,output:outputVolume,inputAllocation:allocation(inputVolume,'guest-input'),outputAllocation:allocation(outputVolume,'guest-output'),command:proposed.command,holderAttempt:'holder-'+record.expected.executionIdentity,workerAttempt:'worker-'+record.expected.executionIdentity,imageId,engine:engineBinding,sealed:false};
    const capacityBinding=Object.freeze({});capacityExecutions.set(capacityBinding,{database:db,plan:materializedInput,allocations:snapshot([r.inputAllocation,r.outputAllocation])});
    const command=Object.freeze({});dockerPrepareCommands.set(command,{database:db,budget,resources:snapshot(r),capacityBinding});try{budget.reserveBatchCommand(command,budgetTransaction);}finally{dockerPrepareCommands.delete(command);capacityExecutions.delete(capacityBinding);}
    if(transaction){const made=transactionHandoffs.get(transaction);if(!made)throw Error('docker_reservation_handoff_transaction');made.set(record.expected.executionIdentity,{source:{plan:materializedInput,ownerKey:proposed.ownerKey,expected:snapshot(record.expected)},resource:canonicalVerificationJson(db.prepare('SELECT * FROM docker_runner_resources WHERE execution_id=?').get(record.expected.executionIdentity)),journal:canonicalVerificationJson(db.prepare('SELECT * FROM execution_attempts WHERE execution_id=?').get(record.expected.executionIdentity))});}
    livePlans.set(record.expected.executionIdentity,{plan:materializedInput,expected:record.expected,dispatched:false});return Object.freeze({executionIdentity:record.expected.executionIdentity,expected:record.expected});
   });
  },
  /** Private rollback cleanup: never releases durable resources or creates a terminal fact. */
  discardUncommittedExecution(expectedInput:QuiescenceExpectation){
   current();if(db.inTransaction)throw Error('docker_runner_outer_transaction');
   const expected=snapshot(expectedInput),cached=livePlans.get(expected.executionIdentity);
   if(!cached||cached.dispatched||digest(cached.expected)!==digest(expected))throw Error('docker_runner_uncommitted_identity');
   if(db.prepare('SELECT 1 FROM execution_attempts WHERE execution_id=?').get(expected.executionIdentity)||db.prepare('SELECT 1 FROM docker_runner_resources WHERE execution_id=?').get(expected.executionIdentity))throw Error('docker_runner_durable_execution');
   livePlans.delete(expected.executionIdentity);
  },
  readExecution(expected:QuiescenceExpectation){resource(expected);return journal.read(expected);},
  readOwnerKey(expected:QuiescenceExpectation){return resource(expected).ownerKey;},
  cancelPreparedExecution(expected:QuiescenceExpectation){resource(expected);journal.cancelPrepared(expected);},
  async inspectCancellationFacts(expected:QuiescenceExpectation){const r=resource(expected),record=journal.read(expected);if(!record.cancelledBeforeStart)throw Error('docker_runner_not_cancelled');if(record.containerId&&!await engine.isContainerAbsent(record.containerId))throw Error('docker_runner_cancel_unknown');if(r.holderId&&!await engine.isContainerAbsent(r.holderId)||!await engine.isVolumeAbsent(r.input)||!await engine.isVolumeAbsent(r.output))throw Error('cancellation_resources_present');current();return Object.freeze({expected:record.expected,engineBinding:Object.freeze({...engineBinding}),cancelledBeforeStart:true as const});},
  async inspectExecutionFacts(expectedInput:QuiescenceExpectation){
   const expected=snapshot(expectedInput),r=resource(expected);let record=journal.read(expected);
   if(record.state==='prepared')throw Error('docker_runner_never_dispatched');
   if(r.deleting){
    // Cleanup cannot create a terminal verdict: recover only the original durable
    // terminal and verify every exact resource is physically absent again.
    if(record.state!=='terminal'||record.cancelledBeforeStart||!Number.isSafeInteger(record.exitCode)||!record.containerId||!r.holderId)throw Error('docker_runner_cleanup_unknown');
    if(!await engine.isContainerAbsent(record.containerId)||!await engine.isContainerAbsent(r.holderId)||!await engine.isVolumeAbsent(r.input)||!await engine.isVolumeAbsent(r.output))throw Error('docker_runner_cleanup_unknown');
    const after=resource(expected),terminal=journal.read(expected);
    if(digest(after)!==digest(r)||digest(terminal)!==digest(record))throw Error('docker_runner_cleanup_changed');
    return Object.freeze({expected,containerId:record.containerId,engineBinding:Object.freeze({...engineBinding}),exitCode:record.exitCode!});
   }
   if(!record.containerId){
    journal.markUnknown(expected);
    const found=await engine.findMountedAttempt(r.workerAttempt);await inspectExact(r,'worker',found.Id);
    journal.reconcileContainer(expected,{containerId:found.Id,engineBindingId:engineBinding.engineId,engineEpoch:engineBinding.epoch});record=journal.read(expected);
   }
   const info=await inspectExact(r,'worker',record.containerId!);
   if(info.State.Running||info.State.Pid!==0||info.State.Status!=='exited'||!Number.isSafeInteger(info.State.ExitCode))throw Error('docker_runner_terminal_unknown');
   journal.recordPhysicalTerminal(expected,record.containerId!,info.State.ExitCode);
   return Object.freeze({expected,containerId:record.containerId!,engineBinding:Object.freeze({...engineBinding}),exitCode:info.State.ExitCode});
  },
  async dispatchExecution(expectedInput:QuiescenceExpectation,options:{signal?:AbortSignal}={}){
   // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
   if(db.inTransaction)throw Error('docker_runner_outer_transaction');
   const expected=snapshot(expectedInput),signal=options.signal,r=resource(expected);livePlan(r);signal?.throwIfAborted();const admitted=livePlan(r),stdin=stdinBytes(admitted.plan,admitted.manifest);journal.beginDispatch(expected);livePlans.get(expected.executionIdentity)!.dispatched=true;let capture:AttachedOutputCapture|undefined;
   try{
    for(const volume of [r.input,r.output]){livePlan(r);signal?.throwIfAborted();await engine.createVolume(volume);await engine.inspectVolume(volume);}
    livePlan(r);signal?.throwIfAborted();const holder=await engine.createMounted(body(r,'holder'));r.holderId=holder.Id;runVerificationTransaction(db,()=>persist(r));await engine.start(holder.Id);await inspectExact(r,'holder',holder.Id);
    const {plan,manifest}=livePlan(r);for(const file of manifest.files){livePlan(r);signal?.throwIfAborted();await engine.populateInputFile(holder.Id,{path:file.path,bytes:readFile(plan,file.path),executable:file.executable},signal);}
    for(const file of manifest.files){
     livePlan(r);signal?.throwIfAborted();
     const bytes=extractSingleArtifact(await engine.readInputArchive(holder.Id,file.path,{signal}),file.path);
     if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.contentHash)throw Error('docker_runner_input_hash');
    }
    livePlan(r);r.sealed=true;runVerificationTransaction(db,()=>persist(r));
    const worker=await engine.createMounted(body(r,'worker'));journal.bindContainer(expected,worker.Id);await inspectExact(r,'worker',worker.Id);livePlan(r);signal?.throwIfAborted();capture=await engine.attachOutput(worker.Id,{signal,...(stdin===undefined?{}:{stdin})});livePlan(r);signal?.throwIfAborted();journal.markStartRequested(expected);await engine.start(worker.Id);journal.markRunning(expected);
    await engine.wait(worker.Id,{signal});const info=await inspectExact(r,'worker',worker.Id);if(info.State.Running||info.State.Pid!==0||info.State.Status!=='exited'||!Number.isSafeInteger(info.State.ExitCode))throw Error('docker_runner_terminal_unknown');
    journal.recordPhysicalTerminal(expected,worker.Id,info.State.ExitCode);const output=Object.freeze({});outputs.set(output,{expected,captured:await capture.completed});
    return Object.freeze({expected,exitCode:info.State.ExitCode,output});
   }catch(error){
    const beforeCancellation=journal.read(expected);
    if(beforeCancellation.state==='created'||beforeCancellation.state==='cancelling-created'){try{await cancelNeverStarted(r);}catch{/* Retain cancellation intent until exact deletion can be confirmed. */}}
    else journal.markUnknown(expected);
    // Revocation/abort stops new effects, but must not prevent exact factual drain.
    // Cleanup depends on service/engine currentness, never the revoked material grant.
    const record=journal.read(expected);
    if(record.containerId&&record.state!=='terminal'&&record.state!=='cancelling-created'){
     try{
      const before=await inspectExact(r,'worker',record.containerId);
      if(before.State.Running){await engine.kill(record.containerId);await engine.wait(record.containerId,{timeoutMs:30000});}
      const after=await inspectExact(r,'worker',record.containerId);
      if(!after.State.Running&&after.State.Pid===0&&after.State.Status==='exited'&&Number.isSafeInteger(after.State.ExitCode))journal.recordPhysicalTerminal(expected,record.containerId,after.State.ExitCode);
     }catch{/* Keep unknown: failed drain never produces a terminal receipt. */}
    }
    throw error;
   }finally{capture?.cancel();}
  },
  readCapturedOutput(output:object,input:{expected:QuiescenceExpectation}){
   const fact=outputs.get(output);if(!fact||digest(fact.expected)!==digest(input.expected))throw Error('docker_runner_output_binding');resource(fact.expected);if(journal.read(fact.expected).state!=='terminal')throw Error('docker_runner_output_unknown');
   // Private already-captured facts survive grant revocation. This neither reads
   // new guest bytes nor grants model disclosure; transcript has its own ACL.
   return Object.freeze({...fact.captured,stdout:Buffer.from(fact.captured.stdout),stderr:Buffer.from(fact.captured.stderr)});
  },
  assertOutputDisclosure(output:object,input:{expected:QuiescenceExpectation}){
   const fact=outputs.get(output);if(!fact||digest(fact.expected)!==digest(input.expected))throw Error('docker_runner_output_binding');livePlan(resource(fact.expected));
  },
  async readArchive(output:object,path:string,input:{expected:QuiescenceExpectation;signal?:AbortSignal;maxBytes?:number}){
   const registered=outputs.get(output)?.expected;if(!registered||digest(registered)!==digest(input.expected))throw Error('docker_runner_output_binding');const r=resource(registered),record=journal.read(registered);livePlan(r);
   if(!r.sealed||!r.holderId||!record.containerId||record.state!=='terminal')throw Error('docker_runner_output_unknown');
   const before=await inspectExact(r,'worker',record.containerId);if(before.State.Running||before.State.Pid!==0)throw Error('docker_runner_terminal_unknown');await inspectExact(r,'holder',r.holderId);
   const bytes=await engine.readArtifactArchive(r.holderId,path,{signal:input.signal,maxBytes:input.maxBytes});livePlan(r);const after=await inspectExact(r,'worker',record.containerId);if(after.State.Running||after.State.Pid!==0)throw Error('docker_runner_terminal_unknown');return bytes;
  },
  async cleanupExecution(expectedInput:QuiescenceExpectation):Promise<void>{
   // The intent must commit before irreversible I/O; an enclosing transaction may roll back.
   if(db.inTransaction)throw Error('docker_runner_outer_transaction');
   const expected=snapshot(expectedInput),r=resource(expected);let record=journal.read(expected);
   if(record.state==='created'||record.state==='cancelling-created'){await cancelNeverStarted(r);record=journal.read(expected);}
   if(record.state!=='terminal')throw Error('docker_runner_cleanup_unknown');
   if(record.cancelledBeforeStart&&!record.containerId&&!r.holderId){
    r.deleting=true;runVerificationTransaction(db,()=>persist(r));
    for(const which of ['input','output'] as const){if(!await engine.isVolumeAbsent(r[which]))throw Error('docker_runner_never_created_conflict');current();const allocation=which==='input'?r.inputAllocation:r.outputAllocation;if(budget.getState(allocation)!=='released'){const token=budget.reserve(allocation).token,proof=Object.freeze({});deleted.set(proof,allocation);budget.release(token,proof);}}return;
   }
   if(!record.containerId||!r.holderId)throw Error('docker_runner_cleanup_unknown');
   r.deleting=true;runVerificationTransaction(db,()=>persist(r));
   // Each exact deletion is reconciled after a lost response only under this
   // durable cleanup intent and the same protected engine incarnation.
   if(!r.workerRemoved){
    if(!await engine.isContainerAbsent(record.containerId)){
     const worker=await inspectExact(r,'worker',record.containerId);if(worker.State.Running||worker.State.Pid!==0)throw Error('docker_runner_cleanup_unknown');await engine.remove(record.containerId);
    }
    current();if(!await engine.isContainerAbsent(record.containerId))throw Error('docker_runner_cleanup_unknown');r.workerRemoved=true;runVerificationTransaction(db,()=>persist(r));
   }
   if(!r.holderRemoved){
    if(!await engine.isContainerAbsent(r.holderId)){
     const holder=await inspectExact(r,'holder',r.holderId);if(holder.State.Running){await engine.kill(r.holderId);await engine.wait(r.holderId,{timeoutMs:30000});}await engine.remove(r.holderId);
    }
    current();if(!await engine.isContainerAbsent(r.holderId))throw Error('docker_runner_cleanup_unknown');r.holderRemoved=true;runVerificationTransaction(db,()=>persist(r));
   }
   for(const which of ['input','output'] as const){
    const flag=which==='input'?'inputRemoved':'outputRemoved',allocation=which==='input'?r.inputAllocation:r.outputAllocation;
    if(!r[flag]){if(!await engine.isVolumeAbsent(r[which]))await engine.removeVolume(r[which]);current();if(!await engine.isVolumeAbsent(r[which]))throw Error('docker_runner_cleanup_unknown');r[flag]=true;runVerificationTransaction(db,()=>persist(r));}
    if(budget.getState(allocation)!=='released'){const token=budget.reserve(allocation).token,proof=Object.freeze({});deleted.set(proof,allocation);budget.release(token,proof);}
   }
  },
  close(){if(!closed){closed=true;livePlans.clear();journal.close();}},
 });
 runnerDatabases.set(runner,{database:db,imageId,deleted,assertCurrent:current,readCapacity(expected){const r=resource(expected);if(journal.read(expected).state!=='terminal')throw Error('docker_capacity_not_terminal');return snapshot(r.outputAllocation);}});return runner;
}
