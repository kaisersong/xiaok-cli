import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {createPublishedArtifactIndex} from '../../../src/runtime/verification/published-artifact-index.js';
import {readPublishedArtifacts} from '../../../src/runtime/verification/published-artifact-reader.js';

const owner={profileId:'profile',ownerKind:'task' as const,ownerId:'task'};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const section=(artifacts:unknown[],obligationId='output')=>({obligationId,definitionHash:'a'.repeat(64),binding:{},evaluation:{},artifacts});
function payload(artifact:unknown){
 const body={version:1,owner,dependencies:[],evaluations:[{obligationId:'output',definitionHash:'a'.repeat(64),binding:{},evaluation:{},artifacts:[artifact]}]};
 const bytes=Buffer.from(json(body));return{owner,businessRevision:1,operationId:'op',fullTupleHash:'b'.repeat(64),payloadHash:hash(bytes),bytes};
}
it('reader rejects null artifact with the stable shape error before field access',()=>{
 expect(()=>readPublishedArtifacts(payload(null),[{kind:'local',obligationId:'output',path:'out.txt'}])).toThrow('published_artifact_shape');
});
it('reader validates the artifact path before selection-byte accounting',()=>{
 const path='../reader-order-marker',encoded=payload({path,sha256:'c'.repeat(64),size:0,bytesBase64:''}),original=Buffer.byteLength;let accounted=0;
 try{
  Buffer.byteLength=function(value:any,...args:any[]){if(typeof value==='string'&&value.startsWith('{"kind":"local"')&&value.includes(path))accounted++;return Reflect.apply(original,this,[value,...args]);} as typeof Buffer.byteLength;
  expect(()=>readPublishedArtifacts(encoded,[{kind:'local',obligationId:'output',path}])).toThrow('published_artifact_path');
 }finally{Buffer.byteLength=original;}
 expect(accounted).toBe(0);
});
it('reader does not let Array.map replacement skip application binding checks',()=>{
 const body={version:1,owner,application:{},dependencies:[],evaluations:[]},bytes=Buffer.from(json(body)),encoded={owner,businessRevision:1,operationId:'op',fullTupleHash:'b'.repeat(64),payloadHash:hash(bytes),bytes};
 const original=Array.prototype.map;let error:unknown;
 try{Array.prototype.map=function(){return [];};try{readPublishedArtifacts(encoded,[]);}catch(cause){error=cause;}}
 finally{Array.prototype.map=original;}
 expect(error).toBeInstanceOf(Error);
});
it('reader still rejects duplicate selections when Set.has is replaced',()=>{
 const first=Buffer.from('one'),second=Buffer.from('two'),body={version:1,owner,dependencies:[],evaluations:[{obligationId:'output',definitionHash:'a'.repeat(64),binding:{},evaluation:{},artifacts:[{path:'one.txt',sha256:hash(first),size:first.length,bytesBase64:first.toString('base64')},{path:'two.txt',sha256:hash(second),size:second.length,bytesBase64:second.toString('base64')}]}]},bytes=Buffer.from(json(body)),encoded={owner,businessRevision:1,operationId:'op',fullTupleHash:'b'.repeat(64),payloadHash:hash(bytes),bytes},selection={kind:'local' as const,obligationId:'output',path:'one.txt'},original=Set.prototype.has;
 let error:unknown;try{Set.prototype.has=function(){return false;};try{readPublishedArtifacts(encoded,[selection,selection]);}catch(cause){error=cause;}}
 finally{Set.prototype.has=original;}
 expect((error as Error)?.message).toBe('published_artifact_selection_duplicate');
});
it('direct index uses the array iterator captured before module consumers run',()=>{
 const raw=Array.prototype[Symbol.iterator],local=section([{path:'out.txt',sha256:'c'.repeat(64),size:0,bytesBase64:''}]);let calls=0,error:unknown;
 try{Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,writable:true,value:function(){calls++;throw Error('replaced_array_iterator');}});try{createPublishedArtifactIndex(owner,[local],new Set());}catch(e){error=e;}}
 finally{Object.defineProperty(Array.prototype,Symbol.iterator,{configurable:true,writable:true,value:raw});}
 expect(error).toBeUndefined();expect(calls).toBe(0);
});
it('direct index rejects an oversized unselected path before population accounting',()=>{
 expect(()=>createPublishedArtifactIndex(owner,[section([{path:'x'.repeat(5000),sha256:'c'.repeat(64),size:0,bytesBase64:''}])],new Set())).toThrow('published_artifact_path');
});
it('direct path preflight cannot mutate input through a replaced String.charCodeAt',()=>{
 const artifact={path:'out.txt',sha256:'c'.repeat(64),size:0,bytesBase64:''},original=String.prototype.charCodeAt;let calls=0;
 try{String.prototype.charCodeAt=function(index:number){calls++;artifact.path='../escape';return Reflect.apply(original,this,[index]);};createPublishedArtifactIndex(owner,[section([artifact])],new Set());}
 finally{String.prototype.charCodeAt=original;}
 expect(calls).toBe(0);expect(artifact.path).toBe('out.txt');
});
it('direct index rejects a 33 MiB path before the bounded population copy',()=>{
 const path='x'.repeat(33*1024**2);
 expect(()=>createPublishedArtifactIndex(owner,[section([{path,sha256:'c'.repeat(64),size:0,bytesBase64:''}])],new Set())).toThrow('published_artifact_path');
});
it.each([
 ['hash',{path:'out.txt',sha256:'bad',size:0,bytesBase64:''},'published_artifact_hash'],
 ['size',{path:'out.txt',sha256:'c'.repeat(64),size:-1,bytesBase64:''},'published_artifact_size'],
 ['base64-length',{path:'out.txt',sha256:'c'.repeat(64),size:1,bytesBase64:''},'published_artifact_size'],
] as const)('direct index validates every unselected artifact %s before content decoding',(_mode,artifact,error)=>{
 expect(()=>createPublishedArtifactIndex(owner,[section([artifact])],new Set())).toThrow(error);
});
it('direct index checks every section shape before validating any path',()=>{
 const sections=[
  section([{path:'x'.repeat(5000),sha256:'c'.repeat(64),size:0,bytesBase64:''}]),
  {...section([],'second'),unexpected:true},
 ];
 expect(()=>createPublishedArtifactIndex(owner,sections,new Set())).toThrow('published_artifact_sections');
});
it('direct index preflights later accessors and aliases before an earlier oversized path',()=>{
 let getterCalls=0;
 const first=section([{path:'x'.repeat(5000),sha256:'c'.repeat(64),size:0,bytesBase64:''}]);
 const accessor=section([],'accessor');Object.defineProperty(accessor,'binding',{enumerable:true,get(){getterCalls++;return {};}});
 expect(()=>createPublishedArtifactIndex(owner,[first,accessor],new Set())).toThrow('published_artifact_sections');
 expect(getterCalls).toBe(0);
 const shared={};const left=section([],'left'),right=section([],'right');left.binding=shared;right.binding=shared;
 expect(()=>createPublishedArtifactIndex(owner,[first,left,right],new Set())).toThrow('published_artifact_sections');
});
it('direct index accepts only exact local and inherited section shapes',()=>{
 const artifact={path:'out.txt',sha256:'c'.repeat(64),size:0,bytesBase64:''},local=section([artifact]);
 const origin={...owner,ownerId:'child'},inherited={...section([{...artifact}]),kind:'inherited',originOwner:origin,originalObligationId:'origin'};
 expect(()=>createPublishedArtifactIndex(owner,[local,inherited],new Set())).not.toThrow();
 for(const invalid of [
  {...local,kind:'local'},
  {...local,kind:'unknown'},
  {...local,originOwner:origin},
  {...inherited,originalObligationId:undefined},
  {...local,unexpected:true},
  {...local,obligationId:12},
 ])expect(()=>createPublishedArtifactIndex(owner,[invalid],new Set())).toThrow('published_artifact_sections');
});
it('direct index enforces UTF-8 identifier byte bounds and enumerable artifact fields',()=>{
 const artifact={path:'out.txt',sha256:'c'.repeat(64),size:0,bytesBase64:''};
 expect(()=>createPublishedArtifactIndex(owner,[section([{...artifact}], 'é'.repeat(80))],new Set())).not.toThrow();
 expect(()=>createPublishedArtifactIndex(owner,[section([{...artifact}], 'é'.repeat(81))],new Set())).toThrow('published_artifact_sections');
 const hidden:any={};for(const [key,value] of Object.entries(artifact))Object.defineProperty(hidden,key,{value,enumerable:key!=='path',writable:true,configurable:true});
 expect(()=>createPublishedArtifactIndex(owner,[section([hidden])],new Set())).toThrow('published_artifact_shape');
});
