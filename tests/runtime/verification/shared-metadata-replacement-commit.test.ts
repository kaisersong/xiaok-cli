import {metadataReplacementResultHash} from '../../../src/runtime/verification/metadata-replacement-lineage.js';
import {canonicalVerificationJson as capacityJson} from '../../../src/runtime/verification/protocol.js';
import * as capacityDispatch from '../../../src/runtime/verification/shared-capacity-command-dispatch.js';
import {sharedCommandFault} from '../../support/shared-command-fault.js';
import {createPrimitiveCapacityLedger} from '../../support/capacity-primitive-ledger.js';
import * as replacementLedger from '../../../src/runtime/verification/shared-capacity-ledger.js';
import {type CapacityMetadataReplacementRequest,type CapacityOwner,type CapacityMetadataReplacementCommitContext} from '../../../src/runtime/verification/shared-capacity-ledger.js';
import {it,expect,afterEach,vi} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const consumeCapacityMetadataReplacementContext=(...args:unknown[]):any=>Reflect.apply(Reflect.get(replacementLedger,'consumeCapacityMetadataReplacementContext'),undefined,args);
const clean:Array<()=>void>=[];afterEach(()=>{for(const close of clean.splice(0).reverse())close();});
const proposal=(operationId:string,partition:'control'|'rollback',bytes=1024)=>({operationId,resourceId:operationId,generation:1,partition,bytes,bindingHash:'a'.repeat(64)});
function fixture(bytes=1024){
 const path=mkdtempSync(join(tmpdir(),'replacement-commit-')),db=new Database(join(path,'original.sqlite'));db.pragma('journal_mode=DELETE');db.pragma('synchronous=FULL');
 clean.push(()=>{if(db.open)db.close();rmSync(path,{recursive:true,force:true});});db.exec('CREATE TABLE actual_target_ready(intent_id TEXT PRIMARY KEY,result_hash TEXT NOT NULL)');
 const bindings=new WeakMap<object,{sessionKey:string;producerKey:string}>(),prepareProof={},commitProof={};let calls=0;let effect:(database:Database)=>void=()=>{};
 const options={database:db,authorityId:'actual-primitive-authority',host:{assertCurrent(){},inspectOwner(binding:object){const value=bindings.get(binding);if(!value)throw Error('foreign owner');return value;},assertReleased(receipt:object){if(receipt!==commitProof)throw Error('foreign absence proof');},assertMetadataReplacement(receipt:object){if(receipt!==prepareProof)throw Error('foreign prepare proof');},assertMetadataReplacementCommit(receipt:object){if(receipt!==commitProof)throw Error('foreign commit proof');},executeMetadataReplacementCommit(receipt:object,context:CapacityMetadataReplacementCommitContext){
  const result=consumeCapacityMetadataReplacementContext(context,ledger,db,receipt);calls++;db.prepare('INSERT INTO actual_target_ready VALUES(?,?)').run(result.intentId,result.resultHash);effect(db);
 }}};
 const ledger=createPrimitiveCapacityLedger(options);clean.push(()=>ledger.close());
 const bind=(sessionKey:string,producerKey=sessionKey)=>{const binding={};bindings.set(binding,{sessionKey,producerKey});return {binding,owner:ledger.bindOwner(binding)};};
 const primary=bind('session','physical-original'),owner=primary.owner;
 ledger.reserve(owner,proposal('source','control',bytes));ledger.commit(owner,'source');ledger.requestRelease(owner,'source');ledger.reserve(owner,proposal('staging','rollback',bytes));ledger.commit(owner,'staging');
 const request:CapacityMetadataReplacementRequest={replacementId:'original-replacement',intentId:'original-import',sources:[{owner,operationId:'source'}],staging:[{owner,operationId:'staging'}],unusedCapacity:[],targets:[{owner,proposal:proposal('target','control',bytes),beneficiaries:[]},{owner,proposal:proposal('future','rollback',bytes),beneficiaries:[]}],proof:prepareProof};
 return{db,ledger,options,owner,primary,request,prepareProof,commitProof,bind,calls:()=>calls,setEffect:(fn:(database:Database)=>void)=>{effect=fn;}};
}
// Reflect invokes the actual entry, including the real absent-method red. The
// primitive host is explicitly not a native/installed retirement issuer.
function commit(f:ReturnType<typeof fixture>,request=f.request,proof:object=f.commitProof):any{return Reflect.apply(Reflect.get(f.ledger,'commitMetadataReplacement'),f.ledger,[request,proof]);}
const rawFacts=(db:Database)=>['shared_capacity_reservations','shared_capacity_session_attributions','shared_metadata_replacements','shared_metadata_replacement_claims','shared_metadata_replacement_resource_claims','actual_target_ready','shared_capacity_transfers','shared_metadata_replacement_commits','shared_metadata_replacement_consumptions'].map(table=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all():[]);
it('atomically transfers a sealed stage and retired source to target plus paid future rollback in the original SQLite transaction',()=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);const result=commit(f);
 expect(result).toMatchObject({replacementId:f.request.replacementId,intentId:f.request.intentId,state:'committed'});expect(f.ledger.usage().chargedBytes).toBe(2048);
 expect(f.ledger.query(f.owner,'source')?.state).toBe('released');expect(f.ledger.query(f.owner,'staging')?.state).toBe('transferred');expect(f.ledger.query(f.owner,'target')?.state).toBe('committed');expect(f.ledger.query(f.owner,'future')?.state).toBe('reserved');expect(f.calls()).toBe(1);expect(f.db.prepare('SELECT * FROM actual_target_ready').all()).toHaveLength(1);
});
it.each(['missing-future','smaller-future','wrong-partition','unpaid-new-session'] as const)('refuses %s before preparing claims even when the primitive prepare verifier accepts',kind=>{
 const f=fixture();if(kind==='missing-future')f.request.targets=f.request.targets.slice(0,1);if(kind==='smaller-future')f.request.targets[1]!.proposal.bytes--;if(kind==='wrong-partition')f.request.targets[1]!.proposal.partition='control';if(kind==='unpaid-new-session'){const added=f.bind('unpaid').owner;for(const entry of f.request.targets)(entry.beneficiaries as CapacityOwner[]).push(added);}
 const before=rawFacts(f.db);expect(()=>f.ledger.prepareMetadataReplacement(f.request)).toThrow('replacement_fees');expect(rawFacts(f.db)).toEqual(before);expect(f.calls()).toBe(0);expect(f.ledger.usage().chargedBytes).toBe(2048);
});
it('keeps full current U attribution after explicitly paying the original ledger before preparing',()=>{
 const f=fixture(),user=f.bind('user').owner;for(const operationId of ['source','staging'])f.ledger.attributeSession({physicalOwner:f.owner,beneficiaryOwner:user,operationId});for(const entry of f.request.targets)(entry.beneficiaries as CapacityOwner[]).push(user);f.ledger.prepareMetadataReplacement(f.request);commit(f);
 expect(f.ledger.querySessionAttribution({physicalOwner:f.owner,beneficiaryOwner:user,operationId:'staging'})?.charged).toBe(false);for(const operationId of ['target','future'])expect(f.ledger.querySessionAttribution({physicalOwner:f.owner,beneficiaryOwner:user,operationId})?.charged).toBe(true);expect(f.ledger.usage().chargedBytes).toBe(2048);
});
it.each(['copied','prepare-proof'] as const)('does not upgrade %s into commit authorization',kind=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);const before=rawFacts(f.db);expect(()=>commit(f,f.request,kind==='copied'?{}:f.prepareProof)).toThrow('foreign commit proof');expect(rawFacts(f.db)).toEqual(before);expect(f.calls()).toBe(0);
});
it.each(['throw','source-tuple','target-amount','schema'] as const)('rolls back original allocations and actual ready SQL when fixed execution fails or changes %s',kind=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);const before=rawFacts(f.db);f.setEffect(db=>{if(kind==='throw')throw Error('actual ready failure');if(kind==='source-tuple')db.prepare("UPDATE shared_capacity_reservations SET bytes=bytes+1 WHERE operation_id='source'").run();if(kind==='target-amount')db.prepare("UPDATE shared_capacity_reservations SET bytes=bytes+1 WHERE operation_id='target'").run();if(kind==='schema')db.exec('CREATE TEMP TRIGGER foreign_writer AFTER INSERT ON actual_target_ready BEGIN SELECT 1;END');});
 expect(()=>commit(f)).toThrow();expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.usage().chargedBytes).toBe(2048);expect(f.db.prepare("SELECT name FROM temp.sqlite_schema WHERE type='trigger'").all()).toEqual([]);expect(f.calls()).toBe(1);
});
it('exact committed retry does not repeat the actual ready writer and survives real database reopen',()=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);const original=commit(f);expect(commit(f)).toEqual(original);expect(f.calls()).toBe(1);const name=f.db.name;f.ledger.close();f.db.close();const db=new Database(name),next=createPrimitiveCapacityLedger({...f.options,database:db});try{const owner=next.bindOwner(f.primary.binding),request={...f.request,sources:[{owner,operationId:'source'}],staging:[{owner,operationId:'staging'}],targets:f.request.targets.map(entry=>({...entry,owner}))};const reopened={...f,db,ledger:next,owner,request};expect(commit(reopened)).toEqual(original);expect(f.calls()).toBe(1);expect(next.usage().chargedBytes).toBe(2048);}finally{next.close();db.close();}
});
it.each(['reserve','commit','requestRelease','markUnknown','release','attribute'] as const)('transferred does not authorize old operation %s reuse or a fake absence',kind=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);commit(f);const before=rawFacts(f.db);expect(()=>{switch(kind){case 'reserve':return f.ledger.reserve(f.owner,proposal('staging','rollback'));case 'commit':return f.ledger.commit(f.owner,'staging');case 'requestRelease':return f.ledger.requestRelease(f.owner,'staging');case 'markUnknown':return f.ledger.markUnknown(f.owner,'staging');case 'release':return f.ledger.release(f.owner,'staging',f.commitProof);case 'attribute':return f.ledger.attributeSession({physicalOwner:f.owner,beneficiaryOwner:f.bind('foreign').owner,operationId:'staging'});}}).toThrow();expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.usage().chargedBytes).toBe(2048);
});
it('permits later target source/stage roles without erasing previous incoming edges',()=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);commit(f);f.ledger.requestRelease(f.owner,'target');f.ledger.commit(f.owner,'future');const second={...f.request,replacementId:'second-replacement',intentId:'second-import',sources:[{owner:f.owner,operationId:'target'}],staging:[{owner:f.owner,operationId:'future'}],targets:[{owner:f.owner,proposal:proposal('target2','control'),beneficiaries:[]},{owner:f.owner,proposal:proposal('future2','rollback'),beneficiaries:[]}]};f.ledger.prepareMetadataReplacement(second);commit(f,second);expect(f.ledger.usage().chargedBytes).toBe(2048);expect(f.ledger.query(f.owner,'future')?.state).toBe('transferred');f.ledger.requestRelease(f.owner,'target2');f.ledger.release(f.owner,'target2',f.commitProof);expect(f.ledger.usage().chargedBytes).toBe(1024);
});
it.each(['missing-edge','missing-target','corrupt-result'] as const)('rejects unknown charge after %s instead of counting a free transfer',kind=>{
 const f=fixture();f.ledger.prepareMetadataReplacement(f.request);commit(f);if(kind==='missing-edge'){/* Explicit database corruption injection, never a production FK policy. */f.db.pragma('foreign_keys=OFF');f.db.exec('DELETE FROM shared_metadata_replacement_commits');f.db.pragma('foreign_keys=ON');}if(kind==='missing-target')f.db.prepare("DELETE FROM shared_capacity_reservations WHERE operation_id='target'").run();if(kind==='corrupt-result')f.db.exec("UPDATE shared_metadata_replacement_commits SET result_json='{}'");expect(()=>f.ledger.usage()).toThrow();expect(()=>f.ledger.query(f.owner,'staging')).toThrow();
});
it('preserves exactly the original full 2GiB pool including a paid controller headroom fixture and 256MiB session boundaries',()=>{
 const MiB=1024**2,f=fixture(112*MiB),controller=f.bind('controller-ledger-headroom').owner;
 for(const partition of ['control','rollback'] as const)f.ledger.reserve(controller,proposal('controller-'+partition,partition,16*MiB));
 const reserve=(name:string,partition:import('../../../src/runtime/verification/shared-capacity-ledger.js').CapacityPartition,bytes:number)=>{const owner=f.bind(name).owner;f.ledger.reserve(owner,{...proposal(name,'control',bytes),partition});};
 for(let i=0;i<6;i++)reserve('archive-'+i,'archive',(i===5?192:256)*MiB);
 for(let i=0;i<64;i++)reserve('counter-'+i,'counter',4*MiB);
 reserve('outbox-full','outbox',32*MiB);reserve('auxiliary-full','auxiliary',16*MiB);reserve('egress-part','egress',16*MiB);
 f.db.pragma('max_page_count='+15*MiB/(f.db.pragma('page_size',{simple:true}) as number));
 expect(f.ledger.usage().chargedBytes).toBe(2048*MiB);f.ledger.prepareMetadataReplacement(f.request);const result=commit(f);expect(result.state).toBe('committed');expect(f.ledger.usage().chargedBytes).toBe(2048*MiB);
 expect(()=>f.ledger.reserve(f.bind('no-free-space').owner,proposal('cannot-fit','control',1))).toThrow();expect(f.ledger.query(f.owner,'target')?.bytes).toBe(112*MiB);expect(f.ledger.query(f.owner,'future')?.bytes).toBe(112*MiB);
});
it('transfers a paid unmaterialized rollback promise into a reserved stage before any future copy can be committed',()=>{
 const f=fixture();f.ledger.reserve(f.owner,proposal('unused-rollback','rollback'));const request={...f.request,replacementId:'unused-replacement',intentId:'unused-import',sources:[],staging:[],unusedCapacity:[{owner:f.owner,operationId:'unused-rollback'}],targets:[{owner:f.owner,proposal:proposal('reserved-stage','rollback'),beneficiaries:[]}]};f.ledger.prepareMetadataReplacement(request);commit(f,request);
 expect(f.ledger.query(f.owner,'unused-rollback')?.state).toBe('transferred');expect(f.ledger.query(f.owner,'reserved-stage')?.state).toBe('reserved');expect(f.ledger.usage().chargedBytes).toBe(3072);f.ledger.commit(f.owner,'reserved-stage');expect(f.ledger.usage().chargedBytes).toBe(3072);
});
it('rejects an extra callback parameter before touching request getters, Proxy traps, or executing caller work',()=>{
 const f=fixture();let reads=0,calls=0;const request=new Proxy(f.request,{get(){reads++;throw Error('getter forbidden');},ownKeys(){reads++;throw Error('trap forbidden');}});
 expect(()=>Reflect.apply(Reflect.get(f.ledger,'commitMetadataReplacement'),f.ledger,[request,f.commitProof,()=>{calls++;}])).toThrow('shared_capacity_replacement_arguments');expect({reads,calls}).toEqual({reads:0,calls:0});expect(f.calls()).toBe(0);
});

