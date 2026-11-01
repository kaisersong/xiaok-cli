import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {registerOrdinaryProfileSource,readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const state=vi.hoisted(()=>({stats:new Map<string,bigint>(),errors:new Map<string,string>(),template:'',bug:false,capacitySuffix:false,calls:0,warn:vi.fn()}));
vi.mock('node:fs',async load=>{const fs=await load<typeof import('node:fs')>();return {...fs,
 lstatSync:(path:string,options:unknown)=>{if(state.bug&&path.endsWith('/bug'))throw new TypeError('sweep bug');const code=state.errors.get(path);if(code)throw Object.assign(Error(code),{code});const ino=state.stats.get(path);if(ino!==undefined){const stat=fs.lstatSync(state.template,options as never);return new Proxy(stat,{get(target,key){if(key==='ino')return typeof target.ino==='bigint'?ino:Number(ino);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}return fs.lstatSync(path,options as never);},
 realpathSync:(path:string)=>state.stats.has(path)?path:fs.realpathSync(path)};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
vi.mock('../../../src/utils/logger.js',()=>({createLogger:()=>({warn:state.warn})}));
vi.mock('../../../src/runtime/verification/ordinary-profile-source-storage-codec.js',async load=>{const codec=await load<typeof import('../../../src/runtime/verification/ordinary-profile-source-storage-codec.js')>();return {...codec,serializeOrdinaryProfileSourceStorage:(...args:Parameters<typeof codec.serializeOrdinaryProfileSourceStorage>)=>{state.calls++;try{return codec.serializeOrdinaryProfileSourceStorage(...args);}catch(error){if(state.capacitySuffix&&error instanceof Error&&error.message.startsWith('profile_source_registry_capacity'))throw Error(error.message+': context');throw error;}}};});
let root:string,registry:string;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const register=(directory:string)=>registerOrdinaryProfileSource({kind:'session-root',directory});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'registry-prune-')));vi.stubEnv('HOME',root);vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'.xiaok'));vi.stubEnv('XDG_CONFIG_HOME',join(root,'config'));vi.stubEnv('XDG_DATA_HOME',join(root,'data'));vi.stubEnv('XDG_CACHE_HOME',join(root,'cache'));state.bug=false;state.capacitySuffix=false;state.calls=0;state.warn.mockClear();state.template=root;state.stats.clear();state.errors.clear();registry=join(root,'.xiaok','profile-sources','registry.json');});
afterEach(()=>{vi.unstubAllEnvs();state.stats.clear();state.errors.clear();rmSync(root,{recursive:true,force:true,maxRetries:3});});
function seed(){
 const directory=join(root,'initial');mkdirSync(directory);register(directory);
 const dev=String(lstatSync(root,{bigint:true}).dev);
 const paths=[1,2].map(n=>join(root,String(n).repeat(240000)));
 const sources=paths.map((canonicalPath,index)=>{const inode=String(1000+index);state.stats.set(canonicalPath,BigInt(inode));return {sourceId:hash(['session-root',dev,inode,null]),namespaceId:hash([canonicalPath,'session-root',null]),kind:'session-root',directory:{canonicalPath,device:dev,inode},snapshotFormat:'session-root-v1'};});
 writeFileSync(registry,JSON.stringify({version:1,uid:userInfo().uid,generation:'1',legacyInventoryRequired:true,sources}));
 const current=join(root,'3'.repeat(80000));state.stats.set(current,1002n);return {paths,current};
}
it('prunes the whole table across 200 deleted temporary sources',()=>{
 const directories=Array.from({length:200},()=>mkdtempSync(join(root,'source-')));
 for(const directory of directories){register(directory);expect(readOrdinaryProfileSources()!.sources).toHaveLength(1);rmSync(directory,{recursive:true});}
 expect(readFileSync(registry).length).toBeLessThan(2048);
});
it.each(['EACCES','EIO'])('retains unrelated rows on %s while still pruning missing rows',code=>{
 const paths=['denied','missing','current'].map(name=>join(root,name));for(const path of paths)mkdirSync(path);
 register(paths[0]!);register(paths[1]!);rmSync(paths[1]!,{recursive:true});state.errors.set(paths[0]!,code);
 register(paths[2]!);expect(readOrdinaryProfileSources()!.sources.map(row=>row.directory.canonicalPath)).toEqual([paths[0],paths[2]]);
});
it('evicts oldest persisted registration without refreshing no-op LRU',()=>{
 const {paths,current}=seed();register(paths[0]!);register(current);
 expect(readOrdinaryProfileSources()!.sources.map(row=>row.directory.canonicalPath)).toEqual([paths[1],current]);
 expect(readFileSync(registry).length).toBeLessThanOrEqual(512*1024);
});
it('reports registry path and recovery advice when the current source alone cannot fit',()=>{
 seed();const current=join(root,'4'.repeat(530000));state.stats.set(current,1003n);const before=readFileSync(registry);
 expect(()=>register(current)).toThrow(/profile_source_registry_capacity.*current source.*exceeds.*registry\.json/i);
 expect(readFileSync(registry)).toEqual(before);
});
it('reports a useful error for an existing oversized registry without reading it',()=>{
 seed();writeFileSync(registry,' '.repeat(512*1024+1));
 expect(()=>readOrdinaryProfileSources()).toThrow(/profile_source_registry_identity.*registry.*full.*registry\.json.*(remove|move)/i);
});

