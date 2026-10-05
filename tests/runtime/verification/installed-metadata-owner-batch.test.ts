import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as metadata from '../../../src/runtime/verification/installed-metadata-source.js';
import * as census from '../../../src/runtime/verification/native-sqlite-census.js';
import * as shared from '../../../src/runtime/verification/shared-blob-capacity.js';
import * as installedShared from '../../../src/runtime/verification/installed-shared-capacity.js';
import * as controller from '../../../src/runtime/verification/installed-controller.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const batch=(...args:unknown[]):any=>Reflect.apply(Reflect.get(metadata,'readInstalledMetadataOwners'),undefined,args);
const sharedBatch=(...args:unknown[]):any=>Reflect.apply(Reflect.get(shared,'readSharedCapacityOwners'),undefined,args);
async function fixture(onCurrent?:()=>void){
 const issued=vi.spyOn(installedShared,'createInstalledSharedCapacity');
 try{const f=await installedControllerFixture({onCurrent}),authority=issued.mock.calls.at(-1)![0],capacity=issued.mock.results.at(-1)!.value.capacity;
 const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'r.txt',sha256:'a'.repeat(64),structure:'utf8' as const}]},registration={migrationEpoch:1,obligations:[{obligation:{obligationId:'o',predicateId:'p',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:createHash('sha256').update(json(recipe)).digest('hex'),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner' as const}},enrollment={ownerKind:'task' as const,ownerId:'batch-owner',invocations:Array.from({length:20},(_,n)=>({sessionIdentity:'batch-session-'+n,compoundOperationId:'op',validationInvocationId:'v'}))};
 const challenge=f.composition.privateHost.enrollment.prepare({enrollment,registration},f.peer);await f.composition.privateHost.enrollment.authorize(challenge.challengeId,f.peer,new AbortController().signal);
 f.database.exec('ALTER TABLE main.verification_registered_invocations ADD COLUMN batch_original;UPDATE main.verification_registered_invocations SET batch_original=9007199254740992');
 const source=metadata.createInstalledControllerMetadataSource(f.lifetime),facts=metadata.readInstalledMetadataSource(source,f.database,'authority'),handles=[facts.owner,...facts.beneficiaries];return {...f,source,facts,handles,authority,capacity};
 }finally{issued.mockRestore();}
}
it('fresh owner batch matches original scalar identities, preserves order/duplicates and reads one complete census per Source plus the callback-free closing census',async()=>{
 const f=await fixture();try{const input=[f.handles[2]!,f.handles[0]!,f.handles[2]!,...f.handles],expected=input.map(h=>metadata.readInstalledMetadataOwner(h,f.database,'authority')),reads=vi.spyOn(census,'readNativeEnrollmentCensus');expect(batch(input,f.database,'authority')).toEqual(expected);expect(reads).toHaveBeenCalledTimes(2);expect(Object.isFrozen(batch(input,f.database,'authority'))).toBe(true);expect(reads).toHaveBeenCalledTimes(4);}finally{vi.restoreAllMocks();await f.close();}
});
it('fresh owner batch groups actual Source identities separately and rejects foreign, copied and wrongly scoped handles',async()=>{
 const f=await fixture(),other=await fixture();try{const second=metadata.createInstalledControllerMetadataSource(f.lifetime),issued=metadata.readInstalledMetadataSource(second,f.database,'authority'),reads=vi.spyOn(census,'readNativeEnrollmentCensus');expect(batch([f.handles[0],issued.owner,f.handles[1]],f.database,'authority')).toHaveLength(3);expect(reads).toHaveBeenCalledTimes(3);for(const input of [[{}],[{...f.handles[0]}],[other.handles[0]]])expect(()=>batch(input,f.database,'authority')).toThrow();expect(()=>batch(f.handles,other.database,'authority')).toThrow();expect(()=>batch(f.handles,f.database,'foreign')).toThrow();expect(()=>batch(f.handles,f.database,'authority','extra')).toThrow();}finally{vi.restoreAllMocks();await other.close();await f.close();}
});
it.each(['int64','blob'] as const)('fresh owner batch notices every original %s scalar on each new call and invalidates old issued handles',async mode=>{
 const f=await fixture();try{expect(batch(f.handles,f.database,'authority')).toHaveLength(21);f.database.exec(mode==='int64'?'UPDATE main.verification_registered_invocations SET batch_original=9007199254740993':"UPDATE main.verification_registered_invocations SET batch_original=X'0001FF'");expect(()=>batch(f.handles,f.database,'authority')).toThrow('metadata_owner_census_changed');const fresh=metadata.readInstalledMetadataSource(f.source,f.database,'authority');expect(fresh.beneficiaryCensusHash).not.toBe(f.facts.beneficiaryCensusHash);expect(batch([fresh.owner,...fresh.beneficiaries],f.database,'authority')).toHaveLength(21);}finally{await f.close();}
});
it('fresh owner batch rejects hostile array containers without executing caller code',async()=>{
 const f=await fixture();try{expect(typeof Reflect.get(metadata,'readInstalledMetadataOwners')).toBe('function');let calls=0;const fault=()=>{calls++;throw Error('caller code');},accessor=[f.handles[0]];Object.defineProperty(accessor,'0',{get:fault,enumerable:true});const proxy=new Proxy(f.handles,{get:fault,ownKeys:fault,getPrototypeOf:fault}),extra=[f.handles[0]];Object.defineProperty(extra,Symbol.iterator,{get:fault});for(const input of [[],accessor,proxy,extra,new Array(1),Object.assign([f.handles[0]],{fake:true})])expect(()=>batch(input,f.database,'authority')).toThrow();expect(calls).toBe(0);}finally{await f.close();}
});
it('shared fresh owner batch validates actual authority and every native binding before returning identities',async()=>{
 const f=await fixture();try{const expected=f.handles.map(h=>shared.readSharedCapacityOwner(f.authority,h)),reads=vi.spyOn(census,'readNativeEnrollmentCensus');expect(sharedBatch(f.authority,f.handles)).toEqual(expected);expect(reads).toHaveBeenCalledTimes(2);expect(()=>sharedBatch({},f.handles)).toThrow();expect(()=>sharedBatch(f.authority,[{}])).toThrow();expect(()=>sharedBatch(f.authority,f.handles,'extra')).toThrow();}finally{vi.restoreAllMocks();await f.close();}
});
it('shared fresh owner batch rereads full native source after a second actual authority-current callback mutates it',async()=>{
 const f=await fixture();try{expect(typeof Reflect.get(shared,'readSharedCapacityOwners')).toBe('function');const actual=controller.readInstalledCapacityAuthority;let checks=0;vi.spyOn(controller,'readInstalledCapacityAuthority').mockImplementation(authority=>{const result=actual(authority);if(++checks===2)f.database.exec('UPDATE main.verification_registered_invocations SET batch_original=9007199254740993');return result;});expect(()=>sharedBatch(f.authority,[f.handles[0],f.handles[1]])).toThrow('metadata_owner_census_changed');expect(checks).toBeGreaterThanOrEqual(2);}finally{vi.restoreAllMocks();await f.close();}
});
it('fresh native and shared batches reject handles after the actual installed controller closes',async()=>{
 const f=await fixture();await f.close();expect(()=>batch(f.handles,f.database,'authority')).toThrow();expect(()=>sharedBatch(f.authority,f.handles)).toThrow();
});
it('original metadata rejects virtual profiles before semantic reads or registered row callbacks',async()=>{
 const f=await fixture();try{const rows=f.database.prepare('SELECT uid,account_id,profile_id,state FROM main.verification_profiles').all() as Array<{uid:number;account_id:string;profile_id:string;state:string}>;let calls=0;f.database.table('profiles_probe',()=>({columns:['uid','account_id','profile_id','state'],rows:function*(){calls++;for(const row of rows)yield [row.uid,row.account_id,row.profile_id,row.state];}}));f.database.exec('DROP TABLE main.verification_profiles;CREATE VIRTUAL TABLE main.verification_profiles USING profiles_probe');let error:unknown;try{metadata.readInstalledMetadataSessions(f.source,f.database,'authority');}catch(e){error=e;}expect(calls).toBe(0);expect((error as Error)?.message).toBe('native_sqlite_census_schema');}finally{await f.close();}
});
it('actual metadata ledger attribution checkpoint rejects trigger changes and atomically rolls back original rows',async()=>{
 const f=await fixture();try{f.database.exec('CREATE TRIGGER batch_source_attack BEFORE INSERT ON shared_capacity_session_attributions BEGIN UPDATE verification_registered_invocations SET batch_original=9007199254740993; END');expect(()=>f.capacity.prepareControllerMetadata(f.source,{requestId:'batch-trigger',resourceId:f.facts.resourceId,expectedRevision:0,minimumPageCount:f.facts.pageCount})).toThrow('metadata_owner_census_changed');for(const table of ['shared_capacity_reservations','shared_capacity_session_attributions','controller_metadata_resources','controller_metadata_intents'])expect(f.database.prepare(`SELECT count(*) n FROM main.${table}`).get()).toEqual({n:0});expect(f.database.prepare('SELECT DISTINCT CAST(batch_original AS TEXT) value FROM main.verification_registered_invocations').all()).toEqual([{value:'9007199254740992'}]);}finally{await f.close();}
});
it('fresh owner batch cannot accept two issued census epochs by mutating between actual Source groups',async()=>{
 let attack:(()=>void)|undefined;const f=await fixture(()=>attack?.());try{f.database.exec('UPDATE main.verification_registered_invocations SET batch_original=9007199254740993');const second=metadata.createInstalledControllerMetadataSource(f.lifetime),newer=metadata.readInstalledMetadataSource(second,f.database,'authority');f.database.exec('UPDATE main.verification_registered_invocations SET batch_original=9007199254740992');let calls=0;attack=()=>{if(++calls===3){attack=undefined;f.database.exec('UPDATE main.verification_registered_invocations SET batch_original=9007199254740993');}};expect(()=>batch([f.handles[0],newer.owner],f.database,'authority')).toThrow('metadata_owner_census_changed');expect(calls).toBe(3);}finally{attack=undefined;await f.close();}
});
it('fresh owner batch rejects a final original lifetime callback mutating the already inventoried Source',async()=>{
 let attack:(()=>void)|undefined;const f=await fixture(()=>attack?.());try{let calls=0;attack=()=>{if(++calls===2){attack=undefined;f.database.exec('UPDATE main.verification_registered_invocations SET batch_original=9007199254740993');}};expect(()=>batch(f.handles,f.database,'authority')).toThrow('metadata_owner_census_changed');expect(calls).toBe(2);}finally{attack=undefined;await f.close();}
});
it.each(['mixed-epochs','same-temporary-epoch'] as const)('fresh owner batch rejects rolled-back DDL across actual Source callbacks: %s',async mode=>{
 let attack:(()=>void)|undefined;const f=await fixture(()=>attack?.());try{
 const ddl='ALTER TABLE main.verification_registered_invocations ADD COLUMN rollback_census TEXT';f.database.exec('SAVEPOINT issue_ddl;'+ddl);const a=metadata.createInstalledControllerMetadataSource(f.lifetime),b=metadata.createInstalledControllerMetadataSource(f.lifetime),issuedA=metadata.readInstalledMetadataSource(a,f.database,'authority'),issuedB=metadata.readInstalledMetadataSource(b,f.database,'authority');f.database.exec('ROLLBACK TO issue_ddl;RELEASE issue_ddl');let calls=0;
 attack=()=>{calls++;if(mode==='same-temporary-epoch'?calls===1||calls===3:calls===3)f.database.exec('SAVEPOINT callback_ddl;'+ddl);if(mode==='same-temporary-epoch'?calls===2||calls===4:calls===4){f.database.exec('ROLLBACK TO callback_ddl;RELEASE callback_ddl');if(calls===4)attack=undefined;}};
 expect(()=>batch([mode==='mixed-epochs'?f.handles[0]:issuedA.owner,issuedB.owner],f.database,'authority')).toThrow('metadata_owner_census_changed');expect(calls).toBe(4);expect(f.database.prepare('PRAGMA main.table_info(verification_registered_invocations)').all().some((column:any)=>column.name==='rollback_census')).toBe(false);
 }finally{attack=undefined;await f.close();}
});
