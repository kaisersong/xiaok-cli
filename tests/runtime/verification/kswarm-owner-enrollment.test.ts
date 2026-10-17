import {expect,it,vi} from 'vitest';
import {readKSwarmEnrollmentSnapshot} from '../../../src/runtime/verification/kswarm-enrollment-store.js';
import {readProfileCapacityOwnerBinding} from '../../../src/runtime/verification/profile-owner-registry.js';
it.each(['eponymous','upper-eponymous','upper-virtual','generated'] as const)('rejects %s producer profiles before actual pre-identity row/function callbacks',async mode=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const input=proposal();input.enrollment.invocations.push(invocation);await enroll(f,input);const rows=f.database.prepare('SELECT uid,account_id,profile_id,state FROM main.verification_profiles').all() as Array<{uid:number;account_id:string;profile_id:string;state:string}>;let calls=0;
 if(mode==='generated'){f.database.function('identity_computed',{deterministic:true},()=>{calls++;return 501;});f.database.exec('DROP TABLE main.verification_profiles;CREATE TABLE main.verification_profiles(seed INTEGER,uid INTEGER GENERATED ALWAYS AS (identity_computed()) VIRTUAL,account_id TEXT,profile_id TEXT,state TEXT)');for(const row of rows)f.database.prepare('INSERT INTO main.verification_profiles(seed,account_id,profile_id,state) VALUES(?,?,?,?)').run(1,row.account_id,row.profile_id,row.state);calls=0;}
 else{f.database.exec('DROP TABLE main.verification_profiles');const definition={columns:['uid','account_id','profile_id','state'],rows:function*(){calls++;for(const row of rows)yield [row.uid,row.account_id,row.profile_id,row.state];}};if(mode==='upper-virtual'){f.database.table('uppercase_profiles',()=>definition);f.database.exec('CREATE VIRTUAL TABLE main.VERIFICATION_PROFILES USING uppercase_profiles');}else f.database.table(mode==='eponymous'?'verification_profiles':'VERIFICATION_PROFILES',definition);}
 const host=f.composition.privateHost.enrollment;for(const work of [()=>host.resolveOwnerKey(f.peer,invocation),()=>host.createCapacityOwnerBinding(f.peer,invocation)]){let error:unknown;try{work();}catch(e){error=e;}expect(calls).toBe(0);expect(error).toBeInstanceOf(Error);}
 }finally{await f.close();}
});
it('rejects virtual KSwarm producer receipts at snapshot and pre-identity readers before row callbacks',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const input=proposal();input.enrollment.invocations.push(invocation);const result=await enroll(f,input),original=f.database.prepare('SELECT * FROM main.owner_enrollment_kswarm_subjects').get() as Record<string,any>,columns=Object.keys(original);let calls=0;f.database.table('receipt_probe',()=>({columns,rows:function*(){calls++;yield columns.map(column=>original[column]);}}));f.database.exec('DROP TABLE main.owner_enrollment_kswarm_subjects;CREATE VIRTUAL TABLE main.owner_enrollment_kswarm_subjects USING receipt_probe');const host=f.composition.privateHost.enrollment;
 for(const work of [()=>readKSwarmEnrollmentSnapshot(f.database,result.owner),()=>host.resolveOwnerKey(f.peer,invocation),()=>host.createCapacityOwnerBinding(f.peer,invocation),()=>host.openOwner(mapped(),f.peer),()=>f.composition.public.invoke('completion.inspect',result,f.peer)]){let error:unknown;try{work();}catch(e){error=e;}expect(calls).toBe(0);expect(error).toBeInstanceOf(Error);}
 }finally{await f.close();}
});
import {createHash,generateKeyPairSync} from 'node:crypto';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import {parseInstalledDeploymentManifest} from '../../../src/runtime/verification/deployment-manifest.js';
import * as subjects from '../../../src/runtime/verification/kswarm-host-subject.js';
import {completionConsumerOwner} from '../../../src/runtime/verification/completion-consumer-owner.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import {createOwnerEnrollmentClient} from '../../../src/runtime/verification/completion-client.js';
const H='a'.repeat(64),subject={version:1 as const,projectId:'original-project',taskId:'original-task'},signal=new AbortController().signal;
const mapped=(value=subject)=>(subjects as any).kswarmHostSubjectOwner(value);
function proposal(value=subject){const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result.txt',sha256:H,structure:'utf8' as const}]};return {enrollment:{...mapped(value),kswarmSubject:{...value},invocations:[] as Array<{sessionIdentity:string;compoundOperationId:string;validationInvocationId:string}>},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:createHash('sha256').update(json(recipe)).digest('hex'),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner' as const}}};}
const invocation={sessionIdentity:'real-session',compoundOperationId:'real-compound',validationInvocationId:'real-validation'};
async function enroll(f:Awaited<ReturnType<typeof installedControllerFixture>>,input=proposal()){const p=f.composition.privateHost.enrollment.prepare(input,f.peer);return f.composition.privateHost.enrollment.authorize(p.challengeId,f.peer,signal);}
it('separates full KSwarm subjects from ordinary task/project and refuses generic consumer mapping',()=>{
 const original=mapped(),other=mapped({...subject,projectId:'other'}),project=mapped({...subject,taskId:null} as any);
 expect(original.ownerKind).toBe('kswarm');expect(original.ownerId).toMatch(/^kswarm-subject-v1:[a-f0-9]{64}$/);expect(new Set([original,other,project].map(json)).size).toBe(3);
 for(const ownerKind of ['task','project'] as const)expect(completionConsumerOwner({ownerKind,ownerId:original.ownerId})).not.toEqual(original);
 expect(()=>completionConsumerOwner(original)).toThrow();
});
it('accepts exact modern v3 manifest while retaining ordinary v2 and rejecting ambiguous schemas',()=>{
 const keys=generateKeyPairSync('ed25519'),old={version:2,authorityId:'authority',publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),packageHash:H,serviceUid:502,allowedUserIds:[501]};
 expect(parseInstalledDeploymentManifest(old).version).toBe(2);expect(parseInstalledDeploymentManifest({...old,version:3,completionOwnerSchema:2})).toMatchObject({version:3,completionOwnerSchema:2});
 for(const raw of [{...old,completionOwnerSchema:2},{...old,version:3},{...old,version:3,completionOwnerSchema:1},{...old,version:3,completionOwnerSchema:3}])expect(()=>parseInstalledDeploymentManifest(raw)).toThrow();
});
it('blocks KSwarm on actual v2 installed start before any business enrollment row',async()=>{
 const f=await installedControllerFixture();try{const input=proposal();expect(()=>f.composition.privateHost.enrollment.prepare(input,f.peer)).toThrow(/kswarm.*(capability|schema)/);
 for(const table of ['owner_enrollment_challenges','owner_enrollment_requests','owner_enrollment_intents','verification_profiles','verification_registered_owners'])expect(f.database.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
 }finally{await f.close();}
});
it('enrolls and reads actual v3 installed KSwarm subject plus original rules without publishing completion',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const input=proposal(),result=await enroll(f,input),host=f.composition.privateHost.enrollment;
 expect(result.owner).toEqual({...mapped(),profileId:expect.any(String)});expect(f.database.prepare('SELECT subject_json,committed FROM owner_enrollment_kswarm_subjects').get()).toEqual({subject_json:json(subject),committed:1});
 expect(host.openOwner(mapped(),f.peer).owner).toEqual(result.owner);expect(host.readApprovedRecipe(result.owner,'original')).toEqual(input.registration.obligations[0].recipe);
 expect((host as any).readKSwarmApplicationRegistration(result.owner,f.peer,subject)).toMatchObject({owner:result.owner,subject,registrationHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect((f.composition.public.invoke('completion.inspect',result,f.peer) as any).currentVerification).toBe('needs_revalidation');
 expect(f.database.prepare('SELECT feature,minimum_schema FROM verification_storage_features').all()).toEqual([{feature:'kswarm-owner',minimum_schema:2}]);
 const next=proposal();next.enrollment.invocations.push(invocation);await enroll(f,next);expect(host.resolveOwnerKey(f.peer,invocation)).toBe(json(result.owner));
 }finally{await f.close();}
});
it('denies copied or missing subject data at normal client and all exposed receipt readers',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const input=proposal(),result=await enroll(f,input),next=proposal();next.enrollment.invocations.push(invocation);await enroll(f,next);
 const host=f.composition.privateHost.enrollment;f.database.exec('DELETE FROM owner_enrollment_kswarm_subjects');
 for(const work of [()=>host.openOwner(mapped(),f.peer),()=>host.resolveOwnerKey(f.peer,invocation),()=>host.readApprovedRecipe(result.owner,'original'),()=>(host as any).readKSwarmApplicationRegistration(result.owner,f.peer,subject)])expect(work).toThrow(/kswarm/);
 let calls=0;const client=createOwnerEnrollmentClient({call:async()=>{calls++;throw Error('unexpected wire');}} as any),bad=proposal();Object.defineProperty(bad.enrollment.kswarmSubject,'projectId',{get(){calls++;return 'fake';},enumerable:true});
 await expect(client.prepare(bad)).rejects.toThrow();expect(calls).toBe(0);
 }finally{await f.close();}
});
it('retains pending original subject after a registration failure and requires a new native enrollment to recover',async()=>{
 let fault:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onClock(){fault?.();}});try{
 fault=()=>{if(f.database.prepare('SELECT 1 FROM verification_profiles').get()){fault=undefined;throw Error('ks_registration_failure');}};
 await expect(enroll(f)).rejects.toThrow('ks_registration_failure');expect(f.database.prepare('SELECT committed,subject_json FROM owner_enrollment_kswarm_subjects').get()).toEqual({committed:0,subject_json:json(subject)});
 expect(()=>f.composition.privateHost.enrollment.openOwner(mapped(),f.peer)).toThrow();const result=await enroll(f);expect(f.composition.privateHost.enrollment.openOwner(mapped(),f.peer).owner).toEqual(result.owner);
 }finally{fault=undefined;await f.close();}
});
it('preserves old committed rules after failed append and recovers only the exact native-approved extension',async()=>{
 let fault:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onCurrent(){fault?.();}});try{const original=proposal();original.enrollment.invocations.push(invocation);const result=await enroll(f,original),next=proposal();next.enrollment.invocations.push({...invocation,validationInvocationId:'next'});const extra=structuredClone(next.registration.obligations[0]);extra.obligation.obligationId='extra';next.registration.obligations.push(extra);
 fault=()=>{if(!f.database.inTransaction&&f.database.prepare("SELECT 1 FROM verification_registered_invocations WHERE state='pending'").get()){fault=undefined;throw Error('append_failed');}};await expect(enroll(f,next)).rejects.toThrow('append_failed');
 expect(f.database.prepare("SELECT count(*) n FROM verification_registered_invocations WHERE state='pending'").get()).toEqual({n:1});
 expect(f.composition.privateHost.enrollment.openOwner(mapped(),f.peer).owner).toEqual(result.owner);expect(f.composition.privateHost.enrollment.resolveOwnerKey(f.peer,invocation)).toBe(json(result.owner));expect(()=>f.composition.privateHost.enrollment.resolveOwnerKey(f.peer,next.enrollment.invocations[0])).toThrow();
 expect(f.database.prepare('SELECT registration_json,committed FROM owner_enrollment_kswarm_subjects').get()).toEqual({registration_json:json(original.registration),committed:1});await enroll(f,next);expect(f.composition.privateHost.enrollment.readApprovedRecipe(result.owner,'extra')).toEqual(extra.recipe);
 }finally{fault=undefined;await f.close();}
});
it.each(['omit','replace'] as const)('rejects an unknown receipt %s trigger before any KSwarm business enrollment',async mode=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{
 f.database.exec(mode==='omit'?"CREATE TRIGGER ks_fault BEFORE UPDATE ON owner_enrollment_kswarm_subjects BEGIN SELECT RAISE(IGNORE); END":"CREATE TRIGGER ks_fault AFTER UPDATE ON owner_enrollment_kswarm_subjects BEGIN UPDATE owner_enrollment_kswarm_subjects SET subject_json='{}'; END");
 await expect(enroll(f)).rejects.toThrow(/kswarm/);expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_kswarm_subjects').get()).toEqual({n:0});expect(f.database.prepare('SELECT count(*) n FROM mandatory_observation_checks').get()).toEqual({n:0});
 }finally{await f.close();}
});
it('keeps ordinary task/project with exactly matching ID isolated through real enrollment and reads',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{
 const ks=await enroll(f);for(const ownerKind of ['task','project'] as const){const input=proposal();const ordinary={...input,enrollment:{ownerKind,ownerId:mapped().ownerId,invocations:[{...invocation,validationInvocationId:ownerKind}]}};const prepared=f.composition.privateHost.enrollment.prepare(ordinary,f.peer),result=await f.composition.privateHost.enrollment.authorize(prepared.challengeId,f.peer,signal);expect(result.owner).not.toEqual(ks.owner);expect(f.composition.privateHost.enrollment.openOwner({ownerKind,ownerId:mapped().ownerId},f.peer).owner).toEqual(result.owner);}
 expect(f.database.prepare('SELECT count(*) n FROM verification_registered_owners').get()).toEqual({n:3});
 }finally{await f.close();}
});
it('rejects all KSwarm business mutation methods and private subject admission before any attempt',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const {owner}=await enroll(f),host=f.composition.privateHost.authorityHost;
 for(const method of ['requestVerification','prepareSettlement','authorizePublication','invalidate','registerOwnerDependency'])expect(()=>host.issueAuthorization({owner,method,payload:{owner},requestSource:'user',principalId:'user',expiresAt:10000})).toThrow('kswarm_business_not_enabled');
 for(const method of ['registerSubject','admitCurrentSubject','refreshOriginalSubject','registerScopeGuard','beginApplicationTransition'] as const)expect(()=>(host[method] as any)({owner})).toThrow('kswarm_business_not_enabled');
 expect(()=>host.finishApplicationTransition(owner,'transition',()=>{})).toThrow('kswarm_business_not_enabled');expect(f.database.prepare('SELECT count(*) n FROM obligation_attempts').get()).toEqual({n:0});expect(f.database.prepare('SELECT count(*) n FROM verification_subjects').get()).toEqual({n:0});
 }finally{await f.close();}
});
it('captures nested input before original transaction and never executes getters, proxies or toJSON',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{let calls=0;const fault=()=>{calls++;if(f.database.inTransaction)f.database.exec('COMMIT');throw Error('user function');};
 const a=proposal();Object.defineProperty(a.registration.obligations,'0',{get:fault,enumerable:true});const b=proposal();(b.registration as any).toJSON=fault;const c=proposal();c.enrollment.kswarmSubject=new Proxy(c.enrollment.kswarmSubject,{ownKeys:fault,getPrototypeOf:fault}) as any;
 const d=proposal();Object.defineProperty(d.enrollment,'kswarmSubject',{get:fault,enumerable:true});for(const input of [a,b,c,d])expect(()=>f.composition.privateHost.enrollment.prepare(input,f.peer)).toThrow(/kswarm/);
 expect(calls).toBe(0);expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:0});
 }finally{await f.close();}
});
it('rejects a receipt changed by the actual qualified clock after a previously valid read grant',async()=>{
 let attack:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onClock(){attack?.();}});try{const result=await enroll(f);attack=()=>{attack=undefined;f.database.exec("UPDATE owner_enrollment_kswarm_subjects SET subject_json='{}'");};
 expect(()=>f.composition.public.invoke('completion.inspect',result,f.peer)).toThrow(/kswarm/);
 }finally{attack=undefined;await f.close();}
});
it('reopens the actual installed controller and reads the same committed subject without fresh approval',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2}),result=await enroll(f),root=f.root;await f.close(true);
 const next=await installedControllerFixture({completionOwnerSchema:2,existingRoot:root,recoveryOnly:true});try{expect(next.composition.privateHost.enrollment.openOwner(mapped(),next.peer).owner).toEqual(result.owner);expect((next.composition.privateHost.enrollment as any).readKSwarmApplicationRegistration(result.owner,next.peer,subject).subject).toEqual(subject);}finally{await next.close();}
});
it('includes complete receipt metadata without inventing an AgentSession for the subject',async()=>{
 const {createInstalledControllerMetadataSource,readInstalledMetadataSessions}=await import('../../../src/runtime/verification/installed-metadata-source.js');
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const result=await enroll(f),source=createInstalledControllerMetadataSource(f.lifetime),first=readInstalledMetadataSessions(source,f.database,'authority');expect(first.ownerSessions).toEqual([{uid:f.peer.uid,accountId:'11111111-aaaa-bbbb-cccc-555555555555',profileId:result.owner.profileId,...mapped(),sessionIdentities:[]}]);
 const next=proposal();next.enrollment.invocations.push(invocation);await enroll(f,next);const second=readInstalledMetadataSessions(source,f.database,'authority');expect(second.ownerSessions[0].sessionIdentities).toEqual([invocation.sessionIdentity]);expect(second.sourceCensusHash).not.toBe(first.sourceCensusHash);
 f.database.exec("UPDATE owner_enrollment_kswarm_subjects SET subject_json='{}'");expect(()=>readInstalledMetadataSessions(source,f.database,'authority')).toThrow();
 }finally{await f.close();}
});
it('refuses unsupported persisted features before a downgraded installed lifetime can register owners',async()=>{
 const {assertStorageOwnerSchema}=await import('../../../src/runtime/verification/storage-owner-schema.js');const f=await installedControllerFixture({completionOwnerSchema:2});try{await enroll(f);
 expect(()=>assertStorageOwnerSchema(f.database,{...f.lifetime.manifest,version:2,completionOwnerSchema:undefined} as any)).toThrow('kswarm_storage_schema');
 f.database.exec("UPDATE verification_storage_features SET minimum_schema=3");expect(()=>assertStorageOwnerSchema(f.database,f.lifetime.manifest)).toThrow('kswarm_storage_schema');
 }finally{await f.close();}
});
it('recovers the original committed request after a late read-grant failure without replaying enrollment',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{
 const host=f.composition.privateHost.enrollment,request={requestId:'ks-late-grant',...proposal()},prepared=host.prepareRequest(request,f.peer);
 const originalGrantSql=(f.database.prepare("SELECT sql FROM main.sqlite_master WHERE type='table' AND name='completion_access_grants'").get() as {sql:string}).sql;expect(f.database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual({n:0});
 f.database.exec('DROP TABLE main.completion_access_grants;'+originalGrantSql.replace(/\)$/,",CONSTRAINT late_read_grant_unavailable CHECK(method<>'completion.inspect'))"));
 await expect(host.authorize(prepared.challenge.challengeId,f.peer,signal)).rejects.toThrow('late_read_grant_unavailable');
 expect(f.database.prepare('SELECT committed FROM owner_enrollment_kswarm_subjects').get()).toEqual({committed:1});
 const observed=host.recoverRequest(request,f.peer);expect(observed.state).toBe('committed');expect(host.lookupRequest(request,f.peer)).toEqual(observed);expect(host.prepareRequest(request,f.peer).created).toBe(false);
 await expect(host.authorize(prepared.challenge.challengeId,f.peer,signal)).rejects.toThrow();expect(f.database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual({n:0});f.database.exec('DROP TABLE main.completion_access_grants;'+originalGrantSql);expect(host.openOwner(mapped(),f.peer).owner).toEqual((observed as any).owner);
 expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n:1});
 }finally{await f.close();}
});
it('refuses all durable request siblings on v2 before creating challenge or tombstone rows',async()=>{
 const f=await installedControllerFixture();try{const host=f.composition.privateHost.enrollment,request={requestId:'ks-v2',...proposal()};
 for(const method of ['prepareRequest','lookupRequest','recoverRequest'] as const)expect(()=>host[method](request,f.peer)).toThrow(/kswarm/);
 for(const table of ['owner_enrollment_challenges','owner_enrollment_requests','owner_enrollment_intents','verification_profiles','verification_registered_owners'])expect(f.database.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});
 }finally{await f.close();}
});
it('rejects a persisted KSwarm feature at the actual installed-start composition on v2',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});await enroll(f);const root=f.root;await f.close(true);
 await expect(installedControllerFixture({existingRoot:root,recoveryOnly:true})).rejects.toThrow('kswarm_storage_schema');
});
it('binds enrollment capability to the original branded lifetime and exact database',async()=>{
 const {createInstalledKSwarmEnrollmentCapability:issue,assertKSwarmEnrollmentCapability:check}=await import('../../../src/runtime/verification/kswarm-enrollment-capability.js');
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const token=issue(f.lifetime)!;
 expect(()=>issue({...f.lifetime})).toThrow();expect(()=>check({...token},f.database)).toThrow('kswarm_enrollment_capability');expect(()=>check(token,{} as any)).toThrow('kswarm_enrollment_capability');expect(()=>check(token,f.database)).not.toThrow();
 f.database.exec("INSERT INTO verification_storage_features VALUES('unknown-owner',2)");expect(()=>check(token,f.database)).toThrow('kswarm_storage_schema');
 }finally{await f.close();}
});
it('rejects an unapproved invocation trigger at the closed SQL schema boundary',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const injected=json({...invocation,sessionIdentity:'not-native-approved'});
 f.database.exec(`CREATE TRIGGER ks_inject AFTER UPDATE OF committed ON owner_enrollment_kswarm_subjects WHEN NEW.committed=1 BEGIN
 INSERT INTO verification_registered_invocations VALUES(json_extract(NEW.owner_key,'$.profileId'),'${injected}',NEW.owner_key,'active');
 INSERT INTO owner_enrollment_invocation_receipts VALUES(NEW.owner_key,'${injected}',NEW.logical_owner_key,NEW.registration_json); END`);
 await expect(enroll(f)).rejects.toThrow('enrollment_kswarm_sql_integrity');expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_kswarm_subjects').get()).toEqual({n:0});
 }finally{await f.close();}
});
it('fences complete owner state when a qualified clock trigger changes business revision during inspection',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const result=await enroll(f);
 f.database.exec("CREATE TRIGGER ks_clock AFTER UPDATE ON verification_clock BEGIN UPDATE verification_owners SET business_revision=business_revision+1 WHERE json_extract(owner_key,'$.ownerKind')='kswarm'; END");
 expect(()=>f.composition.public.invoke('completion.inspect',result,f.peer)).toThrow();
 }finally{await f.close();}
});
it('rejects a principal callback injecting an invocation after first profile creation but before FINAL',async()=>{
 let attack:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onClock(){attack?.();}});try{const injected=json({...invocation,sessionIdentity:'callback-unapproved'});let injectedOnce=false;
 attack=()=>{const profile=f.database.prepare('SELECT profile_id FROM verification_profiles').get() as {profile_id:string}|undefined;if(!profile)return;attack=undefined;injectedOnce=true;const ownerKey=json({...mapped(),profileId:profile.profile_id}),receipt=f.database.prepare('SELECT * FROM owner_enrollment_kswarm_subjects').get() as any;
 f.database.prepare("INSERT INTO verification_registered_invocations VALUES(?,?,?,'active')").run(profile.profile_id,injected,ownerKey);f.database.prepare('INSERT INTO owner_enrollment_invocation_receipts VALUES(?,?,?,?)').run(ownerKey,injected,receipt.logical_owner_key,receipt.registration_json);};
 await expect(enroll(f)).rejects.toThrow();expect(injectedOnce).toBe(true);expect(f.database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual({n:0});expect(f.database.prepare('SELECT committed FROM owner_enrollment_kswarm_subjects').get()).toEqual({committed:0});
 }finally{attack=undefined;await f.close();}
});
it('rejects an extra invocation inserted after enrollment by the actual verification clock trigger',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const result=await enroll(f),injected=json({...invocation,sessionIdentity:'late-unapproved'});
 f.database.exec(`CREATE TRIGGER ks_late_invocation AFTER UPDATE ON verification_clock BEGIN
 INSERT OR IGNORE INTO verification_registered_invocations SELECT json_extract(owner_key,'$.profileId'),'${injected}',owner_key,'active' FROM owner_enrollment_kswarm_subjects WHERE committed=1;
 INSERT OR IGNORE INTO owner_enrollment_invocation_receipts SELECT owner_key,'${injected}',logical_owner_key,registration_json FROM owner_enrollment_kswarm_subjects WHERE committed=1; END`);
 expect(()=>f.composition.public.invoke('completion.inspect',result,f.peer)).toThrow();expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_invocation_receipts').get()).toEqual({n:0});
 }finally{await f.close();}
});
it('rejects an extra-grant trigger before KSwarm enrollment while ordinary sibling writer tests cover the exact INSERT difference',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const secret='b'.repeat(64),digest=createHash('sha256').update(secret).digest('hex');
 f.database.exec(`CREATE TRIGGER ks_extra_grant AFTER INSERT ON completion_access_grants WHEN NEW.id<>'forged' BEGIN
 INSERT INTO completion_access_grants VALUES('forged','${digest}',NEW.owner_key,NEW.principal,NEW.scope_epoch,NEW.migration_epoch,NEW.service_epoch,NEW.expires_at,NEW.method,NEW.payload_hash,NEW.source,NEW.state); END`);
 await expect(enroll(f)).rejects.toThrow('enrollment_kswarm_sql_integrity');expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_kswarm_subjects').get()).toEqual({n:0});expect(f.database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual({n:0});
 }finally{await f.close();}
});
it.each(['temp','same-name'] as const)('rejects an unapproved %s trigger on a real installed connection',async mode=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{await enroll(f);
 if(mode==='temp')f.database.exec('CREATE TEMP TRIGGER ks_hidden AFTER UPDATE ON main.verification_clock BEGIN SELECT 1; END');
 else f.database.exec('DROP TRIGGER publication_unapproved_settlement_fence; CREATE TRIGGER publication_unapproved_settlement_fence BEFORE INSERT ON settlement_decisions BEGIN SELECT 1; END');
 expect(()=>f.composition.privateHost.enrollment.openOwner(mapped(),f.peer)).toThrow('enrollment_kswarm_sql_integrity');
 }finally{await f.close();}
});
it('rolls back a trigger introduced inside the qualified clock before returning any current state',async()=>{
 let attack:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onClock(){attack?.();}});try{const result=await enroll(f);
 attack=()=>{attack=undefined;f.database.exec('CREATE TEMP TRIGGER ks_late AFTER UPDATE ON main.verification_clock BEGIN SELECT 1; END');};
 expect(()=>f.composition.public.invoke('completion.inspect',result,f.peer)).toThrow('enrollment_kswarm_sql_integrity');expect(f.database.prepare("SELECT name FROM temp.sqlite_master WHERE name='ks_late'").get()).toBeUndefined();
 }finally{attack=undefined;await f.close();}
});
it('rejects writable_schema even if an unsafe test connection hides its trigger catalog entry',async()=>{
 const {assertKSwarmSqlIntegrity}=await import('../../../src/runtime/verification/kswarm-sql-integrity.js');const f=await installedControllerFixture({completionOwnerSchema:2});try{await enroll(f);f.database.unsafeMode(true);f.database.pragma('writable_schema=ON');expect(f.database.pragma('writable_schema',{simple:true})).toBe(1);expect(()=>assertKSwarmSqlIntegrity(f.database)).toThrow('enrollment_kswarm_sql_integrity');
 }finally{f.database.pragma('writable_schema=OFF');f.database.unsafeMode(false);await f.close();}
});
it('rejects a self-consistent injected invocation against the original approved roster',async()=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const {owner}=await enroll(f),key=json(owner),value=json(invocation),receipt=f.database.prepare('SELECT * FROM owner_enrollment_kswarm_subjects').get() as any;
 expect(receipt.invocations_json).toBe('[]');f.database.prepare("INSERT INTO verification_registered_invocations VALUES(?,?,?,'active')").run(owner.profileId,value,key);f.database.prepare('INSERT INTO owner_enrollment_invocation_receipts VALUES(?,?,?,?)').run(key,value,receipt.logical_owner_key,receipt.registration_json);
 expect(()=>f.composition.privateHost.enrollment.resolveOwnerKey(f.peer,invocation)).toThrow('enrollment_kswarm_roster');
 }finally{await f.close();}
});
it.each(['prepare','prepareRequest','recoverRequest','observeOwner','readOwnerPayload'] as const)('keeps KSwarm out of the actual publication.%s router without issuing scopes or writing request rows',async method=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{await enroll(f);const payload=method==='observeOwner'?mapped():method==='readOwnerPayload'?{...mapped(),operationId:'not-enabled',fullTupleHash:H,offset:0,maxBytes:1024}:{...mapped(),requestSource:'user',...(method==='prepare'?{}:{requestId:'ks-no-publication'})};
 const snapshot=()=>['completion_access_grants','publication_prepare_requests','publication_request_tombstones'].map(table=>f.database.prepare(`SELECT * FROM ${table}`).all());const before=snapshot();
 await expect(f.invoke(`publication.${method}`,payload,f.peer,signal)).rejects.toThrow('publication_operation_owner_kind');expect(snapshot()).toEqual(before);
 }finally{await f.close();}
});


