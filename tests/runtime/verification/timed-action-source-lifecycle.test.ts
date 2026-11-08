import {afterAll,afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const faults=vi.hoisted(()=>({home:'',route:'ordinary',calls:0,routeCalls:0,revokeAt:0,constructorFault:'' as string,sqlFault:'' as string,sqlPhase:'before',closeFault:'',closeReturn:undefined as unknown,raw:undefined as unknown,cleanup:undefined as unknown,created:[] as object[],closes:0,failSync:false,revokeOnSync:false,routeThrow:false}));
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return {...actual,userInfo:()=>({...actual.userInfo(),homedir:faults.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>{if(faults.routeThrow)throw faults.raw;return {kind:++faults.routeCalls===faults.revokeAt?'protected':faults.route};}}));
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return {...actual,fsyncSync:(fd:number)=>{if(faults.failSync&&actual.fstatSync(fd).isDirectory())throw faults.raw;const result=actual.fsyncSync(fd);if(faults.revokeOnSync&&actual.fstatSync(fd).isDirectory())faults.route='protected';return result;}};});
vi.mock('node:sqlite',async load=>{const actual=await load<typeof import('node:sqlite')>();class ObservedDatabase extends actual.DatabaseSync {
 constructor(...args:ConstructorParameters<typeof actual.DatabaseSync>){faults.calls++;if(faults.constructorFault==='before')throw faults.raw;super(...args);faults.created.push(this);if(faults.constructorFault==='after')throw faults.raw;}
 exec(sql:string){const fail=faults.sqlFault&&sql.includes(faults.sqlFault);if(fail&&faults.sqlPhase==='before')throw faults.raw;const result=super.exec(sql);if(fail&&faults.sqlPhase==='after')throw faults.raw;return result;}
 close(){faults.closes++;if(faults.closeFault==='before')throw faults.cleanup;const result=super.close();if(faults.closeFault==='after')throw faults.cleanup;return faults.closeReturn??result;}
 }return {...actual,DatabaseSync:ObservedDatabase};});