it('rejects a preinstalled ready trigger freeing an ordinary unclaimed allocation without an absence proof',()=>{
 const f=fixture();f.ledger.reserve(f.owner,proposal('ordinary','control'));f.db.exec("CREATE TRIGGER ordinary_free_on_ready AFTER INSERT ON actual_target_ready BEGIN UPDATE shared_capacity_reservations SET state='released',revision=revision+1 WHERE operation_id='ordinary';END");f.ledger.prepareMetadataReplacement(f.request);const before=rawFacts(f.db);
 expect(()=>commit(f)).toThrow('shared_capacity_replacement_changed');expect(f.calls()).toBe(1);expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.query(f.owner,'ordinary')?.state).toBe('reserved');
});
it.each(['reserve','metadata','command'] as const)('guards the ordinary unclaimed population on the actual %s sibling',kind=>{
 const f=fixture();f.ledger.reserve(f.owner,proposal('ordinary','control'));f.db.exec("CREATE TRIGGER ordinary_free_on_insert AFTER INSERT ON shared_capacity_reservations WHEN NEW.operation_id='victim' BEGIN UPDATE shared_capacity_reservations SET state='released',revision=revision+1 WHERE operation_id='ordinary';END");const before=rawFacts(f.db);let effects=0;
 expect(()=>{if(kind==='reserve')return f.ledger.reserve(f.owner,proposal('victim','control'));if(kind==='metadata')return f.ledger.reserveMetadata([{owner:f.owner,proposal:proposal('victim','control'),beneficiaries:[]}]);return sharedCommandFault(f.ledger,f.db).reserveWithCommit(f.owner,proposal('victim','control'),(_a,t)=>t.run(f.db,()=>{effects++;}));}).toThrow('shared_capacity_replacement_changed');
 expect(rawFacts(f.db)).toEqual(before);expect(effects).toBe(0);expect(f.ledger.query(f.owner,'ordinary')?.state).toBe('reserved');
});
it('rejects the actual two-insert metadata ABA before a later quota check can see a temporarily freed reservation',()=>{
 const MiB=1024**2,f=fixture();f.ledger.reserve(f.owner,{...proposal('ordinary','control',200*MiB),partition:'archive'});f.db.exec("CREATE TRIGGER ordinary_aba AFTER INSERT ON shared_capacity_reservations BEGIN UPDATE shared_capacity_reservations SET state='released',revision=revision+1 WHERE operation_id='ordinary' AND NEW.operation_id='victim';UPDATE shared_capacity_reservations SET state='reserved',revision=revision-1 WHERE operation_id='ordinary' AND NEW.operation_id='victim2';END");const before=rawFacts(f.db);
 expect(()=>f.ledger.reserveMetadata([{owner:f.owner,proposal:proposal('victim','control',40*MiB),beneficiaries:[]},{owner:f.owner,proposal:proposal('victim2','rollback',40*MiB),beneficiaries:[]}])).toThrow('shared_capacity_replacement_changed');expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.usage().chargedBytes).toBe(200*MiB+2048);
});
it('keeps the complete previous attribution set when an actual attribution INSERT trigger deletes an ordinary old beneficiary',()=>{
 const f=fixture(),old=f.bind('old-beneficiary').owner,next=f.bind('next-beneficiary').owner;f.ledger.reserve(f.owner,proposal('ordinary','control'));f.ledger.attributeSession({physicalOwner:f.owner,beneficiaryOwner:old,operationId:'ordinary'});f.db.exec("CREATE TRIGGER old_attribution_free AFTER INSERT ON shared_capacity_session_attributions WHEN NEW.operation_id='ordinary' AND NEW.beneficiary_session_key='next-beneficiary' BEGIN DELETE FROM shared_capacity_session_attributions WHERE operation_id='ordinary' AND beneficiary_session_key='old-beneficiary';END");const before=rawFacts(f.db);
 expect(()=>f.ledger.attributeSession({physicalOwner:f.owner,beneficiaryOwner:next,operationId:'ordinary'})).toThrow('shared_capacity_replacement_changed');expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.querySessionAttribution({physicalOwner:f.owner,beneficiaryOwner:old,operationId:'ordinary'})?.charged).toBe(true);
});
it('poisons the original transaction even if a fixed command catches the step failure and restores the ordinary row',()=>{
 const f=fixture();f.ledger.reserve(f.owner,proposal('ordinary','control'));f.db.exec("CREATE TRIGGER ordinary_free_on_batch AFTER INSERT ON shared_capacity_reservations WHEN NEW.operation_id='victim' BEGIN UPDATE shared_capacity_reservations SET state='released',revision=revision+1 WHERE operation_id='ordinary';END");const before=rawFacts(f.db);let caught=0;
 expect(()=>sharedCommandFault(f.ledger,f.db).withReservationTransaction(batch=>{try{batch.reserveWithCommit([{owner:f.owner,proposal:proposal('victim','control')}],(_a,t)=>t.run(f.db,()=>{}));}catch{caught++;}f.db.exec("UPDATE shared_capacity_reservations SET state='reserved',revision=1 WHERE operation_id='ordinary'");})).toThrow();expect(caught).toBe(1);expect(rawFacts(f.db)).toEqual(before);
});

