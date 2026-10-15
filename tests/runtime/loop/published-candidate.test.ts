import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const f=vi.hoisted(()=>({route:{} as any,application:{} as any,observation:{} as any,payload:{} as any,opened:0,disposed:0,calls:[] as string[],change:undefined as undefined|((point:string)=>void),failPublisher:false,hang:false,disposeThrows:false,release:undefined as undefined|(()=>void)}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:()=>f.route}));
vi.mock('../../../src/runtime/verification/installed-loop-application.js',()=>({createInstalledLoopApplicationClient:(_binding:unknown,source:string)=>{
 expect(source).toBe('scheduler');f.opened++;return {async inspect(){f.calls.push('inspect');if(f.hang)await new Promise<void>(resolve=>{f.release=resolve;});const value=structuredClone(f.application);f.change?.('inspect');return value;},dispose(){f.disposed++;}};
}}));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js',()=>({createInstalledCompletionPublisher:(_owner:unknown,source:string)=>{
 expect(source).toBe('scheduler');if(f.failPublisher)throw Error('offline');f.opened++;return {
 async observe(){f.calls.push('observe');const value=structuredClone(f.observation);f.change?.('observe');return value;},
 async readPayload(){f.calls.push('read');const value={...structuredClone(f.payload),bytes:Buffer.from(f.payload.bytes)};f.change?.('read');return value;},dispose(){f.disposed++;if(f.disposeThrows)throw Error('dispose failed');}};
}}));
import {readCurrentLoopPublishedCandidate} from '../../../src/runtime/loop/published-candidate.js';
import {createLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {parseIndependentRecipeDefinition} from '../../../src/runtime/verification/independent-recipes.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const binding=createLoopApplicationBinding({version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'run',stage:null},candidateId:'candidate',candidateRevision:1,
 originalTriggerJson:json({kind:'manual'}),logicalRunKey:null,
 contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Original objective',completionCriterion:'Original criterion'},
 body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original scan',nextActionKind:'none',nextActionSummary:null,
 diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:1,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},
 artifacts:[{selection:{kind:'local',obligationId:'obligation',path:'result'},sha256:hash('result'),size:6}]}});
const artifactDefinition = parseIndependentRecipeDefinition({
 kind:'artifact-content',
 checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes'}],
});
function setBody(change?:(body:any)=>void){
 const body={version:1,owner:f.route.owner,application:f.application.current,dependencies:[],evaluations:[{
  application:f.application.current,obligationId:'obligation',definitionHash:artifactDefinition.definitionHash,
  binding:{},evaluation:{},
  artifacts:[{path:'result',sha256:hash('result'),size:6,bytesBase64:Buffer.from('result').toString('base64')}],
 }]};
 change?.(body);f.payload.bytes=Buffer.from(json(body));f.payload.payloadHash=hash(f.payload.bytes);
}
beforeEach(()=>{
 f.opened=0;f.disposed=0;f.calls=[];f.change=undefined;f.failPublisher=false;f.hang=false;f.disposeThrows=false;f.release=undefined;
 f.route={kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'profile',...loopHostSubjectOwner(binding.subject)}};
 f.application={state:'active',current:{binding,bindingHash:loopApplicationBindingHash(binding),revision:1},pendingTransitionId:null,pendingTarget:null};
 f.observation={owner:f.route.owner,businessRevision:1,currentVerification:'valid',publication:{status:'committed',current:true,operationId:'operation',fullTupleHash:'a'.repeat(64)}};
 f.payload={owner:f.route.owner,businessRevision:1,operationId:'operation',fullTupleHash:'a'.repeat(64)};setBody();
});
it('reads actual complete bytes and returns only historical data, closes fixed clients',async()=>{
 const result=await readCurrentLoopPublishedCandidate(binding);
 expect(result).toMatchObject({binding,application:f.application.current,owner:f.route.owner,businessRevision:1,operationId:'operation',fullTupleHash:'a'.repeat(64),payloadHash:f.payload.payloadHash});
 expect(result.bytes).toEqual(f.payload.bytes);expect(result.bytes).not.toBe(f.payload.bytes);expect(Object.isFrozen(result)).toBe(true);
 expect(f.calls).toEqual(['inspect','observe','read','inspect','observe']);expect(f.disposed).toBe(f.opened);
 expect(Object.keys(result).sort()).toEqual(['application','binding','businessRevision','bytes','fullTupleHash','operationId','owner','payloadHash']);
});
it.each(['ordinary','migrating','unavailable'])('never falls back to ordinary completion for %s route',async kind=>{f.route={kind};await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.opened).toBe(0);});
it.each(['pending','unbound','binding','revision-hash','pendingTarget'])('rejects application %s',async mode=>{
 if(mode==='binding')f.application.current={...f.application.current,binding:{...binding,candidateId:'foreign'}};
 else if(mode==='revision-hash')f.application.current={...f.application.current,bindingHash:'b'.repeat(64)};
 else if(mode==='pendingTarget')f.application.pendingTarget=binding;
 else f.application.state=mode;
 await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.disposed).toBe(f.opened);
});
it.each(['needs_revalidation','unavailable','absent','cancelled','unknown','not-current','owner'])('rejects publication %s',async mode=>{
 if(['needs_revalidation','unavailable'].includes(mode))f.observation.currentVerification=mode;
 else if(mode==='not-current')f.observation.publication.current=false;
 else if(mode==='owner')f.observation.owner={...f.route.owner,ownerId:'foreign'};
 else f.observation.publication={status:mode};
 await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.disposed).toBe(f.opened);
});
it.each(['owner','businessRevision','operationId','fullTupleHash','payloadHash'])('rejects crossed receiver %s',async field=>{
 f.payload[field]=field==='owner'?{...f.route.owner,ownerId:'foreign'}:field==='businessRevision'?2:'b'.repeat(64);
 await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.disposed).toBe(f.opened);
});
it.each(['version','owner','application','artifact','missing-artifact','canonical','utf8','too-large'])('rejects payload %s',async mode=>{
 if(mode==='canonical')f.payload.bytes=Buffer.from(f.payload.bytes.toString()+'\n');
 else if(mode==='utf8')f.payload.bytes=Buffer.from([255]);
 else if(mode==='too-large')f.payload.bytes=Buffer.alloc(32*1024**2+1);
 else setBody(body=>{if(mode==='version')body.version=2;else if(mode==='owner')body.owner={...body.owner,ownerId:'foreign'};else if(mode==='application')body.application={...body.application,revision:2};else if(mode==='artifact')body.evaluations[0].artifacts[0].bytesBase64=Buffer.from('wrong!').toString('base64');else body.evaluations=[];});
 f.payload.payloadHash=hash(f.payload.bytes);
 await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.disposed).toBe(f.opened);
});
it.each(['inspect','observe','read'])('checks route immediately after %s await',async point=>{
 f.change=p=>{if(p===point)f.route={...f.route,authorityId:'replacement'};};
 await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.calls.at(-1)).toBe(point);expect(f.disposed).toBe(f.opened);
});
it.each(['application','publication'])('rejects %s changes during payload read',async kind=>{
 f.change=p=>{if(p==='read'){if(kind==='application')f.application={...f.application,current:{...f.application.current,revision:2}};else f.observation={...f.observation,businessRevision:2};}};
 await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow();expect(f.disposed).toBe(f.opened);
});
it('captures caller binding before first await',async()=>{const input=structuredClone(binding);f.change=()=>{(input.body as any).summary='changed';};expect((await readCurrentLoopPublishedCandidate(input)).binding).toEqual(binding);});
it.each(['inspect','observe','read'])('honors abort after %s with no write or replay',async point=>{const abort=new AbortController();f.change=p=>{if(p===point)abort.abort(Error('cancelled'));};await expect(readCurrentLoopPublishedCandidate(binding,abort.signal)).rejects.toThrow('cancelled');expect(f.calls.at(-1)).toBe(point);expect(f.disposed).toBe(f.opened);});
it('closes the first client if the second constructor fails',async()=>{f.failPublisher=true;await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow('offline');expect(f.opened).toBe(1);expect(f.disposed).toBe(1);});

