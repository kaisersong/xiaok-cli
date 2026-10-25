import {expect,it} from 'vitest';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import * as journal from '../../../src/runtime/loop/artifact-export-journal.js';
import type {LoopArtifactExportRecord,LoopArtifactExportEvent} from '../../../src/runtime/loop/artifact-export-journal.js';
const identity={device:'1',inode:'2'};
function prepared(){const id=randomUUID();return journal.createLoopArtifactExportRecord(journal.parseLoopArtifactExportPreparation({id,requestSource:'user',now:100,source:{loopId:'loop',runId:'run',candidateId:'candidate',candidateRevision:1,payloadHash:'a'.repeat(64),vectorHash:'b'.repeat(64),descriptor:{selection:{kind:'local',obligationId:'obligation',path:'result.html'},sha256:'c'.repeat(64),size:0}},destination:{parent:tmpdir(),parentIdentity:identity,temporaryName:'.xiaok-export-'+id,targetName:'result.html',ownershipToken:'d'.repeat(64)}}),1);}
function advance(r:Readonly<LoopArtifactExportRecord>,event:LoopArtifactExportEvent){return journal.advanceLoopArtifactExport(r,journal.parseLoopArtifactExportUpdate({id:r.id,expectedRevision:r.revision,requestSource:'user',now:r.updatedAt+1,event}));}
function at(stage:string){let r=prepared();if(stage==='prepared')return r;r=advance(r,{kind:'created',fileIdentity:identity});if(stage==='created')return r;r=advance(r,{kind:'staged',fileIdentity:identity,sha256:r.source.descriptor.sha256,size:0});return stage==='staged'?r:advance(r,{kind:'committing'});}
// The helper is a pure historical transition, not an installed-owner or IO grant.
const interrupt=(r:Readonly<LoopArtifactExportRecord>,now:number)=>journal.interruptPendingLoopArtifactExport(r,now);
it.each(['prepared','created','staged','committing'])('classifies original %s as unknown without a fabricated user update or cleanup fact',stage=>{
 const original=at(stage),before=JSON.stringify(original),result=interrupt(original,200);
 expect(result).toMatchObject({id:original.id,sequence:1,revision:original.revision+1,progress:stage,state:'unknown',fileIdentity:original.fileIdentity,lastEvent:{kind:'interrupted'},outcome:{status:'unknown',committed:null,cleanup:'unknown',error:'artifact_export_interrupted'},updatedAt:200});
 expect(result.source).toEqual(original.source);expect(result.destination).toEqual(original.destination);expect(JSON.stringify(original)).toBe(before);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.destination.parentIdentity)).toBe(true);
 expect(interrupt(result,201)).toEqual(result);expect(()=>advance(result,{kind:'committing'})).toThrow();
});
it.each(['completed','failed-known','unknown-cleanup'])('preserves already recorded %s facts',kind=>{
 const r=at('committing'),outcome=kind==='completed'?{status:'completed' as const,committed:true,cleanup:'removed' as const,error:null}:{status:'failed' as const,committed:true,cleanup:kind==='failed-known'?'removed' as const:'unknown' as const,error:'original failure'};
 const recorded=advance(r,{kind:'settled',outcome});expect(interrupt(recorded,200)).toEqual(recorded);
});
it.each([99,NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1])('refuses invalid or backward lifecycle time %s',now=>{expect(()=>interrupt(prepared(),now)).toThrow();});
it('validates historical records before treating a terminal-looking object as finished',()=>{expect(()=>interrupt({...prepared(),state:'settled'} as never,200)).toThrow();let called=0;const raw={...prepared()};Object.defineProperty(raw,'state',{enumerable:true,get(){called++;return 'settled';}});expect(()=>interrupt(raw,200)).toThrow();expect(called).toBe(0);});

it('refuses revision overflow instead of wrapping or replaying',()=>{const original=prepared();expect(()=>interrupt({...original,revision:Number.MAX_SAFE_INTEGER} as never,200)).toThrow();});