it('rejects a fixed transaction command temporary transfer before the actual batch quota check even when its deferred FK would be restored',()=>{
 const MiB=1024**2,f=fixture();f.ledger.reserve(f.owner,{...proposal('ordinary','control',200*MiB),partition:'archive'});const before=rawFacts(f.db);let reached=0;
 const parent=Object.freeze({}),child=Object.freeze({}),inspect=capacityDispatch.inspectSharedCapacityCommand,execute=capacityDispatch.executeSharedCapacityCommand;
 const inspection=vi.spyOn(capacityDispatch,'inspectSharedCapacityCommand').mockImplementation((c,l,d)=>{
  if(l!==f.ledger||d!==f.db)return inspect(c,l,d);
  if(c===parent)return {kind:'transaction'};
  if(c===child)return {kind:'batch',entries:[{owner:f.owner,proposal:proposal('victim','control',40*MiB)},{owner:f.owner,proposal:proposal('victim2','rollback',40*MiB)}]};
  return inspect(c,l,d);
 });
 const execution=vi.spyOn(capacityDispatch,'executeSharedCapacityCommand').mockImplementation((c,context)=>{
  if(c!==parent&&c!==child)return execute(c,context);
  replacementLedger.consumeSharedCapacityCommandContext(context,f.ledger,f.db,c);
  if(c===child){reached++;return;}
  const ordinary=f.db.prepare("SELECT tuple_hash FROM shared_capacity_reservations WHERE operation_id='ordinary'").get() as {tuple_hash:string};
  f.db.prepare("INSERT INTO shared_capacity_transfers VALUES(?,'transferred',?,?,?)").run('ordinary','nonexistent-deferred-parent',ordinary.tuple_hash,2);
  // No extra fixture query/lineage audit between the actual reserve steps and
  // fixed command. The production ledger alone must catch the quota bypass.
  f.ledger.reserveBatchCommand(child,context);
  f.db.exec("DELETE FROM shared_capacity_transfers WHERE operation_id='ordinary'");
 });
 try{expect(()=>f.ledger.reserveCommand(parent)).toThrow('shared_capacity_replacement_changed');expect(reached).toBe(0);expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.usage().chargedBytes).toBe(200*MiB+2048);}finally{execution.mockRestore();inspection.mockRestore();}
});

