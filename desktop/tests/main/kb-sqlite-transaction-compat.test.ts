// @vitest-environment node
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';

let make:typeof import('../../electron/kb-store-sqlite.js').createKbStoreSqlite;
let readReceipt:typeof import('../../electron/kb-store-sqlite.js').readOriginalKnowledgeSourceReceipt;
let root:string;
const stores:Array<ReturnType<typeof make>>=[];
const closed=new Set<object>();
const disable:Array<()=>void>=[];
beforeEach(async()=>{vi.resetModules();root=fs.mkdtempSync(join(tmpdir(),'kb-transaction-compat-'));const api=await import('../../electron/kb-store-sqlite.js');make=api.createKbStoreSqlite;readReceipt=api.readOriginalKnowledgeSourceReceipt;});
afterEach(()=>{for(const stop of disable.splice(0))stop();const errors:unknown[]=[];for(const s of stores.splice(0))if(!closed.has(s)){try{s.close();closed.add(s);}catch(raw){errors.push(raw);}}closed.clear();vi.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});if(errors.length)throw new AggregateError(errors,'fixture_cleanup_failed',{cause:errors[0]});});
function open(name='store'){const store=make(join(root,name+'.sqlite'));stores.push(store);return store;}
function catchRaw(fn:()=>unknown){try{return {caught:false,value:fn(),raw:undefined};}catch(raw){return {caught:true,value:undefined,raw};}}
function source(store:ReturnType<typeof make>){const collection=store.createCollection({name:'test',embeddingModelId:'test',embeddingDim:1},'user');return store.addSource({collectionId:collection.id,kind:'paste',title:'Original',text:'body'},'user');}
function write(store:ReturnType<typeof make>,id:string){return store.insertChunks(id,[{text:'body',idx:0,charStart:0,charEnd:4}], 'user');}
function breakRollback(store:ReturnType<typeof make>,after:boolean){
 const db=store._db as DatabaseSync,native=db.exec;let armed=true;disable.push(()=>{armed=false;});
 db.exec("CREATE TEMP TRIGGER reject_chunk BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT,'fixture_primary'); END;");
 vi.spyOn(db,'exec').mockImplementation(function(sql){if(armed&&sql==='ROLLBACK'){if(after)Reflect.apply(native,db,[sql]);throw undefined;}return Reflect.apply(native,db,[sql]);});
 return ()=>{armed=false;};
}
it.each([false,true])('keeps actual rollback failure held (%s post-call) while preserving the SQLite first error',after=>{
 const store=open(),id=source(store).id;breakRollback(store,after);
 const failure=catchRaw(()=>write(store,id));expect(failure.caught).toBe(true);expect((failure.raw as Error).message).toContain('fixture_primary');
 const next=catchRaw(()=>store.createCollection(new Proxy({} as never,{get(){throw Error('proxy_trap');}}),'user'));
 expect(next.caught).toBe(true);expect(next.raw).toBe(failure.raw);
 const unborn=join(root,'unborn.sqlite');const birth=catchRaw(()=>make(unborn));if(!birth.caught){stores.push(birth.value as ReturnType<typeof make>);}
 expect(birth.caught).toBe(true);expect(birth.raw).toBe(failure.raw);expect(fs.existsSync(unborn)).toBe(false);
});
it.each([false,true])('retains a bare undefined BEGIN failure without guessing whether SQLite entered (%s post-call)',after=>{
 const store=open(),id=source(store).id,db=store._db as DatabaseSync,native=db.exec;let armed=true;disable.push(()=>{armed=false;});
 vi.spyOn(db,'exec').mockImplementation(function(sql){if(armed&&sql==='BEGIN IMMEDIATE'){if(after)Reflect.apply(native,db,[sql]);throw undefined;}return Reflect.apply(native,db,[sql]);});
 const failure=catchRaw(()=>write(store,id));expect(failure.caught).toBe(true);expect(failure.raw).toBeUndefined();
 let traps=0;const next=catchRaw(()=>store.addSource(new Proxy({} as never,{get(){traps++;throw Error('trap');}}),'user'));
 expect(next.caught).toBe(true);expect(next.raw).toBeUndefined();expect(traps).toBe(0);
});
it('does not clear a held database when another original store actually closes',()=>{
 const held=open('held'),other=open('other'),id=source(held).id;breakRollback(held,false);
 const first=catchRaw(()=>write(held,id));other.close();closed.add(other);
 const next=catchRaw(()=>held.listCollections());expect(next.caught).toBe(true);expect(next.raw).toBe(first.raw);
});
it('only allows new birth after the same captured native close really returns',()=>{
 const store=open(),id=source(store).id;const disarm=breakRollback(store,false);const first=catchRaw(()=>write(store,id));expect(first.caught).toBe(true);
 disarm();store.close();closed.add(store);const next=open('replacement');expect(next.listCollections()).toEqual([]);
});
it('preserves a bare undefined business error when its owned transaction rolls back successfully',()=>{
 const store=open(),id=source(store).id,db=store._db as DatabaseSync,native=db.prepare;
 let armed=true;disable.push(()=>{armed=false;});
 vi.spyOn(db,'prepare').mockImplementation(function(sql){const stmt=Reflect.apply(native,db,[sql]);if(armed&&String(sql).includes('INSERT INTO chunks'))throw undefined;return stmt;});
 const failure=catchRaw(()=>write(store,id));expect(failure.caught).toBe(true);expect(failure.raw).toBeUndefined();
 armed=false;db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');expect(store.listChunks(id)).toEqual([]);
});
it('retains a bare undefined native-close failure until a genuine retry confirms closure',async()=>{
 // A fresh module captures the actual SDK close wrapper before any store birth.
 vi.resetModules();const original=DatabaseSync.prototype.close;let target:DatabaseSync|undefined,fail=true;
 vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(function(this:DatabaseSync){if(fail&&this===target)throw undefined;return Reflect.apply(original,this,[]);});
 disable.push(()=>{fail=false;});make=(await import('../../electron/kb-store-sqlite.js')).createKbStoreSqlite;
 const store=open();target=store._db as DatabaseSync;
 const failure=catchRaw(()=>store.close());expect(failure.caught).toBe(true);expect(failure.raw).toBeUndefined();
 const next=catchRaw(()=>store.listCollections());expect(next.caught).toBe(true);expect(next.raw).toBeUndefined();
 fail=false;store.close();closed.add(store);expect(open('after-close').listCollections()).toEqual([]);
});

