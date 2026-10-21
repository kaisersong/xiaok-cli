import {createHash} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import type {ArchiveResourceReview} from './archive-operation-review.js';
import type {VerificationOwner} from './proof-authority.js';
import type {OwnerEnrollmentReview} from './owner-enrollment-review.js';
import {parseIndependentRecipeDefinition} from './independent-recipes.js';
import {canonicalVerificationJson as json} from './protocol.js';
import {runVerificationTransaction} from './storage-budget.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function sync(value:unknown){if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('source_reference_sync');}}
/** Private denial predicate, never a deletion capability or physical receipt. */
export function createSourceDeletionReferenceGuard(input:{database:Database;assertCurrent():void;getLiveSourceRegistrationReviews():ReadonlyArray<Readonly<OwnerEnrollmentReview>>;assertAttemptsUnreferenced(ids:readonly string[]):void}){
 const db=input.database,current=input.assertCurrent.bind(input),reviews=input.getLiveSourceRegistrationReviews.bind(input),attempts=input.assertAttemptsUnreferenced.bind(input);
 return (rawOwner:VerificationOwner,rawResource:Readonly<ArchiveResourceReview>):void=>{
  const owner=JSON.parse(json(rawOwner)) as VerificationOwner,resource=JSON.parse(json(rawResource)) as ArchiveResourceReview,key=json(owner);
  runVerificationTransaction(db,()=>{
   sync(current());
   for(const table of ['verification_execution_transcripts','verification_protected_runs','verification_run_executions','verification_run_producers','owner_enrollment_intents','verification_operations','verification_source_bindings','obligation_attempts'])if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw Error('source_reference_schema_missing');
   const executions=new Map<string,string>(),runIds=new Map<string,string>();
   const addExpected=(raw:unknown)=>{const e=raw as Record<string,unknown>;if(!e||Object.keys(e).sort().join(',')!=='compoundOperationId,executionIdentity,scopeDigest,sessionIdentity,validationInvocationId'||Object.values(e).some(v=>typeof v!=='string'||!v)||!/^[a-f0-9]{64}$/.test(String(e.scopeDigest)))throw Error('source_reference_execution');const id=String(e.executionIdentity),value=json(e),old=executions.get(id);if(old&&old!==value)throw Error('source_reference_execution_conflict');executions.set(id,value);};
   const addRun=(id:string)=>{
    const run=db.prepare('SELECT * FROM verification_protected_runs WHERE source_run_id=?').get(id) as any;
    if(!run||run.owner_key!==key||!['sealed','prepared','complete','deleted'].includes(run.state))throw Error('source_reference_run');
    if(runIds.has(id)){if(runIds.get(id)!==run.run_nonce)throw Error('source_reference_run_conflict');return run;}
    runIds.set(id,run.run_nonce);
    for(const member of db.prepare('SELECT expected_json FROM verification_run_executions WHERE source_run_id=? ORDER BY execution_id').all(id) as {expected_json:string}[])addExpected(JSON.parse(member.expected_json));
    return run;
   };
   if(resource.kind==='transcript'){
    const row=db.prepare('SELECT * FROM verification_execution_transcripts WHERE resource_id=?').get(resource.resourceId) as any;
    if(!row||row.owner_key!==key||!['ready','deleted'].includes(row.state)||hash(row.manifest_json)!==resource.manifestHash)throw Error('source_reference_transcript');
    const m=JSON.parse(row.manifest_json);if(m.ownerKey!==key||m.scope!=='isolated-execution'||m.expected.executionIdentity!==row.execution_id||json({kind:'transcript',resourceId:row.resource_id,manifestHash:hash(row.manifest_json),expected:m.expected,complete:m.complete,truncated:m.truncated,stdout:m.stdout,stderr:m.stderr})!==json(resource))throw Error('source_reference_transcript');
    addExpected(resource.expected);
   }else if(resource.kind==='protected-run'){
    const run=addRun(resource.sourceRunId),members=(db.prepare('SELECT expected_json,observation_json FROM verification_run_executions WHERE source_run_id=? ORDER BY execution_id').all(resource.sourceRunId) as {expected_json:string;observation_json:string|null}[]).map(m=>({expected:JSON.parse(m.expected_json),observationHash:m.observation_json===null?null:hash(m.observation_json)})),producers=db.prepare('SELECT producer_id,parent_id,state FROM verification_run_producers WHERE source_run_id=? ORDER BY producer_id').all(resource.sourceRunId);
    if(json(resource)!==json({kind:'protected-run',sourceRunId:run.source_run_id,runNonce:run.run_nonce,rootInvocation:JSON.parse(run.invocation_json),state:run.state,archiveHash:run.archive_hash,archiveBytes:run.archive_bytes,memberCount:members.length,censusHash:hash(json({members,producers}))}))throw Error('source_reference_census');
   }else throw Error('source_reference_resource');
   // Expand both directions, including a transcript that is the second member of
   // a cumulative approved run. Id equality never substitutes for exact expected.
   for(const [executionId,expected] of executions){
    for(const member of db.prepare('SELECT source_run_id,expected_json FROM verification_run_executions WHERE execution_id=?').all(executionId) as {source_run_id:string;expected_json:string}[]){if(member.expected_json!==expected)throw Error('source_reference_execution_conflict');addRun(member.source_run_id);}
   }
   const checkRegistration=(raw:unknown)=>{
    const registration=raw as OwnerEnrollmentReview['registration'];if(!registration||!Array.isArray(registration.obligations))throw Error('source_reference_registration');
    for(const entry of registration.obligations){
     const parsed=parseIndependentRecipeDefinition(entry.recipe);if(parsed.definitionHash!==entry.obligation.definitionHash||json(parsed.requiredCheckIds)!==json(entry.obligation.requiredCheckIds))throw Error('source_reference_definition');
     const spec=parsed.spec;if(spec.kind!=='diagnostic-coverage')continue;
     for(const source of ('sources' in spec?spec.sources:[spec]))if(runIds.has(source.sourceRunId)||(resource.kind==='transcript'&&(source.sourceRunId===resource.resourceId||source.sourceRunId===resource.expected.executionIdentity)))throw Error('source_native_recipe_reference');
    }
   };
   for(const row of db.prepare('SELECT registration_json FROM owner_enrollment_intents').all() as {registration_json:string}[])checkRegistration(JSON.parse(row.registration_json));
   for(const review of reviews())checkRegistration(review.registration);
   const related=new Set<string>();
   const matchesExpected=(raw:unknown)=>{if(!raw||typeof raw!=='object')throw Error('source_reference_binding');const e=raw as {executionIdentity:string},actual=executions.get(e.executionIdentity);if(actual&&actual!==json(raw))throw Error('source_reference_execution_conflict');return actual!==undefined;};
   for(const row of db.prepare('SELECT attempt_id,owner_key,facts_json,execution_json FROM obligation_attempts').all() as {attempt_id:string;owner_key:string;facts_json:string;execution_json:string|null}[]){
    const facts=JSON.parse(row.facts_json),match=runIds.has(facts.sourceRunId)||(row.execution_json!==null&&matchesExpected(JSON.parse(row.execution_json)));
    if(match){if(runIds.has(facts.sourceRunId)&&runIds.get(facts.sourceRunId)!==facts.runNonce)throw Error('source_reference_run_conflict');if(row.owner_key!==key)throw Error('source_reference_owner');related.add(row.attempt_id);}
   }
   for(const row of db.prepare('SELECT owner_key,state,record_json FROM verification_operations').all() as {owner_key:string;state:string;record_json:string}[]){
    const record=JSON.parse(row.record_json);if(!record.binding||typeof record.binding.attemptId!=='string')throw Error('source_reference_operation');
    if(runIds.has(record.sourceRunId)||matchesExpected(record.binding.expected)){
     if(runIds.has(record.sourceRunId)&&runIds.get(record.sourceRunId)!==record.runNonce)throw Error('source_reference_run_conflict');
     if(row.owner_key!==key||!['terminal','cancelled'].includes(row.state))throw Error('source_operation_recovery_reference');
     const a=db.prepare('SELECT execution_json FROM obligation_attempts WHERE attempt_id=?').get(record.binding.attemptId) as {execution_json:string|null}|undefined;
     if(!a||a.execution_json!==json(record.binding.expected))throw Error('source_reference_operation_binding');related.add(record.binding.attemptId);
    }
   }
   for(const row of db.prepare('SELECT attempt_id,binding_json FROM verification_source_bindings').all() as {attempt_id:string;binding_json:string}[]){
    const binding=JSON.parse(row.binding_json);if(binding.attemptId!==row.attempt_id)throw Error('source_reference_binding');
    if(related.has(row.attempt_id)||matchesExpected(binding.expected)){const a=db.prepare('SELECT execution_json FROM obligation_attempts WHERE attempt_id=?').get(row.attempt_id) as {execution_json:string|null}|undefined;if(!a||a.execution_json!==json(binding.expected))throw Error('source_reference_binding');related.add(row.attempt_id);}
   }
   sync(attempts([...related]));sync(current());
  });
 };
}
