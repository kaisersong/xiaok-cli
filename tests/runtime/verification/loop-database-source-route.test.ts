import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
const leaf=vi.hoisted(()=>({kind:'ordinary' as 'ordinary'|'protected'|'unavailable',paths:[] as unknown[],opened:[] as import('node:sqlite').DatabaseSync[]}));
// SOURCE facts only. The real route guard is never mocked; no installation,
// system marker, native identity, helper or issuer is constructed.
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({
 ...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),
 readInstalledCurrentProfile:()=>({kind:leaf.kind}),
}));
// Observe actual native constructor attempts, delegating every open unchanged.
vi.mock('node:sqlite',async load=>{
 const actual=await load<typeof import('node:sqlite')>();
 return {...actual,DatabaseSync:new Proxy(actual.DatabaseSync,{construct(target,args){
  leaf.paths.push(args[0]);const db:import('node:sqlite').DatabaseSync=Reflect.construct(target,args);leaf.opened.push(db);return db;
 }})};
});
import {createLoopDatabaseOwnerGroup,openLoopDatabase} from '../../../desktop/electron/loop-database-owner.js';
let root:string;const closes:(()=>void)[]=[];
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'loop-ordinary-route-')));leaf.kind='ordinary';leaf.paths.length=0;leaf.opened.length=0;});
afterEach(()=>{leaf.kind='ordinary';try{for(const close of closes.splice(0).reverse())close();}finally{rmSync(root,{recursive:true,force:true});}});
// Even an original-source RED that unexpectedly returns a DB cleans its own DB.
function denied(work:()=>{close():void}){let unexpected:undefined|{close():void};try{expect(()=>{unexpected=work();}).toThrow('ordinary_source_route');}finally{unexpected?.close();}}
it.each(['protected','unavailable'] as const)('denies %s before real group path creation or SQLite open',kind=>{
 leaf.kind=kind;const path=join(root,'not-created','group.sqlite');
 denied(()=>createLoopDatabaseOwnerGroup([path]));expect(leaf.paths).toEqual([]);expect(existsSync(dirname(path))).toBe(false);expect(readdirSync(root)).toEqual([]);
});
it.each(['protected','unavailable'] as const)('denies %s string standalone open without files or SQL',kind=>{
 leaf.kind=kind;const path=join(root,'not-created','standalone.sqlite');
 denied(()=>openLoopDatabase(path));expect(leaf.paths).toEqual([]);expect(existsSync(dirname(path))).toBe(false);expect(readdirSync(root)).toEqual([]);
});
it.each(['protected','unavailable'] as const)('denies a fresh lease from an existing source after route changes to %s',kind=>{
 const path=join(root,'existing.sqlite'),group=createLoopDatabaseOwnerGroup([path]);closes.push(()=>group.close());
 const existing=openLoopDatabase(group.sources[0]!);closes.push(()=>existing.close());existing.database.exec("CREATE TABLE sentinel(value TEXT);INSERT INTO sentinel VALUES('original')");
 const opens=leaf.paths.length;leaf.kind=kind;
 let leaked:ReturnType<typeof openLoopDatabase>|undefined;
 try{expect(()=>{leaked=openLoopDatabase(group.sources[0]!);leaked.database.exec("INSERT INTO sentinel VALUES('forbidden')");}).toThrow('ordinary_source_route');}finally{leaked?.close();}
 expect(leaf.paths).toHaveLength(opens);expect(existing.database.prepare('SELECT value FROM sentinel').all()).toEqual([{value:'original'}]);
});
it.each(['protected','unavailable'] as const)('rechecks the second group input after its getter switches route to %s',kind=>{
 const first=join(root,'first','one.sqlite'),second=join(root,'second','two.sqlite'),paths=[first,second];
 Object.defineProperty(paths,'1',{enumerable:true,configurable:true,get(){leaf.kind=kind;return second;}});
 denied(()=>createLoopDatabaseOwnerGroup(paths));
 expect(leaf.paths).toEqual([first]);expect(existsSync(first)).toBe(true);expect(existsSync(dirname(second))).toBe(false);
 expect(()=>leaf.opened[0]!.prepare('SELECT 1')).toThrow();
});
it.each(['disk','memory'] as const)('preserves ordinary %s sharing, actual SQL, sibling leases and close semantics',mode=>{
 const path=mode==='memory'?':memory:':join(root,'ordinary.sqlite'),group=createLoopDatabaseOwnerGroup([path,path]);closes.push(()=>group.close());
 const a=openLoopDatabase(group.sources[0]!),b=openLoopDatabase(group.sources[1]!);closes.push(()=>a.close(),()=>b.close());
 expect(a.database).toBe(b.database);a.database.exec("CREATE TABLE sentinel(value TEXT);INSERT INTO sentinel VALUES('original')");a.close();
 expect(b.database.prepare('SELECT value FROM sentinel').all()).toEqual([{value:'original'}]);expect(()=>a.database).toThrow('loop_database_closed');
 group.close();expect(()=>openLoopDatabase(group.sources[0]!)).toThrow('loop_database_closed');
});
it('retains ordinary invalid path and borrowed source errors',()=>{
 expect(()=>createLoopDatabaseOwnerGroup([''])).toThrow('loop_database_path');expect(()=>openLoopDatabase({} as never)).toThrow('loop_database_source');expect(leaf.paths).toEqual([]);
});
