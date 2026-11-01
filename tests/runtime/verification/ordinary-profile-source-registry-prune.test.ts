import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {registerOrdinaryProfileSource,readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const state=vi.hoisted(()=>({stats:new Map<string,bigint>(),errors:new Map<string,string>(),template:''}));
vi.mock('node:fs',async load=>{const fs=await load<typeof import('node:fs')>();return {...fs,
 lstatSync:(path:string,options:unknown)=>{const code=state.errors.get(path);if(code)throw Object.assign(Error(code),{code});const ino=state.stats.get(path);if(ino!==undefined){const stat=fs.lstatSync(state.template,options as never);return new Proxy(stat,{get(target,key){if(key==='ino')return typeof target.ino==='bigint'?ino:Number(ino);const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});}return fs.lstatSync(path,options as never);},
 realpathSync:(path:string)=>state.stats.has(path)?path:fs.realpathSync(path)};});
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
let root:string,registry:string;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const register=(directory:string)=>registerOrdinaryProfileSource({kind:'session-root',directory});
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'registry-prune-')));vi.stubEnv('HOME',root);vi.stubEnv('XIAOK_CONFIG_DIR',join(root,'.xiaok'));state.template=root;state.stats.clear();state.errors.clear();registry=join(root,'.xiaok','profile-sources','registry.json');});
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
it('evicts by registration LRU and preserves recently reused rows from old v1 storage',()=>{
 const {paths,current}=seed();register(paths[0]!);register(current);
 expect(readOrdinaryProfileSources()!.sources.map(row=>row.directory.canonicalPath)).toEqual([paths[0],current]);
 expect(readFileSync(registry).length).toBeLessThanOrEqual(512*1024);
});
it('reports registry path and recovery advice when the current source alone cannot fit',()=>{
 seed();const current=join(root,'4'.repeat(530000));state.stats.set(current,1003n);const before=readFileSync(registry);
 expect(()=>register(current)).toThrow(/profile_source_registry_capacity.*registry.*full.*registry\.json.*(remove|move)/i);
 expect(readFileSync(registry)).toEqual(before);
});
it('reports a useful error for an existing oversized registry without reading it',()=>{
 seed();writeFileSync(registry,' '.repeat(512*1024+1));
 expect(()=>readOrdinaryProfileSources()).toThrow(/profile_source_registry_identity.*registry.*full.*registry\.json.*(remove|move)/i);
});