it.each(['verification_owners','mandatory_observation_checks','verification_owner_dependencies','verification_registered_owners','verification_profiles','verification_registered_invocations','owner_enrollment_invocation_receipts','owner_enrollment_kswarm_subjects','verification_storage_features'] as const)('fences exact complete KSwarm snapshot scalar in every original query group: %s',async table=>{
 const f=await installedControllerFixture({completionOwnerSchema:2}),{readKSwarmEnrollmentSnapshot}=await import('../../../src/runtime/verification/kswarm-enrollment-store.js');try{const input=proposal();input.enrollment.invocations.push(invocation);const result=await enroll(f,input);if(table==='verification_owner_dependencies'){const child=proposal();const ordinary={...child,enrollment:{ownerKind:'task' as const,ownerId:'actual-census-child',invocations:[{...invocation,sessionIdentity:'actual-census-child-session'}]}};const prepared=f.composition.privateHost.enrollment.prepare(ordinary,f.peer),enrolled=await f.composition.privateHost.enrollment.authorize(prepared.challengeId,f.peer,signal);
 // Explicit valid original dependency row fixture; this does not invoke or
 // enable KSwarm business, whose production application gates stay denied.
 f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES(?,?)').run(json(result.owner),json(enrolled.owner));}
 f.database.exec('ALTER TABLE '+table+' ADD COLUMN original_extra INTEGER;UPDATE '+table+' SET original_extra=9007199254740992');const before=readKSwarmEnrollmentSnapshot(f.database,result.owner);expect((f.database.prepare('SELECT count(*) n FROM '+table).get() as {n:number}).n).toBeGreaterThan(0);f.database.exec('UPDATE '+table+' SET original_extra=9007199254740993');expect(readKSwarmEnrollmentSnapshot(f.database,result.owner)).not.toEqual(before);
 }finally{await f.close();}
});

it.each(['verification_owners','owner_enrollment_kswarm_subjects','verification_storage_features'] as const)('fences adjacent int64 drift during the actual clock callback without minting a scope: %s',async table=>{
 let attack:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onClock(){attack?.();}});try{const result=await enroll(f);f.database.exec('ALTER TABLE '+table+' ADD COLUMN original_extra INTEGER;UPDATE '+table+' SET original_extra=9007199254740992');let attacked=false;
 attack=()=>{attack=undefined;attacked=true;f.database.exec('UPDATE '+table+' SET original_extra=9007199254740993');};const before=f.database.prepare('SELECT count(*) n FROM completion_access_grants').get();
 expect(()=>f.composition.public.invoke('completion.inspect',result,f.peer)).toThrow('enrollment_kswarm_changed');expect(attacked).toBe(true);expect(f.database.prepare('SELECT count(*) n FROM completion_access_grants').get()).toEqual(before);expect(f.database.prepare('SELECT CAST(original_extra AS TEXT) AS exact FROM '+table).get()).toEqual({exact:'9007199254740992'});
 }finally{attack=undefined;await f.close();}
});
it.each(['temp-table','temp-view','attached'] as const)('namespace: every actual KSwarm receipt reader rejects %s concealing deleted main receipt',async mode=>{
 const f=await installedControllerFixture({completionOwnerSchema:2});try{const input=proposal();input.enrollment.invocations.push(invocation);const result=await enroll(f,input),host=f.composition.privateHost.enrollment;
 if(mode==='temp-table')f.database.exec('CREATE TEMP TABLE owner_enrollment_kswarm_subjects AS SELECT * FROM main.owner_enrollment_kswarm_subjects');
 else if(mode==='temp-view')f.database.exec('CREATE TEMP TABLE saved_receipts AS SELECT * FROM main.owner_enrollment_kswarm_subjects;CREATE TEMP VIEW owner_enrollment_kswarm_subjects AS SELECT * FROM temp.saved_receipts');
 else f.database.exec("ATTACH DATABASE ':memory:' AS shadow;CREATE TABLE shadow.owner_enrollment_kswarm_subjects AS SELECT * FROM main.owner_enrollment_kswarm_subjects");
 f.database.exec('DELETE FROM main.owner_enrollment_kswarm_subjects');
 for(const work of [()=>readKSwarmEnrollmentSnapshot(f.database,result.owner),()=>host.openOwner(mapped(),f.peer),()=>host.resolveOwnerKey(f.peer,invocation),()=>host.readApprovedRecipe(result.owner,'original'),()=>(host as any).readKSwarmApplicationRegistration(result.owner,f.peer,subject),()=>f.composition.public.invoke('completion.inspect',result,f.peer)])expect(work).toThrow('enrollment_kswarm_sql_integrity');
 expect(f.database.prepare('SELECT count(*) n FROM main.owner_enrollment_kswarm_subjects').get()).toEqual({n:0});
 }finally{if(mode==='attached')f.database.exec('DETACH DATABASE shadow');await f.close();}
});
it.each(['temp-table','attached'] as const)('namespace: rejects %s introduced through qualified clock after valid read',async mode=>{
 let attack:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onClock(){attack?.();}});try{const result=await enroll(f);attack=()=>{attack=undefined;f.database.exec(mode==='temp-table'?'CREATE TEMP TABLE namespace_late(value TEXT)':"ATTACH DATABASE ':memory:' AS shadow");};expect(()=>f.composition.public.invoke('completion.inspect',result,f.peer)).toThrow('enrollment_kswarm_sql_integrity');if(mode==='temp-table')expect(f.database.prepare("SELECT name FROM temp.sqlite_master WHERE name='namespace_late'").get()).toBeUndefined();
 }finally{attack=undefined;const databaseList=f.database.pragma('database_list');if(!Array.isArray(databaseList))throw new TypeError('pragma_database_list_not_array');if(databaseList.some((row:any)=>row.name==='shadow'))f.database.exec('DETACH DATABASE shadow');await f.close();}
});
it.each(['existing','current','principal'] as const)('namespace identity: rejects genuine KSwarm invocation downgraded by %s TEMP callback',async mode=>{
 let attack:(()=>void)|undefined;const f=await installedControllerFixture({completionOwnerSchema:2,onCurrent(){if(mode==='current')attack?.();},onPrincipal(){if(mode==='principal')attack?.();}});try{
 const ks=proposal();ks.enrollment.invocations.push(invocation);const result=await enroll(f,ks),host=f.composition.privateHost.enrollment,issued=host.createCapacityOwnerBinding(f.peer,invocation);
 const ordinaryInvocation={...invocation,sessionIdentity:'namespace-ordinary'},p=proposal(),ordinary={...p,enrollment:{ownerKind:'task' as const,ownerId:'namespace-ordinary',invocations:[ordinaryInvocation]}};const prepared=host.prepare(ordinary,f.peer),other=await host.authorize(prepared.challengeId,f.peer,signal);
 const shadow=()=>{attack=undefined;for(const table of ['verification_profiles','verification_registered_owners','verification_registered_invocations','owner_enrollment_invocation_receipts'])f.database.exec(`CREATE TEMP TABLE ${table} AS SELECT * FROM main.${table}`);f.database.prepare('UPDATE temp.verification_registered_invocations SET owner_key=? WHERE invocation_json=?').run(json(other.owner),json(invocation));f.database.prepare('DELETE FROM temp.owner_enrollment_invocation_receipts WHERE invocation_json=?').run(json(invocation));f.database.prepare('INSERT INTO temp.owner_enrollment_invocation_receipts SELECT owner_key,?,logical_owner_key,registration_json FROM main.owner_enrollment_invocation_receipts WHERE owner_key=? AND invocation_json=?').run(json(invocation),json(other.owner),json(ordinaryInvocation));};
 if(mode==='existing')shadow();else attack=shadow;
 expect(()=>host.resolveOwnerKey(f.peer,invocation)).toThrow('enrollment_kswarm_sql_integrity');expect(attack).toBeUndefined();
 // The failed transaction may roll back TEMP DDL; recreate a stable shadow for both binding entry points.
 if(!f.database.prepare("SELECT 1 FROM temp.sqlite_master WHERE name='verification_profiles'").get())shadow();
 expect(()=>host.createCapacityOwnerBinding(f.peer,invocation)).toThrow('enrollment_kswarm_sql_integrity');expect(()=>readProfileCapacityOwnerBinding(issued,f.database)).toThrow('enrollment_kswarm_sql_integrity');expect(f.database.prepare('SELECT owner_key FROM main.verification_registered_invocations WHERE invocation_json=?').get(json(invocation))).toEqual({owner_key:json(result.owner)});
 }finally{attack=undefined;await f.close();}
});
