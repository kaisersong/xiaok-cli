import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ReferenceDeletionReceiptStore} from '../../../src/runtime/sol-pi/reference-lifecycle.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const ref={authorityId:'11111111-1111-4111-8111-111111111111',profileId:'profile',sourceSessionId:'session',ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,observationId:'obs',contentHash:'a'.repeat(64),revision:1,policyId:'policy',policyRevision:1};
const facts={...ref,referenceId:'session:session'};
describe('host deletion receipts',()=>{
 it('requires completed durable deletion and exact closure identity across restart',()=>{
  const root=mkdtempSync(join(tmpdir(),'solpi-lifecycle-'));roots.push(root);let store=new ReferenceDeletionReceiptStore(root);
  const id=store.begin({ownerId:'session:session',operationId:'delete-1',references:[ref],deletedAt:123});
  expect(store.resolve(facts).state).toBe('unknown');store.complete(id);store.close();store=new ReferenceDeletionReceiptStore(root);
  expect(store.resolve(facts)).toMatchObject({state:'deleted',deletionReceiptId:id,deletedAt:123});
  for(const altered of [{profileId:'other'},{authorityId:'22222222-2222-4222-8222-222222222222'},{contentHash:'b'.repeat(64)},{revision:2},{referenceId:'session:other'}])expect(store.resolve({...facts,...altered}).state).toBe('unknown');
  store.close();
 });
 it('does not unpin the source when a derived fork containing the same reference is deleted',()=>{const root=mkdtempSync(join(tmpdir(),'solpi-lifecycle-'));roots.push(root);const store=new ReferenceDeletionReceiptStore(root);const id=store.begin({ownerId:'session:fork',operationId:'delete-fork',references:[ref],deletedAt:123});store.complete(id);expect(store.resolve(facts).state).toBe('unknown');store.close();});
 it('cannot overwrite an operation or complete an unknown receipt',()=>{
  const root=mkdtempSync(join(tmpdir(),'solpi-lifecycle-'));roots.push(root);const store=new ReferenceDeletionReceiptStore(root);
  const input={ownerId:'session:session',operationId:'delete-1',references:[ref],deletedAt:123};const id=store.begin(input);expect(store.begin(input)).toBe(id);
  expect(()=>store.begin({...input,references:[{...ref,revision:2}]})).toThrow();expect(()=>store.complete('unknown')).toThrow();store.close();
 });
});

import {createObservationService} from '../../../src/runtime/sol-pi/observation-service.js';
import {existsSync,readFileSync} from 'node:fs';
it('service privately reconciles only completed exact refs, preserves unknown pins and rejects async evidence',()=>{
 const root=mkdtempSync(join(tmpdir(),'solpi-lifecycle-service-'));roots.push(root);let now=1000;let result:any={state:'unknown'};
 const options={profileRoot:root,profileId:'profile',now:()=>now,redactor:{version:'v1',redact:(s:string)=>s},resolveReferenceOwner:()=>result};
 let service=createObservationService(options);const claims={sessionId:'session',ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,requestSource:'agent' as const,surface:'ordinary-owner' as const};const agent=service.bindCaller(claims),user=service.bindCaller({...claims,requestSource:'user'});
 service.setArchivePolicy({caller:user,requestSource:'user',policy:{version:1,id:'p',revision:1,scopeId:'scope',sourceAdapterId:'s',sourceDescriptors:['d'],expiresAt:10000,localPersistence:true,allowUnclassifiedText:true,allowIncomplete:false,destinations:[]}});
 const capture=service.begin({caller:agent,requestSource:'agent',invocationId:'i',toolName:'bash',sourceAdapterId:'s',sourceDescriptor:'d'});service.append({caller:agent,requestSource:'agent',capture,text:'archived'});const archived=service.finalize({caller:agent,requestSource:'agent',capture,executionState:'terminal',outcome:'success'});
 service.pin({caller:agent,requestSource:'agent',id:archived.id,referenceId:'session:session'});service.endSession({caller:user,requestSource:'user'});service.dispose();now=8*86400000;
 result=Promise.resolve({state:'deleted',deletionReceiptId:'fake',deletedAt:1000});service=createObservationService(options);expect(existsSync(join(root,'observations',`${archived.id}.body`))).toBe(true);service.dispose();
 result={state:'deleted',deletionReceiptId:'real-host-receipt',deletedAt:1000};service=createObservationService(options);expect(existsSync(join(root,'observations',`${archived.id}.body`))).toBe(false);
 const record=JSON.parse(readFileSync(join(root,'observations',`${archived.id}.json`),'utf8'));expect(record.referenceReconciliation).toMatchObject({actorKind:'system_reconcile',deletionReceiptId:'real-host-receipt'});expect(record.referenceReconciliation.requestSource).toBeUndefined();service.dispose();
});

