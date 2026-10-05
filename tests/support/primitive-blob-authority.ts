import {vi} from 'vitest';
import type {Database} from 'better-sqlite3';
import * as root from '../../src/runtime/verification/installed-controller.js';
import * as sharedCapacity from '../../src/runtime/verification/installed-shared-capacity.js';
import * as profileOwnerRegistry from '../../src/runtime/verification/profile-owner-registry.js';
import {readBlobCapacityIssuer} from '../../src/runtime/verification/blob-capacity-issuer.js';
import {buildInputFileArchive} from '../../src/runtime/isolated-execution/input-tar.js';
import {createControllerMaterialPipeline} from '../../src/runtime/verification/material-pipeline.js';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {mkdtempSync} from 'node:fs';import {createHash,randomUUID} from 'node:crypto';import {canonicalVerificationJson as harnessJson} from '../../src/runtime/verification/protocol.js';
import {assertMaterialPipelineDeleted} from '../../src/runtime/verification/material-pipeline.js';
import {assertDockerRunnerDeleted} from '../../src/runtime/isolated-execution/docker-runner.js';
import {assertExecutionTranscriptDeleted} from '../../src/runtime/verification/execution-transcripts.js';
import {assertProtectedRunDeleted} from '../../src/runtime/verification/protected-run-ledger.js';
import {createInstalledSharedCapacity} from '../../src/runtime/verification/installed-shared-capacity.js';
import {createSharedBlobCapacity} from '../../src/runtime/verification/shared-blob-capacity.js';
import {createAuthorityBlobBudget} from '../../src/runtime/verification/authority-blob-budget.js';

/** SQLite algorithm/fault harness ONLY, mirroring capacity-primitive-ledger:
 * the real shared-capacity/blob-budget algorithms run against a synthetic
 * installed authority bound to the caller's own database. This is not an
 * installed OS authority; actual installed positives use the zero-argument
 * installed start separately. */
interface Options {database:Database;authorityId:string;assertCurrent():void;deletion:{assertDeleted(proof:object,proposal:object):unknown}}
interface PrimitiveState {options:Options;layers:Map<string,{phase:'constructing'|'ready';component?:object}>;shared?:object}
const primitives=new WeakMap<object,PrimitiveState>();
let patched=false;
function install(){if(patched)return;patched=true;
 const claim=root.claimInstalledCapacityLayer,read=root.readInstalledCapacityAuthority,readLayer=root.readInstalledCapacityLayer,finish=root.finishInstalledCapacityLayer,finishShared=root.finishInstalledSharedCapacityLayer,fail=root.failInstalledCapacityLayer,deleted=sharedCapacity.assertInstalledCapacityDeleted;
 vi.spyOn(root,'claimInstalledCapacityLayer').mockImplementation((token:object,layer:string)=>{
  const state=primitives.get(token);if(!state)return claim(token,layer as never);
  if(state.layers.has(layer))throw Error('capacity_authority_layer_used');
  // Mirror the production layer order: parent must still be constructing, and
  // authority-budget/blob-budget additionally require a ready shared layer.
  const parent=layer==='ledger'?'shared':layer==='blob-budget'?'authority-budget':layer==='installed-owner'?undefined:'installed-owner';
  if(parent&&state.layers.get(parent)?.phase!=='constructing')throw Error('capacity_authority_layer_order');
  if((layer==='authority-budget'||layer==='blob-budget')&&state.layers.get('shared')?.phase!=='ready')throw Error('capacity_authority_layer_order');
  state.layers.set(layer,{phase:'constructing'});
  state.options.assertCurrent();
  return Object.freeze({database:state.options.database,authorityId:state.options.authorityId});
 });
 vi.spyOn(root,'readInstalledCapacityAuthority').mockImplementation((token:object)=>{
  const state=primitives.get(token);if(!state)return read(token);
  state.options.assertCurrent();
  return Object.freeze({database:state.options.database,authorityId:state.options.authorityId});
 });
 vi.spyOn(root,'readInstalledCapacityLayer').mockImplementation(((token:object,layer:string)=>{
  const state=primitives.get(token);if(!state)return readLayer(token,layer as never);
  const slot=state.layers.get(layer);if(!slot||slot.phase!=='ready'||!slot.component)throw Error('capacity_authority_layer');
  return slot.component;
 }) as never);
 vi.spyOn(root,'finishInstalledCapacityLayer').mockImplementation(((token:object,layer:string,component:object)=>{
  const state=primitives.get(token);if(!state)return finish(token,layer as never,component);
  const slot=state.layers.get(layer);if(!slot||slot.phase!=='constructing')throw Error('capacity_authority_layer');
  slot.component=component;slot.phase='ready';
 }) as never);
 vi.spyOn(root,'finishInstalledSharedCapacityLayer').mockImplementation(((token:object,component:object)=>{
  const state=primitives.get(token);if(!state)return finishShared(token as never,component as never);
  const slot=state.layers.get('installed-owner');if(!slot||slot.phase!=='constructing')throw Error('capacity_authority_layer');
  slot.component=component;slot.phase='ready';
 }) as never);
 vi.spyOn(root,'failInstalledCapacityLayer').mockImplementation(((token:object,layer:string)=>{
  const state=primitives.get(token);if(!state)return fail(token,layer as never);
  const slot=state.layers.get(layer);if(slot&&slot.phase==='constructing')slot.phase='failed';
 }) as never);
 vi.spyOn(sharedCapacity,'assertInstalledCapacityDeleted').mockImplementation(((authority:object,proof:object,proposal:object)=>{
  const state=primitives.get(authority);if(!state)return deleted(authority,proof,proposal as never);
  state.options.assertCurrent();
  // Mirror production issuer routing: real component deletion asserts keyed by census kind.
  const components=issuerComponents.get(authority);
  if(components){
   const mapping=readBlobCapacityIssuer(state.options.database,proposal as never);
   const slot=mapping.issuerKind==='material'?'materials':mapping.issuerKind==='raw'?'execution':mapping.issuerKind==='transcript'?'transcripts':mapping.issuerKind==='run'?'runs':undefined;
   const component=slot?components.get(slot):undefined;
   if(component){
    if(slot==='materials')return assertMaterialPipelineDeleted(component,state.options.database,proof,proposal as never) as void;
    if(slot==='execution')return assertDockerRunnerDeleted(component,state.options.database,proof,proposal as never) as void;
    if(slot==='transcripts')return assertExecutionTranscriptDeleted(component,state.options.database,proof,proposal as never) as void;
    if(slot==='runs')return assertProtectedRunDeleted(component,state.options.database,proof,proposal as never) as void;
   }
  }
  return state.options.deletion.assertDeleted(proof,proposal) as void;
 }) as never);
 const readProfileBinding=profileOwnerRegistry.readProfileCapacityOwnerBinding;
 vi.spyOn(profileOwnerRegistry,'readProfileCapacityOwnerBinding').mockImplementation(((binding:object,database:Database)=>{
  const entry=ownerBindings.get(binding);if(!entry)return readProfileBinding(binding,database);
  if(entry.database!==database)throw Error('profile_capacity_binding');
  entry.assertCurrent();
  return Object.freeze({...entry.facts});
 }) as never);
}
/** Builds a real shared-capacity owner (capacity + authority budget) for harness
 * databases. `authorityId` must be stable across reopens of the same database. */