it('rejects a preinstalled literal trigger changing the original commit row to a different self-consistent sequence and result',()=>{
 const reference=fixture();reference.ledger.prepareMetadataReplacement(reference.request);const original=commit(reference),{resultHash:_hash,...core}=original,changedCore={...core,commitSequence:original.commitSequence+1},changed={...changedCore,resultHash:metadataReplacementResultHash(changedCore)};
 const f=fixture(),prepared=f.ledger.prepareMetadataReplacement(f.request);
 expect(prepared.requestHash).toBe(original.requestHash);
 // Literal payload derives from the actual production reference result; no
 // test hashing implementation, UDF or query callback executes in the trigger.
 const literal=capacityJson(changed).replaceAll("'","''");f.db.exec("CREATE TRIGGER self_consistent_commit_rewrite AFTER INSERT ON shared_metadata_replacement_commits BEGIN UPDATE shared_metadata_replacement_commits SET commit_sequence="+changed.commitSequence+",result_json='"+literal+"',result_hash='"+changed.resultHash+"' WHERE replacement_id=NEW.replacement_id;END");const before=rawFacts(f.db);
 expect(()=>commit(f)).toThrow('shared_capacity_replacement_changed');expect(f.calls()).toBe(0);expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.usage().chargedBytes).toBe(2048);
});

