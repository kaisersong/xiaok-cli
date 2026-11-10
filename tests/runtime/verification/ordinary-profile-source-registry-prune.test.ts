import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join,parse} from 'node:path';
import {registerOrdinarySQLiteLayout,registerOrdinaryProfileSource,readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const state=vi.hoisted(()=>({stats:new Map<string,bigint>(),errors:new Map<string,string>(),template:'',bug:false,capacitySuffix:false,calls:0,devices:new Map<string,bigint>(),diagnosticFailure:false,writes:0}));
vi.mock('node:fs',async load=>{const fs=await load<typeof import('node:fs')>();return {...fs,
 lstatSync:(path:string,options:unknown)=>{if(state.bug&&path.endsWith('/bug'))throw new TypeError('sweep bug');const code=state.errors.get(path);if(code)throw Object.assign(Error(code),{code});const ino=state.stats.get(path);const dev=state.devices.get(path);if(dev!==undefined){const stat=fs.lstatSync(path,options as never);return new Proxy(stat,{get(target,key){if(key==='dev')return typeof target.dev==='bigint'?dev:Number(dev);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}if(ino!==undefined){const stat=fs.lstatSync(state.template,options as never);return new Proxy(stat,{get(target,key){if(key==='ino')return typeof target.ino==='bigint'?ino:Number(ino);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}return fs.lstatSync(path,options as never);},
 realpathSync:(path:string)=>state.stats.has(path)?path:fs.realpathSync(path)};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
vi.mock('../../../src/runtime/verification/ordinary-profile-source-storage-codec.js',async load=>{const codec=await load<typeof import('../../../src/runtime/verification/ordinary-profile-source-storage-codec.js')>();return {...codec,serializeOrdinaryProfileSourceStorage:(...args:Parameters<typeof codec.serializeOrdinaryProfileSourceStorage>)=>{state.calls++;if(state.diagnosticFailure&&state.calls===2)throw Error("diagnostic serialization failed");try{return codec.serializeOrdinaryProfileSourceStorage(...args);}catch(error){if(state.capacitySuffix&&error instanceof Error&&error.message.startsWith('profile_source_registry_capacity'))throw Error(error.message+': context');throw error;}}};});
vi.mock('../../../src/utils/atomic-file.js',async load=>{const actual=await load<typeof import('../../../src/utils/atomic-file.js')>();return {...actual,writeFileAtomicallySync:(...args:Parameters<typeof actual.writeFileAtomicallySync>)=>{state.writes++;return actual.writeFileAtomicallySync(...args);}};});
let root:string,registry:string;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const register=(directory:string)=>registerOrdinaryProfileSource({kind:'session-root',directory});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'registry-prune-')));vi.stubEnv('HOME',root);vi.stubEnv('TMPDIR',root);vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'.xiaok'));vi.stubEnv('XDG_CONFIG_HOME',join(root,'config'));vi.stubEnv('XDG_DATA_HOME',join(root,'data'));vi.stubEnv('XDG_CACHE_HOME',join(root,'cache'));state.writes=0;state.bug=false;state.capacitySuffix=false;state.calls=0;state.devices.clear();state.diagnosticFailure=false;state.template=root;state.stats.clear();state.errors.clear();registry=join(root,'.xiaok','profile-sources','registry.json');});
afterEach(()=>{vi.unstubAllEnvs();state.stats.clear();state.errors.clear();rmSync(root,{recursive:true,force:true,maxRetries:3});});
function seed(){
 const directory=join(root,'initial');mkdirSync(directory);register(directory);
 const dev=String(lstatSync(root,{bigint:true}).dev);
 const paths=[1,2].map(n=>join(root,String(n).repeat(240000)));
 const sources=paths.map((canonicalPath,index)=>{const inode=String(1000+index);state.stats.set(canonicalPath,BigInt(inode));return {sourceId:hash(['session-root',dev,inode,null]),namespaceId:hash([canonicalPath,'session-root',null]),kind:'session-root',directory:{canonicalPath,device:dev,inode},snapshotFormat:'session-root-v1'};});
 writeFileSync(registry,JSON.stringify({version:1,uid:userInfo().uid,generation:'1',legacyInventoryRequired:true,sources}));
 const current=join(root,'3'.repeat(80000));state.stats.set(current,1002n);return {paths,current};
}
function expectCapacity(action:()=>void,existing:NonNullable<ReturnType<typeof readOrdinaryProfileSources>>){
 const bytes=readFileSync(registry).length;
 let message='';try{action();}catch(error){if(!(error instanceof Error))throw error;message=error.message;}
 expect(message).toContain('profile_source_registry_capacity:');
 expect(message).toContain('limit 524288 bytes (512 KiB)');
 expect(message).toContain(`file current usage ${bytes} bytes`);
 if(state.diagnosticFailure)expect(message).toContain('active usage after pruning unavailable');
 expect(message).toContain(`${existing.sources.length} active record${existing.sources.length===1?'':'s'}`);
 expect(message).toContain(registry);
 expect(message).toContain('删除或移走不再使用的项目目录后重试，失效记录会在下次写入时自动清理');
 expect(message).toContain('也可以用编辑器打开该文件删除不再使用的项目条目（先备份）');
 expect(message).not.toMatch(/remov(e|ing) (the |this |entire )?registry|delete.*registry file/i);
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
it('rejects a full live table without changing bytes, generation or any live row',()=>{
 const {paths,current}=seed();register(paths[0]!);
 const before=readFileSync(registry),facts=readOrdinaryProfileSources()!;
 expectCapacity(()=>register(current),facts);
 expect(readFileSync(registry)).toEqual(before);
 expect(readOrdinaryProfileSources()).toEqual(facts);

});
it('prunes stale rows from a full table and admits the new source',()=>{
 const {paths,current}=seed();state.errors.set(paths[0]!,'ENOENT');
 register(current);
 expect(readOrdinaryProfileSources()!.sources.map(row=>row.directory.canonicalPath)).toEqual([paths[1],current]);
 expect(readOrdinaryProfileSources()!.generation).toBe('2');
});
it('sweeps stale rows even when registering an unchanged source',()=>{
 const {paths}=seed();state.errors.set(paths[1]!,'ENOENT');register(paths[0]!);
 expect(readOrdinaryProfileSources()!.sources.map(row=>row.directory.canonicalPath)).toEqual([paths[0]]);
 expect(readOrdinaryProfileSources()!.generation).toBe('2');
});
it('reports only source size and reduction advice when the current source alone cannot fit',()=>{
 seed();const current=join(root,'4'.repeat(530000));state.stats.set(current,1003n);const before=readFileSync(registry);
 const facts=readOrdinaryProfileSources()!;
 expectSingleCapacity(()=>register(current));
 expect(readOrdinaryProfileSources()).toEqual(facts);
 expect(readFileSync(registry)).toEqual(before);
});
it.each([false,true])('rejects an oversized source without persisting partial cleanup (all stale: %s)',allStale=>{
 const {paths}=seed();const facts=readOrdinaryProfileSources()!,before=readFileSync(registry);
 state.errors.set(paths[0]!,'ENOENT');if(allStale)state.errors.set(paths[1]!,'ENOENT');
 const current=join(root,'4'.repeat(530000));state.stats.set(current,1003n);
 expectSingleCapacity(()=>register(current));
 expect(readFileSync(registry)).toEqual(before);expect(readOrdinaryProfileSources()).toEqual(facts);
});
it('reports a useful error for an existing oversized registry without reading it',()=>{
 seed();writeFileSync(registry,' '.repeat(512*1024+1));
 expect(()=>readOrdinaryProfileSources()).toThrow(/profile_source_registry_identity.*limit 524288 bytes.*current usage 524289 bytes/);
 expect(()=>readOrdinaryProfileSources()).toThrow(registry);
 expect(()=>readOrdinaryProfileSources()).toThrow('先备份');
 expect(()=>readOrdinaryProfileSources()).toThrow('用编辑器');
 expect(()=>readOrdinaryProfileSources()).not.toThrow(/remove it|delete.*registry/i);
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
 const sources=Array.from({length:count},(_,index)=>{const directory=join(parse(root).root,'registry-prune-virtual-row-'+index);const inode=String(10000+index);state.stats.set(directory,BigInt(inode));return [hash(['session-root',dev,inode,null]),hash([directory,'session-root',null]),'session-root',directory,dev,inode,'session-root-v1',null,null];});
 // Only the existing synthetic stat/realpath leaves see these short paths; no root-level IO occurs.
 const bytes=JSON.stringify({version:3,sourceVersion:1,uid:userInfo().uid,generation:'9',legacyInventoryRequired:true,sources});
 expect(Buffer.byteLength(bytes)).toBeLessThan(524288);
 writeFileSync(registry,bytes);return sources;
}
it('keeps all 2000 compact live rows when under capacity',()=>{
 compactTable(2000);const current=join(root,'current');mkdirSync(current);register(current);
 expect(readOrdinaryProfileSources()!.sources).toHaveLength(2001);
});
it('prunes missing rows from compact v3 storage',()=>{
 const rows=compactTable(20);state.stats.delete(rows[3]![3] as string);
 const current=join(root,'current');mkdirSync(current);register(current);
 expect(readOrdinaryProfileSources()!.sources).toHaveLength(20);
});
it('bounds serialization when rejecting a full 2000-row compact live table',()=>{
 compactTable(2000);const current=join(root,'x'.repeat(160000));state.stats.set(current,99999n);state.calls=0;
 const before=readFileSync(registry),facts=readOrdinaryProfileSources()!;
 expectCapacity(()=>register(current),facts);
 expect(state.calls).toBeLessThanOrEqual(3);
 expect(readFileSync(registry)).toEqual(before);expect(readOrdinaryProfileSources()).toEqual(facts);

});

it('recognizes capacity errors with appended codec context',()=>{
 seed();const current=join(root,'x'.repeat(530000));state.stats.set(current,1003n);state.capacitySuffix=true;
 expect(()=>register(current)).toThrow(/current source itself exceeds registry limit/);

});

function expectSingleCapacity(action:()=>void){
 let message='';try{action();}catch(error){message=(error as Error).message;}
 expect(message).toContain('profile_source_registry_capacity:');
 expect(message).toContain('limit 524288 bytes');
 expect(message).toMatch(/source size \d+ bytes/);
 expect(message).toContain('Reduce source path or metadata size');
 expect(message).toMatch(/Source: \S*4{20}/);
 expect(message).toContain('清理其他项目没有用');
 expect(message.length).toBeLessThan(2000);
 expect(message).not.toMatch(/删除|编辑器|remove it/);
}
it.each([false,true])('preserves device-renumbered A and B including SQLite history (no-op: %s)',noop=>{
 const a=join(root,'a'),b=join(root,'b'),c=join(root,'c');for(const path of [a,b,c])mkdirSync(path);
 register(a);writeFileSync(join(b,'state.db'),'');
 const components=['loop'] as const;const layout={version:1 as const,components,layoutRevision:1,layoutHash:hash({version:1,components,layoutRevision:1})};
 registerOrdinarySQLiteLayout({kind:'sqlite-db',directory:b,databaseBasename:'state.db',snapshotFormat:'loop-sqlite-v1'},layout);
 const before=readOrdinaryProfileSources()!,bytes=readFileSync(registry);
 for(const path of [a,b,join(b,'state.db')])state.devices.set(path,lstatSync(path,{bigint:true}).dev+1n);
 // A remains unchanged in the no-op case so that the sweep alone sees B's renumbering.
 if(noop)state.devices.delete(a);
 register(noop?a:c);
 const after=readOrdinaryProfileSources()!;
 expect(after.sources.filter(row=>row.directory.canonicalPath!==c)).toEqual(before.sources);
 if(noop)expect(readFileSync(registry)).toEqual(bytes);
});
it('reports unavailable active bytes when diagnostic serialization fails',()=>{
 const {current}=seed();const facts=readOrdinaryProfileSources()!,before=readFileSync(registry);
 state.calls=0;state.diagnosticFailure=true;
 expectCapacity(()=>register(current),facts);
 expect(readFileSync(registry)).toEqual(before);expect(readOrdinaryProfileSources()).toEqual(facts);
 expect(state.calls).toBeLessThanOrEqual(3);
});

it('sweeps every stale row in one near-capacity registration with exactly one write',()=>{
 const {paths}=seed();const current=join(root,'6'.repeat(40000));state.stats.set(current,1006n);const facts=readOrdinaryProfileSources()!;
 const stale=Array.from({length:6},(_,index)=>{const canonicalPath=join(root,'stale-'+index+'s'.repeat(5000));const inode=String(2000+index);return {...facts.sources[0]!,sourceId:hash(['session-root',facts.sources[0]!.directory.device,inode,null]),namespaceId:hash([canonicalPath,'session-root',null]),directory:{...facts.sources[0]!.directory,canonicalPath,inode}};});
 writeFileSync(registry,JSON.stringify({...facts,sources:[...stale,...facts.sources]}));
 expect(readFileSync(registry).length).toBeGreaterThan(500000);
 expect(readFileSync(registry).length).toBeLessThan(524288);
 for(const row of stale)state.errors.set(row.directory.canonicalPath,'ENOENT');
 state.writes=0;register(current);
 const after=readOrdinaryProfileSources()!;
 expect(after.sources.map(row=>row.directory.canonicalPath)).toEqual([...paths,current]);
 expect(after.sources.slice(0,2)).toEqual(facts.sources);
 for(const row of stale)expect(after.sources.some(item=>item.namespaceId===row.namespaceId)).toBe(false);
 expect(after.generation).toBe('2');expect(state.writes).toBe(1);
});
it.each([1,2])('reports disk and swept active bytes separately on rejection (%s active)',count=>{
 const {paths}=seed();const facts=readOrdinaryProfileSources()!;
 const canonicalPath=join(root,'stale');const inode='2000';
 const stale={...facts.sources[0]!,sourceId:hash(['session-root',facts.sources[0]!.directory.device,inode,null]),namespaceId:hash([canonicalPath,'session-root',null]),directory:{...facts.sources[0]!.directory,canonicalPath,inode}};
 const active={...facts,sources:facts.sources.slice(0,count)};
 writeFileSync(registry,JSON.stringify({...facts,sources:[stale,...active.sources]},null,2));
 const before=readFileSync(registry),original=readOrdinaryProfileSources()!;
 const current=join(root,'5'.repeat(count===1?290000:80000));state.stats.set(current,1005n);
 let message='';try{register(current);}catch(error){message=(error as Error).message;}
 expect(message).toContain(`file current usage ${before.length} bytes`);
 expect(message).toContain(`active usage after pruning ${Buffer.byteLength(JSON.stringify(active))} bytes, ${count} active record${count===1?'':'s'}.`);
 expect(message).not.toContain('1 active records');
 expect(readFileSync(registry)).toEqual(before);expect(readOrdinaryProfileSources()).toEqual(original);
});
it('directly re-registers a device-renumbered source and updates its device',()=>{
 const directory=join(root,'renumbered');mkdirSync(directory);register(directory);
 const before=readOrdinaryProfileSources()!;const device=lstatSync(directory,{bigint:true}).dev+1n;
 state.devices.set(directory,device);register(directory);
 const after=readOrdinaryProfileSources()!;
 expect(after.sources).toHaveLength(1);
 expect(after.sources[0]!.namespaceId).toBe(before.sources[0]!.namespaceId);
 expect(after.sources[0]!.directory).toEqual({...before.sources[0]!.directory,device:String(device)});
 expect(after.sources[0]!.sourceId).not.toBe(before.sources[0]!.sourceId);
 expect(after.generation).toBe(String(BigInt(before.generation)+1n));
});