const ownerTokens=new WeakMap<object,object>();
export function createPrimitiveBlobAuthority(options:Options):ReturnType<typeof createInstalledSharedCapacity>{
 install();
 const token=Object.freeze({});
 primitives.set(token,{options,layers:new Map()});
 const owner=createInstalledSharedCapacity(token);
 ownerTokens.set(owner,token);
 return owner;
}

/** Primitive capacity owner binding: same WeakMap routing the production
 * enrollment-side binding uses, so createMaterialCapacityBinding's read()
 * validates against these facts instead of a real enrollment. */
export interface PrimitiveOwnerBindingFacts {authorityId:string;profileId:string;ownerKey:string;sessionKey:string;invocation:Readonly<object>}
const ownerBindings=new WeakMap<object,{database:Database;facts:PrimitiveOwnerBindingFacts;assertCurrent():void}>();
const issuerComponents=new WeakMap<object,Map<string,object>>();
/** Register the real component objects so release proofs route by census issuer
 * kind exactly like the production installed authority does. */
export function registerPrimitiveIssuer(ownerOrToken:object,slot:'materials'|'execution'|'transcripts'|'runs',component:object){
 const authority=ownerTokens.get(ownerOrToken)??ownerOrToken;
 const state=primitives.get(authority);if(!state)throw Error('primitive_authority_unknown');
 let components=issuerComponents.get(authority);if(!components){components=new Map();issuerComponents.set(authority,components);}
 components.set(slot,component);
}


/** One-call material staging harness for direct-construction tests: real
 * authority + real pipeline + a staged plan factory. Engines and fault
 * injection stay with the caller. */