it.each(['reserve','update'] as const)('rejects a complete self-consistent literal prepared graph inserted by an ordinary %s trigger without invoking the actual prepare verifier',kind=>{
 const reference=fixture();reference.ledger.prepareMetadataReplacement(reference.request);
 const tables=['shared_metadata_replacements','shared_metadata_replacement_claims','shared_metadata_replacement_resource_claims','shared_metadata_replacement_consumptions'] as const;
 const literal=(value:unknown)=>typeof value==='string'?"'"+value.replaceAll("'","''")+"'":String(value);
 const statements=tables.flatMap(table=>(reference.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all() as Array<Record<string,string|number>>).map(row=>'INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.values(row).map(literal).join(',')+');')).join('');
 const f=fixture();f.ledger.reserve(f.owner,proposal('ordinary','control'));const verify=vi.spyOn(f.options.host,'assertMetadataReplacement');
 f.db.exec('CREATE TRIGGER foreign_prepared_graph AFTER '+(kind==='reserve'?'INSERT':'UPDATE')+" ON shared_capacity_reservations WHEN NEW.operation_id='"+(kind==='reserve'?'victim':'ordinary')+"' BEGIN "+statements+'END');const before=rawFacts(f.db);
 try{expect(()=>kind==='reserve'?f.ledger.reserve(f.owner,proposal('victim','control')):f.ledger.commit(f.owner,'ordinary')).toThrow('shared_capacity_replacement_changed');expect(verify).not.toHaveBeenCalled();expect(rawFacts(f.db)).toEqual(before);expect(f.ledger.query(f.owner,'source')?.state).toBe('release_pending');}finally{verify.mockRestore();}
});

it('keeps one durable result and one ready write when two actual SQLite connections compete and the loser retries the same replacement',()=>{
 const f=fixture(),database=new Database(f.db.name,{timeout:0});database.pragma('busy_timeout=0');let second:ReturnType<typeof createPrimitiveCapacityLedger>|undefined,calls=0;
 try{
  second=createPrimitiveCapacityLedger({...f.options,database,host:{...f.options.host,executeMetadataReplacementCommit(receipt:object,context:CapacityMetadataReplacementCommitContext){if(!second)throw Error('fixture construction');const result=consumeCapacityMetadataReplacementContext(context,second,database,receipt);calls++;database.prepare('INSERT INTO actual_target_ready VALUES(?,?)').run(result.intentId,result.resultHash);}}});
  const owner=second.bindOwner(f.primary.binding),request={...f.request,sources:[{owner,operationId:'source'}],staging:[{owner,operationId:'staging'}],targets:f.request.targets.map(entry=>({...entry,owner}))};f.ledger.prepareMetadataReplacement(f.request);const before=rawFacts(database);
  f.db.exec('BEGIN IMMEDIATE');try{expect(()=>second!.commitMetadataReplacement(request,f.commitProof)).toThrow(/locked/);expect(rawFacts(database)).toEqual(before);expect(calls).toBe(0);expect(f.calls()).toBe(0);}finally{f.db.exec('ROLLBACK');}
  const first=commit(f),retry=second.commitMetadataReplacement(request,f.commitProof);expect(retry).toEqual(first);expect(f.calls()).toBe(1);expect(calls).toBe(0);expect(database.prepare('SELECT * FROM shared_metadata_replacement_commits').all()).toHaveLength(1);expect(database.prepare('SELECT * FROM actual_target_ready').all()).toHaveLength(1);expect(second.usage().chargedBytes).toBe(2048);expect(rawFacts(database)).toEqual(rawFacts(f.db));
 }finally{second?.close();database.close();}
});
