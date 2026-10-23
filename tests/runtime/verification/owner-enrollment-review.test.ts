import {it,expect} from 'vitest';import {createHash} from 'node:crypto';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
import {parseOwnerEnrollmentReview} from '../../../src/runtime/verification/owner-enrollment-review.js';
const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result.txt',sha256:'a'.repeat(64),structure:'utf8' as const}]};
const definitionHash=createHash('sha256').update(canonicalVerificationJson(recipe)).digest('hex');
function fixture(){return {version:1,purpose:'completion-owner-enrollment',authorityId:'authority',challengeId:'challenge',principal:{uid:501,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',auditSessionId:7},profileSlot:'default',enrollment:{ownerKind:'task',ownerId:'task',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',definitionHash,requiredCheckIds:['content']},recipe:structuredClone(recipe)}],source:{kind:'new-owner'}},deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:1500}};}
it('freezes complete separate-purpose native enrollment and binds original definitions to actual recipe parser',()=>{
 const raw=fixture(),parsed=parseOwnerEnrollmentReview(raw);raw.enrollment.ownerId='changed';expect(parsed.enrollment.ownerId).toBe('task');expect(Object.isFrozen(parsed.registration.obligations[0].recipe)).toBe(true);
 for(const mutate of [(r:any)=>r.purpose='materials', (r:any)=>r.registration.obligations[0].obligation.definitionHash='b'.repeat(64),(r:any)=>r.registration.obligations[0].obligation.requiredCheckIds.push('invented'),(r:any)=>r.enrollment.invocations.push(r.enrollment.invocations[0]),(r:any)=>r.registration.obligations.push(r.registration.obligations[0]),(r:any)=>r.principal.extra=true]){const r=structuredClone(fixture());mutate(r);expect(()=>parseOwnerEnrollmentReview(r)).toThrow();}
});
it('rejects partial migration, invalid deadline and truncation instead of treating review data as approval',()=>{
 const migration={...fixture(),registration:{...fixture().registration,source:{kind:'migration',sourceSessionId:'source',sourceStoreRevision:3,sourceSnapshotHash:'b'.repeat(64),migrationId:'migration'}}};expect(parseOwnerEnrollmentReview(migration).registration.source.kind).toBe('migration');
 expect(()=>parseOwnerEnrollmentReview({...migration,registration:{...migration.registration,source:{kind:'migration'}}})).toThrow();
 expect(()=>parseOwnerEnrollmentReview({...fixture(),deadline:{...fixture().deadline,validUntil:1000}})).toThrow();
 const big=fixture();big.registration.obligations[0].recipe.checks=Array.from({length:500},(_,i)=>({id:'check-'+i,path:'result-'+i+'.txt',sha256:'a'.repeat(64),structure:'utf8'}));expect(()=>parseOwnerEnrollmentReview(big)).toThrow();
 let reads=0;expect(()=>parseOwnerEnrollmentReview({...fixture(),get principal(){reads++;return fixture().principal;}})).toThrow();expect(reads).toBe(0);
});

it('accepts explicit Goal session enrollment without inventing an execution invocation',()=>{
 const raw={...fixture(),enrollment:{ownerKind:'goal',ownerId:'goal',goalSessionId:'thread',invocations:[]}};
 expect(parseOwnerEnrollmentReview(raw).enrollment).toEqual(raw.enrollment);
 for(const enrollment of [
  {ownerKind:'goal',ownerId:'goal',invocations:[]},
  {...raw.enrollment,ownerKind:'task'}, {...raw.enrollment,goalSessionId:''},
  {...raw.enrollment,invocations:fixture().enrollment.invocations},
  {...raw.enrollment,extra:true},
 ])expect(()=>parseOwnerEnrollmentReview({...raw,enrollment})).toThrow();
});

it('accepts exact Loop run/stage subjects with no fabricated session or invocation',async()=>{
 const {loopHostSubjectOwner}=await import('../../../src/runtime/verification/loop-host-subject.js');
 for(const stage of [null,{stageId:'stage',stageKind:'verify' as const}]){
  const subject={kind:'loop-run' as const,loopId:'loop',runId:'run',stage};
  const enrollment={...loopHostSubjectOwner(subject),loopSubject:subject,invocations:[]};
  const parsed=parseOwnerEnrollmentReview({...fixture(),enrollment});
  expect(parsed.enrollment).toEqual(enrollment);expect(Object.isFrozen((parsed.enrollment as any).loopSubject)).toBe(true);
  for(const changed of [{...enrollment,ownerId:'unmapped'},{...enrollment,goalSessionId:'invented'},{...enrollment,invocations:fixture().enrollment.invocations},{...enrollment,loopSubject:{...subject,extra:true}},{...enrollment,ownerKind:'goal'}])expect(()=>parseOwnerEnrollmentReview({...fixture(),enrollment:changed})).toThrow();
 }
});