const actualSQLite=await vi.importActual<typeof import('node:sqlite')>('node:sqlite'),rawClose=actualSQLite.DatabaseSync.prototype.close;
const posix=process.platform!=='win32';
const root=realpathSync(mkdtempSync(join(tmpdir(),'timed-lifecycle-')));let serial=0;
beforeEach(()=>{vi.resetModules();faults.home=join(root,'account-'+serial++);mkdirSync(faults.home,{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(faults.home,'.xiaok');faults.route='ordinary';faults.calls=0;faults.routeCalls=0;faults.revokeAt=0;faults.sqlFault='';faults.constructorFault='';faults.closeFault='';faults.closeReturn=undefined;faults.sqlPhase='before';faults.raw=undefined;faults.cleanup=undefined;faults.created=[];faults.closes=0;faults.failSync=false;faults.revokeOnSync=false;faults.routeThrow=false;});
afterEach(()=>{for(const db of faults.created)try{Reflect.apply(rawClose,db,[]);}catch{/* Only exact test-born DBs; production held state is not declared known by this cleanup. */}});
afterAll(()=>rmSync(root,{recursive:true,force:true}));
const file=()=>join(faults.home,'data','timed.sqlite');
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function load(){return (await import('../../../desktop/electron/timed-action-store.js')).TimedActionStore;}
function thrown(work:()=>unknown){let present=false,raw:unknown;try{work();}catch(error){present=true;raw=error;}expect(present).toBe(true);return raw;}
it.each(['before','after'])('preserves bare undefined at actual SQL %s entry and closes the same original DB',async phase=>{
 const Store=await load(),path=file();faults.sqlFault='create table if not exists timed_actions';faults.sqlPhase=phase;
 expect(thrown(()=>new Store(path))).toBeUndefined();expect(faults.calls).toBe(1);expect(faults.closes).toBe(1);
 faults.sqlFault='';await tick();const store=new Store(path);try{expect(store.listActions()).toEqual([]);}finally{store.close();}
});
it.each(['before','after'])('keeps constructor-entered/no-handle %s unknown sticky without reentering SQLite',async phase=>{
 const Store=await load(),path=file();faults.constructorFault=phase;
 expect(thrown(()=>new Store(path))).toBeUndefined();faults.constructorFault='';await tick();expect(()=>new Store(path)).toThrow('initialization_unknown');expect(faults.calls).toBe(1);expect(faults.closes).toBe(0);
});
it.each(['before','after'])('holds an actual close %s bare undefined with both raw presences and no fresh birth',async phase=>{
 const Store=await load(),path=file();faults.sqlFault='create table if not exists timed_actions';faults.closeFault=phase;
 const error=thrown(()=>new Store(path)) as AggregateError;expect(error).toBeInstanceOf(AggregateError);expect(error.errors).toEqual([undefined,undefined]);expect(Object.hasOwn(error,'cause')).toBe(true);expect(error.cause).toBeUndefined();
 faults.closeFault='';faults.sqlFault='';await tick();expect(()=>new Store(path)).toThrow('initialization_unknown');expect(faults.calls).toBe(1);expect(faults.closes).toBe(1);
});
it('retains the original error symbol Promise until its physical tail settles before allowing a new birth',async()=>{
 const Store=await load(),path=file();let release!:()=>void;const tail=new Promise<void>(yes=>release=yes),primary=Object.assign(Error('original'),{[Symbol('held')]:tail});faults.sqlFault='create table if not exists timed_actions';faults.raw=primary;
 expect(thrown(()=>new Store(path))).toBe(primary);faults.sqlFault='';await tick();expect(()=>new Store(path)).toThrow('initialization_unknown');expect(faults.calls).toBe(1);release();await tail;await tick();const next=new Store(path);next.close();expect(faults.calls).toBe(2);
});
it('keeps unknown accessor evidence sticky even after the accessor disappears; getter is never invoked',async()=>{
 const Store=await load(),path=file(),raw=Error('raw');let getters=0;Object.defineProperty(raw,'later',{configurable:true,get(){getters++;return 1;}});faults.sqlFault='create table if not exists timed_actions';faults.raw=raw;
 expect(thrown(()=>new Store(path))).toBe(raw);delete (raw as unknown as Record<string,unknown>).later;faults.sqlFault='';await tick();expect(()=>new Store(path)).toThrow('initialization_unknown');expect(getters).toBe(0);expect(faults.calls).toBe(1);expect(faults.closes).toBe(1);
});
it('rejects the actual post-schema route change, closes the DB and publishes no source observation',async()=>{
 const Store=await load(),path=file();faults.revokeAt=2;expect(()=>new Store(path)).toThrow('ordinary_source_route');expect(faults.closes).toBe(1);
 const {readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');if(posix)expect(readOrdinaryProfileSources()).toBeUndefined();else expect(existsSync(join(process.env.XIAOK_CONFIG_DIR!,'profile-sources','registry.json'))).toBe(false);
 const db=new actualSQLite.DatabaseSync(path,{readOnly:true});try{expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(6);}finally{rawClose.call(db);}
});
it('does not consult a tampered public close method for the already captured negative consumer',async()=>{
 const Store=await load(),path=file(),sqlite=await import('node:sqlite'),original=sqlite.DatabaseSync.prototype.close;const trap=vi.fn(()=>{throw Error('public close trap');});sqlite.DatabaseSync.prototype.close=trap;
 faults.sqlFault='create table if not exists timed_actions';try{expect(thrown(()=>new Store(path))).toBeUndefined();expect(trap).not.toHaveBeenCalled();expect(faults.closes).toBe(1);}finally{sqlite.DatabaseSync.prototype.close=original;}
});

it.skipIf(!posix)('attempts captured close after actual observer fsync failure and preserves its original primary',async()=>{
 const Store=await load(),path=file(),primary=Error('actual registry sync');faults.raw=primary;faults.failSync=true;expect(thrown(()=>new Store(path))).toBe(primary);expect(faults.closes).toBe(1);faults.failSync=false;
 const db=new actualSQLite.DatabaseSync(path,{readOnly:true});try{expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(6);}finally{rawClose.call(db);}
});
it.skipIf(!posix)('rechecks the original route after observation and still closes after the positive route is revoked',async()=>{
 const Store=await load(),path=file();faults.revokeOnSync=true;expect(()=>new Store(path)).toThrow('ordinary_source_route');expect(faults.closes).toBe(1);expect(faults.calls).toBe(1);
});

it('does not turn a nonvoid SDK close result into known merely because the original DB closed',async()=>{
 const Store=await load(),path=file(),primary=Error('primary');let release!:()=>void;const raw=new Promise<void>(yes=>release=yes);faults.closeReturn=raw;faults.raw=primary;faults.sqlFault='create table if not exists timed_actions';
 const failure=thrown(()=>new Store(path)) as AggregateError;expect(failure.cause).toBe(primary);expect(failure.errors[0]).toBe(primary);expect(failure.errors[1].cause).toBe(raw);faults.closeReturn=undefined;faults.sqlFault='';release();await raw;await tick();expect(()=>new Store(path)).toThrow('initialization_unknown');expect(faults.calls).toBe(1);expect(faults.closes).toBe(1);
});

it('holds original pre-open route SDK error tails without entering SQLite or creating a directory',async()=>{
 const Store=await load(),path=file();let release!:()=>void;const tail=new Promise<void>(yes=>release=yes),primary=Object.assign(Error('route SDK'),{[Symbol('held')]:tail});faults.raw=primary;faults.routeThrow=true;expect(thrown(()=>new Store(path))).toBe(primary);expect(faults.calls).toBe(0);expect(existsSync(join(faults.home,'data'))).toBe(false);
 faults.routeThrow=false;await tick();expect(()=>new Store(path)).toThrow('initialization_unknown');expect(faults.calls).toBe(0);release();await tail;await tick();const next=new Store(path);next.close();expect(faults.calls).toBe(1);
});
