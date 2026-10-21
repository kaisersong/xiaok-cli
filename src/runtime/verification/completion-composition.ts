import {captureKSwarmEnrollmentData} from './kswarm-enrollment-data.js';
import {createSourceDeletionReferenceGuard} from './source-deletion-reference-guard.js';
import {createPublicKey} from 'node:crypto';
import type {Database} from 'better-sqlite3';
import {createCompletionBoundary,type CompletionKernelPeer} from './completion-boundary.js';
import {createOwnerEnrollmentAuthority} from './owner-enrollment-authority.js';
import {createIndependentVerifierRecipes,type RecipeBinding} from './independent-recipes.js';
import {createVerifiedPublicationPayloads} from './verified-publication-payload.js';
import {canonicalVerificationJson} from './protocol.js';
import {COMPLETION_METHODS,type CompletionMethod} from './completion-transport.js';
const compositions=new WeakMap<object,{database:Database;assertCurrent():void}>();
export function assertVerificationCompletionCompositionDatabase(value:object,database:Database):void{const known=compositions.get(value);if(!known||known.database!==database)throw Error('publication_completion_binding');known.assertCurrent();}
const databases=new WeakMap<object,{database:Database;verifierHash:string;assertCurrent():void}>();
export function assertVerificationCompletionDatabase(host:object,database:Database,verifierHash?:string):void{const known=databases.get(host);if(!known||known.database!==database)throw Error('verification_operation_database');if(verifierHash!==undefined&&known.verifierHash!==verifierHash)throw Error('verification_operation_verifier');known.assertCurrent();}
type BoundaryOptions=Parameters<typeof createCompletionBoundary>[0];
type EnrollmentOptions=Parameters<typeof createOwnerEnrollmentAuthority>[0];
type RecipeOptions=Parameters<typeof createIndependentVerifierRecipes>[0];
/** Private installed-controller composition. Ports must be the installed owners;
 * dependency injection in tests never establishes OS qualification. Only `public`
 * may be registered on the authenticated controller dispatcher. */