it('isolates every returned byte view from the private historical payload',async()=>{const result=await readCurrentLoopPublishedCandidate(binding),original=Buffer.from(result.bytes);result.bytes.fill(0);expect(result.bytes).toEqual(original);expect(hash(result.bytes)).toBe(result.payloadHash);expect(Object.isFrozen(result.application)).toBe(true);expect(Object.isFrozen(result.owner)).toBe(true);});
it.each(['deadline','caller'])('retains actual read lifetime after %s cancellation until the endpoint settles',async mode=>{
 vi.useFakeTimers();f.hang=true;
 try{const abort=new AbortController(),result=readCurrentLoopPublishedCandidate(binding,abort.signal);let settled=false;
 const outcome=result.then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await vi.advanceTimersByTimeAsync(0);expect(f.release).toBeTypeOf('function');
 if(mode==='deadline')await vi.advanceTimersByTimeAsync(10001);else{abort.abort(Error('cancelled'));await vi.advanceTimersByTimeAsync(0);}
 expect(settled).toBe(false);expect(f.disposed).toBe(0);
 f.release!();expect((await outcome).message).toBe(mode==='deadline'?'loop_publication_read_timeout':'cancelled');
 expect(f.calls).toEqual(['inspect']);expect(f.disposed).toBe(f.opened);expect(vi.getTimerCount()).toBe(0);
 }finally{f.release?.();vi.useRealTimers();}
});

it('closes both clients even when one synchronous disposer throws',async()=>{f.disposeThrows=true;await expect(readCurrentLoopPublishedCandidate(binding)).rejects.toThrow('dispose failed');expect(f.disposed).toBe(f.opened);});

it('deep freezes nested historical application and binding data',async()=>{
 const result=await readCurrentLoopPublishedCandidate(binding);
 expect(()=>{(result.binding.body as any).summary='changed';}).toThrow();
 expect(()=>{(result.application.binding.body.artifacts[0] as any).sha256='bad';}).toThrow();
 expect(()=>{(result.application.binding.body.artifacts as any[]).push({});}).toThrow();
 expect(()=>{(result.owner as any).ownerId='other';}).toThrow();
 expect(result.binding).toEqual(binding);expect(result.application.binding).toEqual(binding);
});