it('rejects the original Source receipt after transaction uncertainty without replacing its identity',()=>{
 const store=open(),original=source(store),receipt=readReceipt(store,original,join(root,'store.sqlite'));
 receipt.assertLocal();receipt.assertCurrent();breakRollback(store,false);
 const first=catchRaw(()=>write(store,original.id));expect(first.caught).toBe(true);
 expect(catchRaw(()=>receipt.assertLocal())).toMatchObject({caught:true,raw:first.raw});
 expect(catchRaw(()=>readReceipt(store,original,join(root,'store.sqlite')))).toMatchObject({caught:true,raw:first.raw});
});
it('rejects non-void native close and retains its actual returned value before a genuine retry',async()=>{
 vi.resetModules();const original=DatabaseSync.prototype.close;let target:DatabaseSync|undefined,fail=true;const returned={unknown:'native-close'};
 vi.spyOn(DatabaseSync.prototype,'close').mockImplementation(function(this:DatabaseSync){if(fail&&this===target)return returned as never;return Reflect.apply(original,this,[]);});
 disable.push(()=>{fail=false;});make=(await import('../../electron/kb-store-sqlite.js')).createKbStoreSqlite;
 const store=open();target=store._db as DatabaseSync;
 const first=catchRaw(()=>store.close());expect(first.caught).toBe(true);expect((first.raw as Error).cause).toBe(returned);
 expect(catchRaw(()=>store.listCollections())).toMatchObject({caught:true,raw:first.raw});
 fail=false;store.close();closed.add(store);expect(open('after-real-close').listCollections()).toEqual([]);
});
