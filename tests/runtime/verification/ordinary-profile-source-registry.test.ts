import {setProfileTestHome} from '../../support/profile-home-env.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {once} from 'node:events';
import {renameSync,realpathSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const state=vi.hoisted(()=>({home:'',route:'ordinary',failDirectorySync:false,failRegistryFileSync:false,onDirectorySync:undefined as undefined|(()=>void),deviceOffset:0n,devicePaths:new Set<string>(),descriptorPaths:new Map<number,string>()}));
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return{...actual,lstatSync:(path:any,options?:any)=>{const stat=actual.lstatSync(path,options);if(!state.deviceOffset||!state.devicePaths.has(String(path)))return stat;return new Proxy(stat,{get(target,key){if(key==='dev')return typeof target.dev==='bigint'?target.dev+state.deviceOffset:target.dev+Number(state.deviceOffset);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});},openSync:((path:any,...args:any[])=>{const fd=(actual.openSync as Function)(path,...args);state.descriptorPaths.set(fd,String(path));return fd;}) as typeof actual.openSync,closeSync:(fd:number)=>{state.descriptorPaths.delete(fd);actual.closeSync(fd);},fsyncSync:(fd:number)=>{const directory=actual.fstatSync(fd).isDirectory();if(directory)state.onDirectorySync?.();if(state.failDirectorySync&&directory)throw Error('actual registry directory sync failed');if(state.failRegistryFileSync&&state.descriptorPaths.get(fd)?.includes('.registry.json.'))throw Object.assign(Error('actual registry file sync failed'),{code:'ENOTSUP'});actual.fsyncSync(fd);}};});
vi.mock('node:os',async load=>{const actual=await load<typeof import('node:os')>();return{...actual,userInfo:()=>({...actual.userInfo(),homedir:state.home})};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:state.route})}));
import {registerOrdinaryProfileSource,readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'profile-source-registry-')));state.home=join(root,'account');setProfileTestHome(state.home);mkdirSync(state.home);state.route='ordinary';state.failDirectorySync=false;state.failRegistryFileSync=false;state.onDirectorySync=undefined;state.deviceOffset=0n;state.devicePaths.clear();state.descriptorPaths.clear();});
afterEach(()=>{rmSync(root,{recursive:true,force:true});vi.unstubAllEnvs();});
function source(name:string){const p=join(root,name);mkdirSync(p);return p;}
it('keeps distinct registries for explicit config directories',()=>{
 const a=source('old'),b=source('new');vi.stubEnv('XIAOK_CONFIG_DIR',a);vi.stubEnv('HOME',a);registerOrdinaryProfileSource({kind:'session-root',directory:a});
 vi.stubEnv('XIAOK_CONFIG_DIR',b);vi.stubEnv('HOME',b);registerOrdinaryProfileSource({kind:'task-root',directory:b});
 const facts=readOrdinaryProfileSources();expect(facts?.sources).toHaveLength(1);expect(facts?.generation).toBe('1');expect(facts?.legacyInventoryRequired).toBe(true);expect(readFileSync(join(a,'profile-sources','registry.json'),'utf8')).toContain('old');expect(facts?.sources[0]!.directory.canonicalPath).toBe(b);
});
it('does not declare absent inventory complete and does not issue snapshot hashes',()=>{
 expect(readOrdinaryProfileSources()).toBeUndefined();const directory=source('source');registerOrdinaryProfileSource({kind:'session-root',directory});registerOrdinaryProfileSource({kind:'session-root',directory});
 const facts=readOrdinaryProfileSources()!;expect(facts.generation).toBe('1');expect(facts.legacyInventoryRequired).toBe(true);expect(facts.sources[0]).not.toHaveProperty('reviewedSnapshotSha256');
});
it('retains separate same-directory SQLite and Session original lock domains',()=>{
 const directory=source('db');writeFileSync(join(directory,'sessions.sqlite'),'original SQLite identity');registerOrdinaryProfileSource({kind:'session-root',directory});registerOrdinaryProfileSource({kind:'sqlite-db',directory,databaseBasename:'sessions.sqlite',snapshotFormat:'session-sqlite-v1'});expect(readOrdinaryProfileSources()!.sources).toHaveLength(2);
});
it('rejects pending/protected/offline registration without changing old registry',()=>{
 const directory=source('source');registerOrdinaryProfileSource({kind:'session-root',directory});const before=readOrdinaryProfileSources();for(const route of ['protected','unavailable']){state.route=route;expect(()=>registerOrdinaryProfileSource({kind:'task-root',directory})).toThrow('profile_source_registry_route');expect(readOrdinaryProfileSources()).toEqual(before);}
});
it('rejects corrupt registry and path symlink after rebinding a reused path',()=>{
 const directory=source('source');registerOrdinaryProfileSource({kind:'session-root',directory});renameSync(directory,directory+'-old');mkdirSync(directory);registerOrdinaryProfileSource({kind:'session-root',directory});expect(readOrdinaryProfileSources()!.generation).toBe('2');
 const link=join(root,'alias');symlinkSync(directory,link);expect(()=>registerOrdinaryProfileSource({kind:'task-root',directory:link})).toThrow('profile_source_registry_identity');
 writeFileSync(join(state.home,'.xiaok/profile-sources/registry.json'),'{}');expect(()=>registerOrdinaryProfileSource({kind:'task-root',directory})).toThrow('profile_source_registry_schema');
});
it('rebinds one directory namespace after device-only renumbering',()=>{
 const path=source('device-rebind'),directory=realpathSync(path);registerOrdinaryProfileSource({kind:'session-root',directory});const before=readOrdinaryProfileSources()!,first=before.sources[0]!;
 state.devicePaths.add(directory);state.deviceOffset=1n;registerOrdinaryProfileSource({kind:'session-root',directory});const rebound=readOrdinaryProfileSources()!,current=rebound.sources[0]!;
 expect(rebound.sources).toHaveLength(1);expect(rebound.generation).toBe('2');expect(current.namespaceId).toBe(first.namespaceId);expect(current.sourceId).not.toBe(first.sourceId);expect(current.directory).toEqual({...first.directory,device:String(BigInt(first.directory.device)+1n)});
 registerOrdinaryProfileSource({kind:'session-root',directory});expect(readOrdinaryProfileSources()!.generation).toBe('2');
});
it('preserves SQLite layout history across one coherent device renumbering',async()=>{
 const {registerOrdinarySQLiteLayout}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const {createHash}=await import('node:crypto');const directory=source('sqlite-device-rebind'),database=join(directory,'loop.sqlite');writeFileSync(database,'physical identity');const input={kind:'sqlite-db' as const,directory,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const},tuple={version:1 as const,components:['loop' as const],layoutRevision:1},layout={...tuple,layoutHash:createHash('sha256').update(JSON.stringify(tuple)).digest('hex')};
 registerOrdinarySQLiteLayout(input,layout);const before=readOrdinaryProfileSources()!,first=before.sources[0]!;state.devicePaths.add(realpathSync(directory));state.devicePaths.add(database);state.deviceOffset=1n;const expectedDevice=String(BigInt(first.database!.device)+1n);registerOrdinarySQLiteLayout(input,layout,`${expectedDevice}:${first.database!.inode}`);const rebound=readOrdinaryProfileSources()!,current=rebound.sources[0]!;
 expect(rebound.version).toBe(2);expect(rebound.generation).toBe('2');expect(rebound.sources).toHaveLength(1);expect(current.sourceId).not.toBe(first.sourceId);expect(current.componentHistory).toEqual(first.componentHistory);expect(current.directory.device).toBe(String(BigInt(first.directory.device)+1n));expect(current.database?.device).toBe(expectedDevice);
 registerOrdinarySQLiteLayout(input,layout,`${current.database!.device}:${current.database!.inode}`);expect(readOrdinaryProfileSources()!.generation).toBe('2');
});
it('replaces stale partial device and database identities',()=>{
 const directory=source('sqlite-partial-device'),database=join(directory,'sessions.sqlite');writeFileSync(database,'first');const input={kind:'sqlite-db' as const,directory,databaseBasename:'sessions.sqlite',snapshotFormat:'session-sqlite-v1' as const};registerOrdinaryProfileSource(input);
 state.devicePaths.add(realpathSync(directory));state.deviceOffset=1n;registerOrdinaryProfileSource(input);expect(readOrdinaryProfileSources()!.generation).toBe('2');
 state.devicePaths.add(database);registerOrdinaryProfileSource({...input,snapshotFormat:'goal-sqlite-v1'});expect(readOrdinaryProfileSources()!.generation).toBe('3');
 renameSync(database,database+'.old');writeFileSync(database,'second');registerOrdinaryProfileSource(input);expect(readOrdinaryProfileSources()!.generation).toBe('4');expect(readOrdinaryProfileSources()!.sources).toHaveLength(1);
});

