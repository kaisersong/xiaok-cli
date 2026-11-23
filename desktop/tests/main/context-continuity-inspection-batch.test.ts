// @vitest-environment node
import {afterAll,afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixtureRoot=mkdtempSync(join(tmpdir(),'continuity-inspection-batch-')),previousConfig=process.env.XIAOK_CONFIG_DIR;
process.env.XIAOK_CONFIG_DIR=join(fixtureRoot,'config');mkdirSync(process.env.XIAOK_CONFIG_DIR,{mode:0o700});
const {ContinuityService}=await import('../../electron/context-continuity/service.js');
const route=await import('../../../src/runtime/verification/ordinary-source-writer-observation.js');
const actor={requestSource:'user' as const,profileId:'inspection-batch',actorId:'desktop-user:inspection-batch'};
let service:InstanceType<typeof ContinuityService>,directory:string;
beforeEach(()=>{directory=mkdtempSync(join(fixtureRoot,'case-'));service=new ContinuityService({dbPath:join(directory,'continuity.sqlite'),profileId:actor.profileId});});
afterEach(()=>{vi.restoreAllMocks();service.close();rmSync(directory,{recursive:true,force:true});});
afterAll(()=>{if(previousConfig===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previousConfig;rmSync(fixtureRoot,{recursive:true,force:true});});
it('checks 200 absent legacy IDs with fresh guarded opening and closing reads, preserving every external policy call',()=>{
 const ids=Array.from({length:200},(_,i)=>'legacy-'+i),calls:string[]=[];service.setScopePolicy(id=>{calls.push(id);return id==='legacy-2'?'blocked':'readable';});const probe=vi.spyOn(route,'assertOrdinarySourceWriterRoute');
 const rows=service.inspectConversations(actor,ids);expect(rows).toEqual(ids.map(id=>({id,state:id==='legacy-2'?'blocked':'missing'})));expect(calls).toEqual(ids);expect(probe.mock.calls.length).toBeLessThanOrEqual(4);expect(probe.mock.calls.length).toBeGreaterThan(0);
 calls.length=0;probe.mockClear();expect(service.inspectConversations(actor,ids)).toEqual(rows);expect(calls).toEqual(ids);expect(probe.mock.calls.length).toBeGreaterThan(0);expect(probe.mock.calls.length).toBeLessThanOrEqual(4);
});
it('preserves empty inputs, duplicate IDs and input order',()=>{expect(service.inspectConversations(actor,[])).toEqual([]);expect(service.inspectConversations(actor,['b','a','b'])).toEqual([{id:'b',state:'missing'},{id:'a',state:'missing'},{id:'b',state:'missing'}]);});
it('validates the actor and all IDs before reading the database',()=>{const probe=vi.spyOn(route,'assertOrdinarySourceWriterRoute');expect(()=>service.inspectConversations({...actor,actorId:'foreign'},['x'])).toThrow();expect(()=>service.inspectConversations(actor,['valid',''])).toThrow('invalid_argument');expect(()=>service.inspectConversations(actor,Array(201).fill('x'))).toThrow('invalid_argument');expect(probe.mock.calls.length).toBe(0);});
it('keeps mixed existing and absent populations on the original algorithm',()=>{const c=service.createConversation(actor,{operationId:'new'}),calls:string[]=[];service.setScopePolicy(id=>{calls.push(id);return id===c.id?'blocked':'readable';});expect(service.inspectConversations(actor,[c.id,'absent'])).toEqual([{id:c.id,state:'blocked'},{id:'absent',state:'missing'}]);expect(calls).toEqual([c.id,'absent']);});
it('never invokes the external policy for an affected scope denied by the original sync owner gate',()=>{const c=service.createConversation(actor,{operationId:'new'});service.store.db.prepare('INSERT INTO sync_scopes VALUES(?,?,?,?,?)').run(c.id,'origin','manifest','candidate','stage');const calls:string[]=[];service.setScopePolicy(id=>{calls.push(id);return 'readable';});expect(service.inspectConversations(actor,[c.id,'absent'])).toEqual([{id:c.id,state:'blocked'},{id:'absent',state:'missing'}]);expect(calls).toEqual(['absent']);});
it('falls back if a policy callback creates a requested conversation',()=>{const seed=service.createConversation(actor,{operationId:'seed'});let created=false;service.setScopePolicy(id=>{if(!created){created=true;service.store.db.prepare('INSERT INTO conversations(id,record) VALUES(?,?)').run(id,JSON.stringify({...seed,id}));}return 'readable';});expect(service.inspectConversations(actor,['appearing'])).toEqual([{id:'appearing',state:'active'}]);});
it('keeps blocked classification for pending and failed canonical binding instead of certifying missing',async()=>{const binding=service.store.bindCanonicalSyncDevice(null as never);expect(service.inspectConversations(actor,['absent'])).toEqual([{id:'absent',state:'blocked'}]);await expect(binding).rejects.toThrow();expect(service.inspectConversations(actor,['absent'])).toEqual([{id:'absent',state:'blocked'}]);});
it('does not translate an unavailable source operation route into absence',()=>{vi.spyOn(route,'assertOrdinarySourceWriterRoute').mockImplementation(()=>{throw Error('negative source guard');});expect(()=>service.inspectConversations(actor,['absent'])).toThrow();});
it('does not certify absence after the actual database owner closes',()=>{service.close();expect(()=>service.inspectConversations(actor,['absent'])).toThrow();});

it('keeps deleted precedence when a policy callback creates and tombstones a requested row',()=>{const seed=service.createConversation(actor,{operationId:'seed'});let created=false;service.setScopePolicy(id=>{if(!created){created=true;service.store.db.prepare('INSERT INTO conversations(id,record) VALUES(?,?)').run(id,JSON.stringify({...seed,id}));}return 'deleted';});expect(service.inspectConversations(actor,['deleted-during-check'])).toEqual([{id:'deleted-during-check',state:'deleted'}]);expect(service.store.db.prepare('SELECT deleted FROM conversations WHERE id=?').get('deleted-during-check')?.deleted).toBe(1);});
