import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const f=vi.hoisted(()=>({route:{} as any,response:{} as any,calls:[] as any[],disposed:0,hang:false,release:undefined as undefined|(()=>void),onCall:undefined as undefined|(()=>void)}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>f.route}));
vi.mock('../../../src/runtime/verification/controller-client.js',()=>({createInstalledVerificationClient:()=>({publicationTransport:{async call(method:string,payload:unknown){f.calls.push({method,payload});f.onCall?.();if(f.hang)await new Promise<void>(resolve=>{f.release=resolve;});return f.response;}},dispose(){f.disposed++;}})}));
import {readCurrentLoopPublicationSet,isLoopPublicationSetNotCurrent} from '../../../src/runtime/loop/published-set.js';
import {createLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const binding=createLoopApplicationBinding({version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'run',stage:null},candidateId:'candidate',candidateRevision:1,
 originalTriggerJson:json({kind:'manual'}),logicalRunKey:null,
 contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Original objective',completionCriterion:'Original criterion'},
 body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original scan',nextActionKind:'none',nextActionSummary:null,
 diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:1,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},
 artifacts:[{selection:{kind:'local',obligationId:'obligation',path:'result'},sha256:hash('result'),size:6}]}});

beforeEach(()=>{f.route={kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...loopHostSubjectOwner(binding.subject)}};
 f.response={clock:{domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:'a'.repeat(64)},publications:[{owner:f.route.owner,businessRevision:1,operationId:'op',fullTupleHash:'b'.repeat(64),application:{binding,bindingHash:loopApplicationBindingHash(binding),revision:1}}]};
 f.calls=[];f.disposed=0;f.hang=false;f.onCall=undefined;f.release=undefined;
});
it('uses the fixed signed batch method and deeply freezes the exact application response',async()=>{const result=await readCurrentLoopPublicationSet([binding]);expect(result).toEqual(f.response);expect(f.calls).toEqual([{method:'publication.observeLoopSet',payload:{owners:[loopHostSubjectOwner(binding.subject)]}}]);expect(f.disposed).toBe(1);expect(Object.isFrozen(result.publications[0].application.binding.body)).toBe(true);});
it.each(['owner','profile','binding','revision','tuple','clock','length','extra'])('rejects crossed/malformed response %s',async mode=>{
 const p=f.response.publications[0];
 if(mode==='owner')p.owner={...p.owner,ownerId:'other'};if(mode==='profile')p.owner={...p.owner,profileId:'other'};
 if(mode==='binding')p.application.binding={...binding,candidateId:'other'};if(mode==='revision')p.businessRevision=0;
 if(mode==='tuple')p.fullTupleHash='wrong';if(mode==='clock')f.response.clock.upperBound=999;
 if(mode==='length')f.response.publications=[];if(mode==='extra')p.current=true;
 await expect(readCurrentLoopPublicationSet([binding])).rejects.toThrow();expect(f.disposed).toBe(1);
});
it.each(['ordinary','unavailable','migrating'])('rejects unavailable owner route %s before transport',async kind=>{f.route={kind};await expect(readCurrentLoopPublicationSet([binding])).rejects.toThrow();expect(f.calls).toHaveLength(0);});
it('rejects route replacement while the response is in flight',async()=>{f.onCall=()=>{f.route={...f.route,authorityId:'changed'};};await expect(readCurrentLoopPublicationSet([binding])).rejects.toThrow();expect(f.disposed).toBe(1);});
it('rejects duplicate subject inventory before transport',async()=>{await expect(readCurrentLoopPublicationSet([binding,binding])).rejects.toThrow();expect(f.calls).toHaveLength(0);});
it.each(['deadline','caller'])('retains batch transport lifetime after %s abort until it actually settles',async mode=>{
 vi.useFakeTimers();f.hang=true;try{
 const controller=new AbortController(),work=readCurrentLoopPublicationSet([binding],controller.signal);let settled=false;
 const outcome=work.then(()=>{settled=true;return null;},error=>{settled=true;return error;});await vi.advanceTimersByTimeAsync(0);
 if(mode==='deadline')await vi.advanceTimersByTimeAsync(10001);else{controller.abort(Error('cancelled'));await vi.advanceTimersByTimeAsync(0);}
 expect(settled).toBe(false);expect(f.disposed).toBe(0);f.release!();expect((await outcome).message).toBe(mode==='deadline'?'loop_publication_set_timeout':'cancelled');expect(f.disposed).toBe(1);expect(vi.getTimerCount()).toBe(0);
 }finally{f.release?.();vi.useRealTimers();}
});

it('brands only local currentness negatives and never malformed inventory or transport lookalikes',async()=>{
 f.route={kind:'unavailable'};await readCurrentLoopPublicationSet([binding]).catch(error=>expect(isLoopPublicationSetNotCurrent(error)).toBe(true));
 expect(isLoopPublicationSetNotCurrent(Error('loop_publication_set_route'))).toBe(false);
});

it('parses a retained exact publication observation without an installed route or transport',async()=>{
 const {parseLoopPublicationSetObservation}=await import('../../../src/runtime/loop/published-set.js');
 const expected=f.response.publications[0].owner;f.route={kind:'unavailable'};
 const result=parseLoopPublicationSetObservation(f.response,[binding],[expected]);
 expect(result).toEqual(f.response);expect(Object.isFrozen(result.publications[0].application.binding)).toBe(true);expect(f.calls).toHaveLength(0);
});
it.each(['binding','owner','clock','nested'])('uses the original full parser on malformed retained observations: %s',async mode=>{
 const {parseLoopPublicationSetObservation}=await import('../../../src/runtime/loop/published-set.js');
 expect(typeof parseLoopPublicationSetObservation).toBe('function');
 const expected={...f.response.publications[0].owner};
 if(mode==='binding')f.response.publications[0].application.binding={...binding,candidateRevision:0};
 if(mode==='owner')f.response.publications[0].owner={...expected,ownerId:'other'};
 if(mode==='clock')f.response.clock.evidenceHash='bad';
 if(mode==='nested')f.response.publications[0].application.extra=true;
 expect(()=>parseLoopPublicationSetObservation(f.response,[binding],[expected])).toThrow();expect(f.calls).toHaveLength(0);
});