export interface PrimitiveMaterialHarness {
 owner:ReturnType<typeof createInstalledSharedCapacity>;
 budget:ReturnType<typeof createInstalledSharedCapacity>['budget'];
 pipeline:ReturnType<typeof createControllerMaterialPipeline>;
 peer:{uid:number;gid:number;auditSessionId:number};
 stagingRoot:string;
 stagePlan(invocation:object,command:{argv:string[];cwdRelative:string}):Promise<{plan:any;scopeDigest:string}>;
}
export function createPrimitiveMaterialHarness(input:{database:import('better-sqlite3').Database;authorityId:string;ownerKey?:string;engineBinding:{engineId:string;incarnation:string};deletion?:Options['deletion'];wallNow?:()=>number;assertCleanup?():void;readPageFault?():void}):PrimitiveMaterialHarness{
 const owner=createPrimitiveBlobAuthority({database:input.database,authorityId:input.authorityId,assertCurrent(){},deletion:input.deletion??{assertDeleted(){throw Error('no physical deletion receipt');}}});
 const stagingRoot=mkdtempSync(join(tmpdir(),'primitive-material-'));
 const body=Buffer.from(input.authorityId+' material'),materialHash=createHash('sha256').update(body).digest('hex');
 const peer={uid:501,gid:20,auditSessionId:10},resolveOwnerKey=()=>input.ownerKey??'owner';
 const pipeline=createControllerMaterialPipeline({root:stagingRoot,database:input.database,budget:owner.budget,engineBinding:input.engineBinding,assertCurrent(){},assertCleanup:input.assertCleanup??(()=>{throw Error('still in use');}),resolveOwnerKey,createCapacityOwnerBinding(p:{uid:number},invocationInput:object){return createPrimitiveCapacityOwnerBinding({database:input.database,facts:{authorityId:input.authorityId,profileId:'primitive-profile',ownerKey:resolveOwnerKey(),sessionKey:'primitive-session',invocation:invocationInput as Readonly<object>},assertCurrent(){}});},wallNow:input.wallNow??(()=>1000),broker:{clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:100,upperBound:100,evidenceHash:'a'.repeat(64)}),async inspectMaterial(){return {sha256:materialHash,size:body.length,executable:false};},async authorizeMaterials(commandInput:any){return {uid:commandInput.uid,auditSessionId:commandInput.auditSessionId,reviewHash:createHash('sha256').update(harnessJson(commandInput.review)).digest('hex')};},async readMaterialPage(pageInput:any){input.readPageFault?.();return {contentHash:materialHash,totalBytes:body.length,offset:pageInput.offset,bytes:body.subarray(pageInput.offset,pageInput.offset+pageInput.length).toString('base64'),executable:false};}}});
 async function stagePlan(invocation:object,command:{argv:string[];cwdRelative:string}){const signal=new AbortController().signal;const challenge=await pipeline.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/input',byteLimit:4096}],exactCommand:command,expiresAt:(input.wallNow?.()??1000)+60000},peer,signal);const grant=await pipeline.authorize(challenge.challengeId,peer,signal);const staged=await pipeline.stage({grantHandle:grant,invocation},peer,signal);const material=pipeline.consumeMountPlan(staged.mountPlanHandle,peer);return {plan:material.plan as any,scopeDigest:staged.scopeDigest};}
 return {owner,budget:owner.budget,pipeline,peer,stagingRoot,stagePlan};
}

/** Engine mixin for dispatch flows that materialize staged input files:
 * store bytes on populate, return a real single-file archive on read. */
export function createPrimitiveInputArchiveEngine(){
 const files=new Map<string,{path:string;bytes:Buffer;executable:boolean}>();
 return {files,engine:{async populateInputFile(_id:string,file:{path:string;bytes:Buffer;executable:boolean}){files.set(file.path,{...file,bytes:Buffer.from(file.bytes)});},async readInputArchive(_id:string,path:string){return buildInputFileArchive(files.get(path)!);}}};
}

/** Standalone shared-capacity primitive for capacity-algorithm harness tests:
 * real createSharedBlobCapacity/createAuthorityBlobBudget over a synthetic
 * authority token, without the full installed owner composition. */
export function createPrimitiveSharedCapacityHarness(input:{database:import('better-sqlite3').Database;authorityId:string;assertCurrent?():void;deletion?:Options['deletion']}){
 install();
 const token=Object.freeze({});
 primitives.set(token,{options:{database:input.database,authorityId:input.authorityId,assertCurrent:input.assertCurrent??(()=>{}),deletion:input.deletion??{assertDeleted(){throw Error('no physical deletion receipt');}}},layers:new Map([['installed-owner',{phase:'constructing'}]])});
 const shared=createSharedBlobCapacity(token);
 let budget:ReturnType<typeof createAuthorityBlobBudget>|undefined;
 try{budget=createAuthorityBlobBudget(token);}catch(error){shared.close();throw error;}
 return {token,shared,budget:budget!};
}

export function createPrimitiveCapacityOwnerBinding(input:{database:Database;facts:PrimitiveOwnerBindingFacts;assertCurrent():void}):object{
 install();
 const token=Object.freeze({});
 ownerBindings.set(token,{database:input.database,facts:input.facts,assertCurrent:input.assertCurrent});
 return token;
}