it('does not rewrite bytes or generation for an unchanged non-tail row',()=>{
 const paths=['a','b'].map(name=>join(root,name));for(const path of paths){mkdirSync(path);register(path);}
 const before=readFileSync(registry);const generation=readOrdinaryProfileSources()!.generation;
 register(paths[0]!);expect(readFileSync(registry)).toEqual(before);expect(readOrdinaryProfileSources()!.generation).toBe(generation);
});
it('propagates programming errors from sweep without changing the file',()=>{
 const path=join(root,'bug');mkdirSync(path);register(path);const before=readFileSync(registry);
 const current=join(root,'current');mkdirSync(current);state.bug=true;
 expect(()=>register(current)).toThrow('sweep bug');expect(readFileSync(registry)).toEqual(before);
});
it.each(['EACCES','EIO'])('retains sqlite database rows on database %s',code=>{
 const directory=join(root,'db');mkdirSync(directory);const database=join(directory,'state.db');writeFileSync(database,'');
 registerOrdinaryProfileSource({kind:'sqlite-db',directory,databaseBasename:'state.db',snapshotFormat:'session-sqlite-v1'});
 state.errors.set(database,code);const current=join(root,'current');mkdirSync(current);register(current);
 expect(readOrdinaryProfileSources()!.sources).toHaveLength(2);
});
function compactTable(count:number){
 const initial=join(root,'initial');mkdirSync(initial);register(initial);
 const dev=String(lstatSync(root,{bigint:true}).dev);
 const sources=Array.from({length:count},(_,index)=>{const directory=join(root,'row-'+index);const inode=String(10000+index);state.stats.set(directory,BigInt(inode));return [hash(['session-root',dev,inode,null]),hash([directory,'session-root',null]),'session-root',directory,dev,inode,'session-root-v1',null,null];});
 writeFileSync(registry,JSON.stringify({version:3,sourceVersion:1,uid:userInfo().uid,generation:'9',legacyInventoryRequired:true,sources}));return sources;
}
it('keeps all 2000 compact live rows when under capacity',()=>{
 compactTable(2000);const current=join(root,'current');mkdirSync(current);register(current);
 expect(readOrdinaryProfileSources()!.sources).toHaveLength(2001);expect(state.warn).not.toHaveBeenCalled();
});
it('prunes missing rows from compact v3 storage',()=>{
 const rows=compactTable(20);state.stats.delete(rows[3]![3] as string);
 const current=join(root,'current');mkdirSync(current);register(current);
 expect(readOrdinaryProfileSources()!.sources).toHaveLength(20);
});
it('bounds serialization for 2000-row compact eviction, warns once and preserves current row',()=>{
 compactTable(2000);const current=join(root,'x'.repeat(160000));state.stats.set(current,99999n);state.calls=0;
 register(current);const rows=readOrdinaryProfileSources()!.sources;
 expect(rows.length).toBeLessThan(2001);expect(rows.at(-1)!.directory.canonicalPath).toBe(current);
 expect(state.calls).toBe(1);expect(readFileSync(registry).length).toBeLessThanOrEqual(512*1024);
 expect(state.warn).toHaveBeenCalledExactlyOnceWith('Evicted live profile source registrations',{count:2001-rows.length,registryPath:registry});
});

it('warns with only count and registry path after live eviction',()=>{
 const {current}=seed();register(current);
 expect(state.warn).toHaveBeenCalledExactlyOnceWith('Evicted live profile source registrations',{count:1,registryPath:registry});
});
it('recognizes capacity errors with appended codec context',()=>{
 seed();const current=join(root,'x'.repeat(530000));state.stats.set(current,1003n);state.capacitySuffix=true;
 expect(()=>register(current)).toThrow(/current source itself exceeds registry limit/);
 expect(state.warn).not.toHaveBeenCalled();
});
