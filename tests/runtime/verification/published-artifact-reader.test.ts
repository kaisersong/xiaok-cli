import {createPublishedArtifactIndex,findIndexedPublishedArtifacts,publishedArtifactPopulation} from '../../../src/runtime/verification/published-artifact-index.js';
import {createLoopApplicationBinding,loopApplicationBindingHash} from '../../../src/runtime/verification/loop-application-binding.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {parsePublishedArtifactSelection} from '../../../src/runtime/verification/published-artifact-selection.js';
vi.mock('../../../src/runtime/verification/published-artifact-selection.js',async original=>{const actual=await original<typeof import('../../../src/runtime/verification/published-artifact-selection.js')>();return {...actual,parsePublishedArtifactSelection:vi.fn(actual.parsePublishedArtifactSelection)};});
vi.mock('../../../src/runtime/verification/published-artifact-index.js',async original=>{const actual=await original<typeof import('../../../src/runtime/verification/published-artifact-index.js')>();return {...actual,createPublishedArtifactIndex:vi.fn(actual.createPublishedArtifactIndex)};});
import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readPublishedArtifact,readPublishedArtifacts} from '../../../src/runtime/verification/published-artifact-reader.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const owner={profileId:'profile',ownerKind:'task' as const,ownerId:'task'},hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(change?:(body:any)=>void){const bytes=Buffer.from('original verified bytes'),body={version:1,owner,dependencies:[],evaluations:[{obligationId:'output',definitionHash:'b'.repeat(64),binding:{},evaluation:{},artifacts:[{path:'out/report.txt',size:bytes.length,sha256:hash(bytes),bytesBase64:bytes.toString('base64')}]}]};change?.(body);const encoded=Buffer.from(json(body));return{owner,businessRevision:1,operationId:'operation',fullTupleHash:'a'.repeat(64),payloadHash:hash(encoded),bytes:encoded};}
it('returns copied bytes for an exact logical artifact without opening any workspace file',()=>{
 const payload=fixture(),selected=readPublishedArtifact(payload,{kind:'local',obligationId:'output',path:'out/report.txt'});
 expect(selected.bytes.toString()).toBe('original verified bytes');expect(selected).toMatchObject({operationId:'operation',businessRevision:1,fullTupleHash:'a'.repeat(64),path:'out/report.txt'});
 selected.bytes.fill(0);expect(readPublishedArtifact(payload,{kind:'local',obligationId:'output',path:'out/report.txt'}).bytes.toString()).toBe('original verified bytes');
});
it.each(['hash','size','base64','duplicate','owner','path','missing','payload-hash'] as const)('rejects malformed or ambiguous published artifacts: %s',mode=>{
 const payload=fixture(body=>{const a=body.evaluations[0].artifacts[0];if(mode==='hash')a.sha256='c'.repeat(64);if(mode==='size')a.size++;if(mode==='base64')a.bytesBase64+='\n';if(mode==='duplicate')body.evaluations[0].artifacts.push({...a});if(mode==='owner')body.owner={...owner,ownerId:'other'};if(mode==='path')a.path='../report.txt';});
 if(mode==='payload-hash')payload.bytes[0]=0;
 expect(()=>readPublishedArtifact(payload,{kind:'local',obligationId:'output',path:mode==='missing'?'missing.txt':mode==='path'?'../report.txt':'out/report.txt'})).toThrow(/published_artifact_/);
});
it('separates inherited and local obligations with identical logical paths',()=>{
 const originOwner={...owner,ownerId:'child'},payload=fixture(body=>{body.evaluations.push({...body.evaluations[0],kind:'inherited',originOwner,originalObligationId:'output'});});
 expect(readPublishedArtifact(payload,{kind:'local',obligationId:'output',path:'out/report.txt'}).bytes.toString()).toBe('original verified bytes');
 expect(readPublishedArtifact(payload,{kind:'inherited',obligationId:'output',originOwner,originalObligationId:'output',path:'out/report.txt'}).bytes.toString()).toBe('original verified bytes');
 expect(()=>readPublishedArtifact(payload,{kind:'inherited',obligationId:'output',originOwner:{...originOwner,ownerId:'foreign'},originalObligationId:'output',path:'out/report.txt'})).toThrow('published_artifact_not_unique');
});
it('captures and freezes both selection and inherited origin independently of caller mutation',()=>{
 const originOwner={...owner,ownerId:'child'},payload=fixture(body=>{body.evaluations.push({...body.evaluations[0],kind:'inherited',originOwner,originalObligationId:'output'});});
 const selection={kind:'inherited' as const,obligationId:'output',originOwner:{...originOwner},originalObligationId:'output',path:'out/report.txt'};
 const result=readPublishedArtifacts(payload,[selection])[0];selection.path='changed';selection.originOwner.ownerId='foreign';
 expect(result.selection.path).toBe('out/report.txt');expect(Object.isFrozen(result.selection)).toBe(true);
 expect(result.selection.kind).toBe('inherited');if(result.selection.kind!=='inherited')throw Error('unexpected selection');
 expect(result.selection.originOwner.ownerId).toBe('child');expect(Object.isFrozen(result.selection.originOwner)).toBe(true);
 expect(()=>{result.selection.originOwner.ownerId='foreign';}).toThrow();
});