it('requires the durable directory barrier again after visible rename with failed fsync',()=>{
 const directory=source('source');state.failDirectorySync=true;expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory})).toThrow('actual registry directory sync failed');
 expect(readOrdinaryProfileSources()!.sources).toHaveLength(1);expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory})).toThrow('actual registry directory sync failed');
 state.failDirectorySync=false;registerOrdinaryProfileSource({kind:'session-root',directory});expect(readOrdinaryProfileSources()!.generation).toBe('1');
});
it('does not mistake an unsupported file fsync for ordinary directory compatibility',()=>{
 const directory=source('file-fsync');state.failRegistryFileSync=true;
 expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory})).toThrow('actual registry file sync failed');expect(readOrdinaryProfileSources()).toBeUndefined();
});

it('retains its original lock when the registry directory is replaced and never unlinks the replacement',()=>{
 const directory=source('source'),fixed=join(state.home,'.xiaok/profile-sources'),old=fixed+'-old';
 state.onDirectorySync=()=>{state.onDirectorySync=undefined;renameSync(fixed,old);mkdirSync(fixed);writeFileSync(join(fixed,'.profile-source-registry.lock'),'foreign marker');};
 expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory})).toThrow('profile_source_registry_identity');
 expect(readFileSync(join(fixed,'.profile-source-registry.lock'),'utf8')).toBe('foreign marker');expect(JSON.parse(readFileSync(join(old,'.profile-source-registry.lock'),'utf8')).pid).toBe(process.pid);
});
it('recovers a retained registry lock only after the actual owning process exits',async()=>{
 const {spawn}=await import('node:child_process');const directory=source('source'),fixed=join(state.home,'.xiaok/profile-sources'),old=fixed+'-old';
 const code=`import os from 'node:os';import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const originalInfo=os.userInfo.bind(os);os.userInfo=()=>({...originalInfo(),homedir:${JSON.stringify(state.home)}});const originalSync=fs.fsyncSync.bind(fs);let moved=false;fs.fsyncSync=fd=>{if(!moved&&fs.fstatSync(fd).isDirectory()){moved=true;fs.renameSync(${JSON.stringify(fixed)},${JSON.stringify(old)});fs.mkdirSync(${JSON.stringify(fixed)});fs.writeFileSync(${JSON.stringify(join(fixed,'.profile-source-registry.lock'))},'foreign');}return originalSync(fd);};syncBuiltinESMExports();const{registerOrdinaryProfileSource}=await import(${JSON.stringify(new URL('../../../src/runtime/verification/ordinary-profile-source-registry.ts',import.meta.url).href)});try{registerOrdinaryProfileSource({kind:'session-root',directory:${JSON.stringify(directory)}});process.stdout.write('unexpected');}catch(error){process.stdout.write(String(error.message));}process.stdin.resume();await new Promise(resolve=>process.stdin.once('end',resolve));`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});let errors='';child.stderr.on('data',chunk=>{errors+=String(chunk);});const exited=once(child,'exit');
 try{const[data]=await once(child.stdout,'data');expect(String(data),errors).toContain('profile_source_registry_identity');rmSync(fixed,{recursive:true});renameSync(old,fixed);
  expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory})).toThrow('session_save_locked');child.stdin.end();const[status]=await exited;expect(status,errors).toBe(0);
  registerOrdinaryProfileSource({kind:'session-root',directory});expect(readOrdinaryProfileSources()!.generation).toBe('1');
 }finally{if(child.exitCode===null){child.stdin.end();child.kill();await exited;}}
},15000);
it('preserves observed SQLite layouts cumulatively without declaring old history complete',async()=>{
 const api=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const register=(api as unknown as {registerOrdinarySQLiteLayout?:Function}).registerOrdinarySQLiteLayout;expect(typeof register).toBe('function');const {createHash}=await import('node:crypto');const directory=source('layouts');writeFileSync(join(directory,'loop.sqlite'),'physical identity');const input={kind:'sqlite-db' as const,directory,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const};registerOrdinaryProfileSource(input);const observe=(components:string[])=>{const tuple={version:1,components:[...components].sort(),layoutRevision:components.length};return{...tuple,layoutHash:createHash('sha256').update(JSON.stringify(tuple)).digest('hex')};};
 register!(input,observe(['loop']));register!(input,observe(['loop','completion']));register!(input,observe(['loop']));const facts=readOrdinaryProfileSources()!;expect(facts.version).toBe(2);expect(facts.legacyInventoryRequired).toBe(true);expect(facts.sources[0]).toHaveProperty('componentHistory',{historyUnknown:true,components:['completion','loop'],observations:[observe(['loop']),observe(['loop','completion'])].sort((a,b)=>a.layoutHash.localeCompare(b.layoutHash))});const generation=facts.generation;registerOrdinaryProfileSource(input);expect(readOrdinaryProfileSources()!.generation).toBe(generation);
});
it('rejects forged layout bytes and keeps the old complete observation array on fsync failure',async()=>{
 const {registerOrdinarySQLiteLayout}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const{createHash}=await import('node:crypto');const directory=source('layouts-fsync');writeFileSync(join(directory,'loop.sqlite'),'physical identity');const input={kind:'sqlite-db' as const,directory,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const};registerOrdinaryProfileSource(input);const tuple={version:1 as const,components:['completion' as const],layoutRevision:1},layout={...tuple,layoutHash:createHash('sha256').update(JSON.stringify(tuple)).digest('hex')};
 expect(()=>registerOrdinarySQLiteLayout(input,{...layout,layoutHash:'0'.repeat(64)})).toThrow('profile_source_registry_schema');expect(readOrdinaryProfileSources()!.generation).toBe('1');state.failDirectorySync=true;expect(()=>registerOrdinarySQLiteLayout(input,layout)).toThrow('actual registry directory sync failed');expect(()=>registerOrdinarySQLiteLayout(input,layout)).toThrow('actual registry directory sync failed');state.failDirectorySync=false;registerOrdinarySQLiteLayout(input,layout);expect(readOrdinaryProfileSources()!.generation).toBe('2');expect(readOrdinaryProfileSources()!.sources[0].componentHistory?.historyUnknown).toBe(true);
});
it('rejects a layout observation whose original physical database was replaced before registration',async()=>{
 const {registerOrdinarySQLiteLayout}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');const{createHash}=await import('node:crypto');const{lstatSync}=await import('node:fs');const directory=source('layouts-physical'),file=join(directory,'loop.sqlite');writeFileSync(file,'first');const stat=lstatSync(file,{bigint:true}),input={kind:'sqlite-db' as const,directory,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const};renameSync(file,file+'.old');writeFileSync(file,'second');const tuple={version:1 as const,components:['loop' as const],layoutRevision:1},layout={...tuple,layoutHash:createHash('sha256').update(JSON.stringify(tuple)).digest('hex')};expect(()=>registerOrdinarySQLiteLayout(input,layout,`${stat.dev}:${stat.ino}`)).toThrow('profile_source_registry_identity');expect(readOrdinaryProfileSources()).toBeUndefined();
});
it('merges two actual process observations under the original registry lock without losing either',async()=>{
 const{spawn}=await import('node:child_process');const directory=source('parallel-layout');writeFileSync(join(directory,'loop.sqlite'),'same actual file');registerOrdinaryProfileSource({kind:'sqlite-db',directory,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1'});
 const run=(component:string)=>{const code=`import os from 'node:os';import{syncBuiltinESMExports}from'node:module';import{createHash}from'node:crypto';const info=os.userInfo.bind(os);os.userInfo=()=>({...info(),homedir:${JSON.stringify(state.home)}});syncBuiltinESMExports();const{registerOrdinarySQLiteLayout}=await import(${JSON.stringify(new URL('../../../src/runtime/verification/ordinary-profile-source-registry.ts',import.meta.url).href)});process.stdout.write('ready');await new Promise(r=>process.stdin.once('data',r));const tuple={version:1,components:[${JSON.stringify(component)}],layoutRevision:1};const layout={...tuple,layoutHash:createHash('sha256').update(JSON.stringify(tuple)).digest('hex')};for(let i=0;;i++){try{registerOrdinarySQLiteLayout({kind:'sqlite-db',directory:${JSON.stringify(directory)},databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1'},layout);break;}catch(error){if(i>=100||error.message!=='session_save_locked')throw error;await new Promise(r=>setTimeout(r,5));}}process.stdin.destroy();`;const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});let errors='';child.stderr.on('data',chunk=>errors+=String(chunk));return{child,ready:once(child.stdout,'data'),exit:once(child,'exit'),errors:()=>errors};};
 const children=[run('loop'),run('completion')];try{await Promise.all(children.map(child=>child.ready));for(const child of children)child.child.stdin.write('go');for(const child of children){const[status]=await child.exit;expect(status,child.errors()).toBe(0);}expect(readOrdinaryProfileSources()!.sources[0].componentHistory).toMatchObject({historyUnknown:true,components:['completion','loop']});expect(readOrdinaryProfileSources()!.generation).toBe('3');}finally{for(const child of children)if(child.child.exitCode===null)child.child.kill();}
},15000);
it('registers the exact independent alias marker directory without claiming complete history',async()=>{
 const holder=source('holder'),directory=join(holder,'.canonical-session-aliases');mkdirSync(directory);
 registerOrdinaryProfileSource({kind:'session-alias-holder',directory});const actual=readOrdinaryProfileSources()!;
 expect(actual.sources[0]).toMatchObject({kind:'session-alias-holder',snapshotFormat:'session-alias-holder-v1',directory:{canonicalPath:directory}});
 const {parseOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js');expect(parseOrdinaryProfileSources(JSON.parse(readFileSync(join(state.home,'.xiaok/profile-sources/registry.json'),'utf8')),actual.uid)).toEqual(actual);expect(actual.legacyInventoryRequired).toBe(true);
 expect(()=>registerOrdinaryProfileSource({kind:'session-alias-holder',directory:holder})).toThrow('profile_source_registry_identity');
});