export function createVerificationCompletionComposition(input:{
 root:string;database:Database;authorityId:string;
 authority:Omit<BoundaryOptions['authority'],'assertVerifiedPayload'>;
 enrollment:Pick<EnrollmentOptions,'resolvePrincipal'|'approve'|'profilePublication'|'kswarmCapability'>;
 recipePorts:Pick<RecipeOptions,'assertCurrent'|'readArtifact'|'runBlackbox'|'readFailedRun'|'assertFailedRunComplete'>;
}){
 const {root,database,authorityId}=input,lifetime=new AbortController();
 const original={...input.authority},qualified=original.assertQualified.bind(input.authority),clock=original.clock.bind(input.authority);
 const quiescence=Object.freeze({assertQuiescent:original.quiescence.assertQuiescent.bind(original.quiescence)});
 const ports=input.recipePorts,recipeCurrent=ports.assertCurrent.bind(ports),readArtifact=ports.readArtifact.bind(ports),runBlackbox=ports.runBlackbox.bind(ports),readFailedRun=ports.readFailedRun.bind(ports),assertFailedRunComplete=ports.assertFailedRunComplete.bind(ports);
 const enrollmentPorts=input.enrollment,resolvePrincipal=enrollmentPorts.resolvePrincipal.bind(enrollmentPorts),approve=enrollmentPorts.approve.bind(enrollmentPorts),profilePublication=Object.freeze({publish:enrollmentPorts.profilePublication.publish.bind(enrollmentPorts.profilePublication),assertPublished:enrollmentPorts.profilePublication.assertPublished.bind(enrollmentPorts.profilePublication)});
 function current(){if(lifetime.signal.aborted)throw Error('completion_composition_closed');const value:unknown=qualified();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('completion_composition_sync');}}
 /** Capture methods once; old returned references cannot outlive this instance. */
 function guarded<T extends object>(target:T,qualifiedTail=true,pureTail:readonly string[]=[]):Omit<T,'close'>{
  const output:Record<string,unknown>={};
  for(const [name,value] of Object.entries(target)){
   if(name==='close')continue;
   if(typeof value!=='function')throw Error('completion_composition_port');
   const call=value.bind(target);
   const tail=()=>{if(qualifiedTail&&!pureTail.includes(name))current();lifetime.signal.throwIfAborted();};
   output[name]=(...args:unknown[])=>{current();const result=call(...args);if(result&&typeof result.then==='function')return Promise.resolve(result).then(value=>{tail();return value;});tail();return result;};
  }
  return Object.freeze(output) as Omit<T,'close'>;
 }
 current();
 const rawRecipes=createIndependentVerifierRecipes({verifierHash:original.verifierHash,quiescence,assertCurrent(binding){current();const value:unknown=recipeCurrent(binding);if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('completion_composition_sync');}current();},readArtifact,runBlackbox,readFailedRun,assertFailedRunComplete(receipt,expected){current();const result=assertFailedRunComplete(receipt,expected);if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('completion_composition_sync');}current();}});
 let payloads:ReturnType<typeof createVerifiedPublicationPayloads>|undefined;
 const completion=createCompletionBoundary({root,database,authority:{...original,clock,quiescence,assertQualified:current,assertVerifiedPayload(tuple){current();if(!payloads)throw Error('completion_payload_uninitialized');payloads.assertTuple(tuple);}}});
 let enrollment:ReturnType<typeof createOwnerEnrollmentAuthority>;
 try{
  payloads=createVerifiedPublicationPayloads({database,recipes:rawRecipes,inspectOwner:completion.authority.service.inspectOwner,assertPublicationTuplesCurrent:completion.authority.host.assertPublicationTuplesCurrent,getCurrentDependencies:completion.authority.service.getCurrentDependencies,assertCurrent:current,proofAuthority:{publicKey:createPublicKey(original.privateKey),issuerId:original.issuerId,keyId:original.keyId,serviceEpoch:original.serviceEpoch,verifierHash:original.verifierHash}});
  enrollment=createOwnerEnrollmentAuthority({database,authorityId,completion,clock(){current();const value=clock();lifetime.signal.throwIfAborted();return value;},resolvePrincipal,approve,profilePublication,kswarmCapability:enrollmentPorts.kswarmCapability});
 }catch(error){lifetime.abort();completion.close();throw error;}
 function shape(raw:unknown,keys:readonly string[]):Record<string,any>{const value=JSON.parse(canonicalVerificationJson(raw));if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('completion_composition_shape');return value;}
 const publicPort=Object.freeze({invoke(method:CompletionMethod,raw:unknown,peer:CompletionKernelPeer,signal?:AbortSignal):unknown{
  if(['completion.prepare-owner','completion.prepare-owner-request','completion.lookup-owner-request','completion.recover-owner-request'].includes(method))raw=captureKSwarmEnrollmentData(raw,true);
  current();signal?.throwIfAborted();if(!COMPLETION_METHODS.includes(method))throw Error('completion_composition_method');
  if(method==='completion.prepare-owner-request'||method==='completion.lookup-owner-request'||method==='completion.recover-owner-request'){
   const p=shape(raw,['requestId','enrollment','registration']),request={requestId:p.requestId,enrollment:p.enrollment,registration:p.registration};
   if(method==='completion.prepare-owner-request')return enrollment.prepareRequest(request,peer);
   if(method==='completion.lookup-owner-request')return enrollment.lookupRequest(request,peer);
   return enrollment.recoverRequest(request,peer);
  }
  if(method==='completion.prepare-owner'){const p=shape(raw,['enrollment','registration']);return enrollment.prepare({enrollment:p.enrollment,registration:p.registration},peer);}
  if(method==='completion.authorize-owner'){const p=shape(raw,['challengeId']);return enrollment.authorize(p.challengeId,peer,signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal);}
  if(method==='completion.read-intent-registration'){const p=shape(raw,['subject']);return enrollment.readIntentRegistration(p.subject,peer);}
  if(method==='completion.read-intent-contract'){const p=shape(raw,['subject']);return enrollment.readIntentContract(p.subject,peer);}
  if(method==='completion.read-goal-fork-source'){const p=shape(raw,['ownerKind','ownerId','sessionId']);return enrollment.readGoalForkSource({ownerKind:p.ownerKind,ownerId:p.ownerId,sessionId:p.sessionId},peer);}
  if(method==='completion.open-owner'){const p=shape(raw,['ownerKind','ownerId']);return enrollment.openOwner({ownerKind:p.ownerKind,ownerId:p.ownerId},peer);}
  return completion.invoke(method,raw,peer);
 }});
 const sourceDeletionGuard=createSourceDeletionReferenceGuard({database,assertCurrent:current,getLiveSourceRegistrationReviews:enrollment.getLiveSourceRegistrationReviews,assertAttemptsUnreferenced:completion.authority.host.assertAttemptsUnreferenced});
 const privateHost=Object.freeze({
  assertSourceDeletionUnreferenced:sourceDeletionGuard,
  readApprovedRecipeBinding(binding:RecipeBinding){
   current();const attempt=completion.authority.host.readAdmittedAttempt(binding),fence=enrollment.captureRegistrationReadFence(attempt.owner);
   const key=canonicalVerificationJson(attempt.owner);
   const facts=()=>canonicalVerificationJson({attempt:database.prepare('SELECT * FROM obligation_attempts WHERE attempt_id=?').get(attempt.attemptId)??null,subject:database.prepare('SELECT * FROM verification_subjects WHERE subject_id=?').get(attempt.subjectId)??null,scope:database.prepare('SELECT * FROM verification_scopes WHERE owner_key=? AND scope_id=?').get(key,attempt.requiredScopeId)??null,guard:database.prepare('SELECT * FROM verification_scope_guards WHERE owner_key=? AND scope_id=?').get(key,attempt.requiredScopeId)??null});
   const before=facts();
   if(canonicalVerificationJson(attempt)!==canonicalVerificationJson(completion.authority.host.readAdmittedAttempt(binding)))throw Error('completion_recipe_binding_changed');
   current();const recipe=enrollment.readApprovedRecipe(attempt.owner,attempt.obligation.obligationId);
   fence();if(before!==facts())throw Error('completion_recipe_binding_changed');lifetime.signal.throwIfAborted();return Object.freeze({attempt,recipe});
  },
  // This transaction-local reader already ends at its final qualified clock.
  // Only lifetime remains at the wrapper tail; another callback could mutate
  // the very clock/facts just observed. Other authority methods retain tails.
  authorityHost:guarded(completion.authority.host,true,['inspectIntentPublicationDependencies','inspectIntentPublicationCompletion']),authorityService:guarded(completion.authority.service),
  completionScopes:guarded(completion.host),enrollment:guarded(enrollment,false),recipes:guarded(rawRecipes),payloads:guarded(payloads),
 });
 databases.set(privateHost,{database,verifierHash:original.verifierHash,assertCurrent:current});
 const result=Object.freeze({public:publicPort,privateHost,close(){if(lifetime.signal.aborted)return;lifetime.abort();try{enrollment.close();}finally{completion.close();}}});
 compositions.set(result,{database,assertCurrent:current});return result;
}