it('batch returns every requested origin in request order and rejects any corrupt later member',()=>{
 const payload=fixture(body=>{const first=body.evaluations[0].artifacts[0];body.evaluations[0].artifacts.push({...first,path:'out/second.txt'});});
 const selections=[{kind:'local' as const,obligationId:'output',path:'out/second.txt'},{kind:'local' as const,obligationId:'output',path:'out/report.txt'}];
 const result=readPublishedArtifacts(payload,selections);expect(result.map(r=>r.path)).toEqual(['out/second.txt','out/report.txt']);result[0].bytes.fill(0);expect(result[1].bytes.toString()).toBe('original verified bytes');expect(payload.bytes.toString()).not.toContain('changed');
 const corrupt=fixture(body=>{const first=body.evaluations[0].artifacts[0];body.evaluations[0].artifacts.push({...first,path:'out/second.txt',sha256:'c'.repeat(64)});});
 expect(()=>readPublishedArtifacts(corrupt,[...selections].reverse())).toThrow('published_artifact_content');
 expect(()=>readPublishedArtifacts(payload,[selections[0],selections[0]])).toThrow('published_artifact_selection_duplicate');
});
it('batch rejects excessive request population before inspecting any selection',()=>{
 let accessed=0;const item=Object.defineProperty({},'kind',{enumerable:true,get(){accessed++;return 'local';}}),requests=Array(100000).fill(item);
 expect(()=>readPublishedArtifacts(fixture(),requests)).toThrow('published_artifact_selection_limit');expect(accessed).toBe(0);
});
it.each(['selection','origin'] as const)('rejects unknown oversized %s keys before invoking the canonical selector parser',mode=>{
 const hugeKey='x'.repeat(2*1024**2),selection=mode==='selection'?{kind:'local',obligationId:'output',path:'out/report.txt',[hugeKey]:'x'}:{kind:'inherited',obligationId:'output',path:'out/report.txt',originalObligationId:'output',originOwner:{profileId:'profile',ownerKind:'task',[hugeKey]:'x'}};
 vi.mocked(parsePublishedArtifactSelection).mockClear();expect(()=>readPublishedArtifacts(fixture(),[selection as any])).toThrow();expect(parsePublishedArtifactSelection).not.toHaveBeenCalled();
});
it('cannot drop a corrupt later selection by reentrantly shrinking its caller array',()=>{
 const payload=fixture(body=>{body.evaluations[0].artifacts.push({...body.evaluations[0].artifacts[0],path:'bad',sha256:'c'.repeat(64)});});
 const selections:any[]=[];selections.push(new Proxy({kind:'local',obligationId:'output',path:'out/report.txt'},{getOwnPropertyDescriptor(target,key){selections.length=1;return Reflect.getOwnPropertyDescriptor(target,key);}}),{kind:'local',obligationId:'output',path:'bad'});
 expect(()=>readPublishedArtifacts(payload,selections)).toThrow();
});
it('empty batch still validates its payload and oversized selector text is rejected before encoding',()=>{
 expect(readPublishedArtifacts(fixture(),[])).toEqual([]);
 expect(()=>readPublishedArtifacts({...fixture(),payloadHash:'c'.repeat(64)},[])).toThrow('published_artifact_payload');
 expect(()=>readPublishedArtifacts(fixture(),[{kind:'local',obligationId:'output',path:'x'.repeat(4*1024**2)}])).toThrow();
});
it('retains no unrequested records while counting and checking the entire artifact population',()=>{
 const payload=fixture(body=>{const artifact=body.evaluations[0].artifacts[0];body.evaluations[0].artifacts=Array.from({length:4096},(_,i)=>({...artifact,path:`out/${i}.txt`}));});
 vi.mocked(createPublishedArtifactIndex).mockClear();expect(readPublishedArtifacts(payload,[])).toEqual([]);
 const index=vi.mocked(createPublishedArtifactIndex).mock.results[0].value;
 expect(publishedArtifactPopulation(index).count).toBe(4096);
 expect(findIndexedPublishedArtifacts(index,owner,{kind:'local',obligationId:'output',path:'out/0.txt'})).toEqual([]);
 const bad=fixture(body=>{body.evaluations[0].artifacts[0].path='../invalid';});expect(()=>readPublishedArtifacts(bad,[])).toThrow();
});

it('shares one actual content index across 256 applications and the complete near-limit selection population',()=>{
 const content=Buffer.alloc(90*1024,97),digest=hash(content),subject={kind:'loop-run' as const,loopId:'artifact-evidence-regression',runId:'large',stage:null},loopOwner={profileId:'profile',...loopHostSubjectOwner(subject)};
 const binding=createLoopApplicationBinding({version:1,kind:'loop',subject,candidateId:'candidate',candidateRevision:1,originalTriggerJson:json({kind:'manual'}),logicalRunKey:null,contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Original',completionCriterion:'Original'},body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:1,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[{selection:{kind:'local',obligationId:'o0',path:'file-0.bin'},size:content.length,sha256:digest}]}}),application={binding,bindingHash:loopApplicationBindingHash(binding),revision:1};
 const body={version:1,owner:loopOwner,dependencies:[],application,evaluations:Array.from({length:256},(_,i)=>({obligationId:'o'+i,definitionHash:'b'.repeat(64),binding:{},evaluation:{},application,artifacts:[{path:'file-'+i+'.bin',size:content.length,sha256:digest,bytesBase64:content.toString('base64')}]}))},bytes=Buffer.from(json(body));
 expect(bytes.length).toBeGreaterThan(30*1024**2);expect(bytes.length).toBeLessThan(32*1024**2);
 vi.mocked(createPublishedArtifactIndex).mockClear();
 const result=readPublishedArtifacts({owner:loopOwner,businessRevision:1,operationId:'operation',fullTupleHash:'a'.repeat(64),payloadHash:hash(bytes),bytes},Array.from({length:256},(_,i)=>({kind:'local',obligationId:'o'+i,path:'file-'+i+'.bin'})));
 expect(result).toHaveLength(256);expect(result.reduce((sum,item)=>sum+item.bytes.length,0)).toBe(256*content.length);expect(result[255].bytes).toEqual(content);expect(createPublishedArtifactIndex).toHaveBeenCalledTimes(1);
},15000);