import {writeFileSync} from 'node:fs';
it('dirty recovery starts the storage retention clock once without forging terminal facts or removing pins',()=>{
 const root=mkdtempSync(join(tmpdir(),'solpi-dirty-retention-'));roots.push(root);let now=1000;const options={profileRoot:root,profileId:'profile',now:()=>now,redactor:{version:'v1',redact:(s:string)=>s}};
 let service=createObservationService(options);const claims={sessionId:'session',ownerAgentId:'owner',scopeId:'scope',permissionGeneration:1,requestSource:'agent' as const,surface:'ordinary-owner' as const};const agent=service.bindCaller(claims),user=service.bindCaller({...claims,requestSource:'user'});
 service.setArchivePolicy({caller:user,requestSource:'user',policy:{version:1,id:'p',revision:1,scopeId:'scope',sourceAdapterId:'s',sourceDescriptors:['d'],expiresAt:10000,localPersistence:true,allowUnclassifiedText:true,allowIncomplete:false,destinations:[]}});
 const capture=(invocationId:string)=>{const handle=service.begin({caller:agent,requestSource:'agent',invocationId,toolName:'bash',sourceAdapterId:'s',sourceDescriptor:'d'});service.append({caller:agent,requestSource:'agent',capture:handle,text:'archived'});return service.finalize({caller:agent,requestSource:'agent',capture:handle,executionState:'terminal',outcome:'error'});};
 const unpinned=capture('a'),pinned=capture('b');service.pin({caller:agent,requestSource:'agent',id:pinned.id,referenceId:'session:session'});service.dispose();
 const authority=join(root,'observations','authority.json');const dirty=()=>{const state=JSON.parse(readFileSync(authority,'utf8'));state.cleanShutdown=false;writeFileSync(authority,JSON.stringify(state));};dirty();now=2000;service=createObservationService(options);service.dispose();
 const index=(id:string)=>JSON.parse(readFileSync(join(root,'observations',id+'.json'),'utf8'));
 expect(index(unpinned.id)).toMatchObject({endedAt:2000,recoveryUncertain:true,ref:{executionState:'terminal',outcome:'error',complete:true}});expect(index(pinned.id).pins).toEqual(['session:session']);
 dirty();now=3000;service=createObservationService(options);service.dispose();expect(index(unpinned.id).endedAt).toBe(2000);
 now=2001+7*86400000;service=createObservationService(options);expect(existsSync(join(root,'observations',unpinned.id+'.body'))).toBe(false);expect(existsSync(join(root,'observations',pinned.id+'.body'))).toBe(true);service.dispose();
});

import Database from 'better-sqlite3';
it('rejects oversized pages and unknown WAL without retaining a database owner',()=>{
 const root=mkdtempSync(join(tmpdir(),'solpi-receipt-quota-'));roots.push(root);const file=join(root,'reference-deletions.sqlite');const db=new Database(file);db.exec('CREATE TABLE padding(content BLOB)');db.prepare('INSERT INTO padding(content) VALUES(zeroblob(?))').run(16*1024*1024+128*1024);db.close();
 expect(()=>new ReferenceDeletionReceiptStore(root)).toThrow(/quota/);const other=new Database(file);other.exec('BEGIN EXCLUSIVE');other.exec('ROLLBACK');other.close();
 rmSync(file);writeFileSync(file+'-wal','unknown');expect(()=>new ReferenceDeletionReceiptStore(root)).toThrow(/journal/);
});
it('caps repeated durable receipts and keeps earlier committed proof readable after SQLITE_FULL',()=>{
 const root=mkdtempSync(join(tmpdir(),'solpi-receipt-full-'));roots.push(root);const store=new ReferenceDeletionReceiptStore(root);const first=store.begin({ownerId:'session:session',operationId:'first',references:[ref],deletedAt:1});store.complete(first);
 const references=Array.from({length:4096},(_,i)=>({...ref,observationId:`obs-${i}`}));let failure:unknown;
 for(let i=0;i<32;i++){try{store.begin({ownerId:'session:session',operationId:`fill-${i}`,references,deletedAt:1});}catch(error){failure=error;break;}}
 expect(String(failure)).toMatch(/full/);expect(store.resolve(facts).state).toBe('deleted');store.close();
},20000);
