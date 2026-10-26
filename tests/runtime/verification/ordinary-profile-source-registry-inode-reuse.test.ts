import {resolveProfileAccountHome} from '../../../src/runtime/verification/profile-account-home.js';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {chmodSync,closeSync,constants,existsSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,rmdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isStaleOrdinaryProfileSource,parseOrdinaryProfileSources,readOrdinaryProfileSources,registerOrdinaryProfileSource,registerOrdinarySQLiteLayout} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import {createKnownDirectoryWriterFence} from '../../../src/runtime/verification/known-directory-writer-fence.js';
import type {OrdinaryProfileSource} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import {decodeOrdinaryProfileSourceStorage,serializeOrdinaryProfileSourceStorage} from '../../../src/runtime/verification/ordinary-profile-source-storage-codec.js';
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
const fake=vi.hoisted(()=>({path:'',target:'',code:'',hits:0}));
vi.mock('node:fs',async load=>{const actual=await load<typeof import('node:fs')>();return {...actual,lstatSync:(p:string,options:unknown)=>{if(p===fake.path)fake.hits++;if(p===fake.path&&fake.code)throw Object.assign(Error(fake.code),{code:fake.code});return actual.lstatSync(p===fake.path?fake.target:p,options as never);}};});
let root:string;
const env={HOME:process.env.HOME,XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const registry=()=>join(process.env.XIAOK_CONFIG_DIR??join(process.env.HOME!,'.xiaok'),'profile-sources','registry.json');
function rewrite(work:(rows:OrdinaryProfileSource[])=>void){
 const raw=decodeOrdinaryProfileSourceStorage(JSON.parse(readFileSync(registry(),'utf8'))) as {uid:number;sources:OrdinaryProfileSource[]};
 work(raw.sources);writeFileSync(registry(),serializeOrdinaryProfileSourceStorage(parseOrdinaryProfileSources(raw,raw.uid)));
}
function carryIdentity(row:OrdinaryProfileSource,path:string){
 const stat=lstatSync(path,{bigint:true}),directory={...row.directory,device:String(stat.dev),inode:String(stat.ino)};
 return {...row,directory,sourceId:hash([row.kind,directory.device,directory.inode,row.database??null]),namespaceId:hash([directory.canonicalPath,row.kind,row.database?.basename??null])};
}
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'registry-reuse-')));process.env.HOME=root;delete process.env.XIAOK_CONFIG_DIR;});
afterEach(()=>{for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(root,{recursive:true,force:true});});
it('detects missing and changed directory/database identities with injected stat',()=>{
 const row:OrdinaryProfileSource={kind:'session-root',sourceId:'unused',namespaceId:'unused',snapshotFormat:'session-root-v1',directory:{canonicalPath:join(root,'A'),device:'1',inode:'42'}};
 expect(isStaleOrdinaryProfileSource(row,()=>{throw Object.assign(Error(),{code:'ENOENT'});})).toBe(true);
 expect(isStaleOrdinaryProfileSource(row,()=>undefined)).toBe(true);
 expect(isStaleOrdinaryProfileSource(row,()=>({dev:1n,ino:42n}))).toBe(false);
 expect(isStaleOrdinaryProfileSource(row,()=>({dev:1n,ino:43n}))).toBe(true);
 expect(isStaleOrdinaryProfileSource(row,()=>({dev:2n,ino:42n}))).toBe(true);
 expect(isStaleOrdinaryProfileSource(row,()=>{throw Object.assign(Error(),{code:'ENOTDIR'});})).toBe(true);
 expect(()=>isStaleOrdinaryProfileSource(row,()=>{throw Object.assign(Error('denied'),{code:'EACCES'});})).toThrow('denied');
 const db={...row,kind:'sqlite-db' as const,snapshotFormat:'session-sqlite-v1',database:{basename:'sessions.sqlite',device:'1',inode:'50'}};
 expect(isStaleOrdinaryProfileSource(db,p=>({dev:1n,ino:p===row.directory.canonicalPath?42n:51n}))).toBe(true);
 expect(isStaleOrdinaryProfileSource(db,p=>p===row.directory.canonicalPath?{dev:1n,ino:42n}:undefined)).toBe(true);
 expect(isStaleOrdinaryProfileSource(db,p=>({dev:1n,ino:p===row.directory.canonicalPath?42n:50n}))).toBe(false);
});
it('drops a deleted source whose identity was reused at another path',()=>{
 const a=join(root,'A'),b=join(root,'B');mkdirSync(a);mkdirSync(b);registerOrdinaryProfileSource({kind:'session-root',directory:a});
 rewrite(rows=>{rows[0]=carryIdentity(rows[0]!,b);});rmdirSync(a);
 registerOrdinaryProfileSource({kind:'session-root',directory:b});const facts=readOrdinaryProfileSources()!;
 expect(facts.sources.map(row=>row.directory.canonicalPath)).toEqual([b]);expect(facts.generation).toBe('2');expect(parseOrdinaryProfileSources(facts,facts.uid)).toEqual(facts);
});
it.skipIf(process.platform==='win32')('rebinds a directory deleted and recreated at the same path',()=>{
 const a=join(root,'A');mkdirSync(a);registerOrdinaryProfileSource({kind:'session-root',directory:a});const old=lstatSync(a,{bigint:true}),fd=openSync(a,constants.O_RDONLY|constants.O_DIRECTORY);
 try{
  rmdirSync(a);mkdirSync(a);const current=lstatSync(a,{bigint:true});expect(current.ino).not.toBe(old.ino);
  registerOrdinaryProfileSource({kind:'session-root',directory:a});const facts=readOrdinaryProfileSources()!;
  expect(facts.sources).toHaveLength(1);expect(facts.sources[0]!.directory.inode).toBe(String(current.ino));expect(facts.generation).toBe('2');
 }finally{closeSync(fd);}
});
it('rebinds the same path with a new inode on all platforms',()=>{
 const a=join(root,'A');mkdirSync(a);registerOrdinaryProfileSource({kind:'session-root',directory:a});renameSync(a,join(root,'held'));mkdirSync(a);
 registerOrdinaryProfileSource({kind:'session-root',directory:a});expect(readOrdinaryProfileSources()!.generation).toBe('2');expect(readOrdinaryProfileSources()!.sources).toHaveLength(1);
});
it('still rejects a conflicting source when the recorded path is live',()=>{
 const a=join(root,'A'),b=join(root,'B');mkdirSync(a);mkdirSync(b);registerOrdinaryProfileSource({kind:'session-root',directory:a});
 rewrite(rows=>{rows[0]=carryIdentity(rows[0]!,b);});
 // Simulate two live paths resolving to B's physical directory.
 fake.path=a;fake.target=b;fake.hits=0;
 try{expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory:b})).toThrow('profile_source_registry_identity');expect(fake.hits).toBeGreaterThan(0);}finally{fake.path='';fake.target='';}
});
it('live identity conflict still errors',()=>{
 // Public API only: B observes A's live dev/ino, so sourceId matches while namespaceId differs.
 const a=join(root,'A'),b=join(root,'B');mkdirSync(a);mkdirSync(b);registerOrdinaryProfileSource({kind:'session-root',directory:a});const before=readFileSync(registry());
 fake.path=b;fake.target=a;fake.hits=0;
 try{expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory:b})).toThrow('profile_source_registry_identity');expect(fake.hits).toBeGreaterThan(0);}finally{fake.path='';fake.target='';}
 expect(readFileSync(registry())).toEqual(before);expect(readOrdinaryProfileSources()!.sources.map(row=>row.directory.canonicalPath)).toEqual([a]);
});
it('preserves unknown component history when a sqlite file is replaced',()=>{
 const a=join(root,'A');mkdirSync(a);const db=join(a,'loop.sqlite');writeFileSync(db,'old');
 const input={kind:'sqlite-db' as const,directory:a,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const},components=['loop'] as const;
 registerOrdinarySQLiteLayout(input,{version:1,components,layoutRevision:1,layoutHash:hash({version:1,components,layoutRevision:1})});const history=readOrdinaryProfileSources()!.sources[0]!.componentHistory;
 const next=join(a,'next');writeFileSync(next,'new');rmSync(db);renameSync(next,db);registerOrdinaryProfileSource(input);
 expect(readOrdinaryProfileSources()!.sources[0]!.componentHistory).toEqual(history);
});
it('does not rewrite an unchanged loop sqlite source with component history',()=>{
 const a=join(root,'A');mkdirSync(a);writeFileSync(join(a,'loop.sqlite'),'db');
 const input={kind:'sqlite-db' as const,directory:a,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const},components=['loop'] as const;
 registerOrdinarySQLiteLayout(input,{version:1,components,layoutRevision:1,layoutHash:hash({version:1,components,layoutRevision:1})});
 const before=readFileSync(registry(),'utf8'),stat=lstatSync(registry(),{bigint:true}),facts=readOrdinaryProfileSources()!;
 registerOrdinaryProfileSource(input);
 expect(readOrdinaryProfileSources()!.generation).toBe(facts.generation);expect(readFileSync(registry(),'utf8')).toBe(before);
 expect(lstatSync(registry(),{bigint:true}).mtimeNs).toBe(stat.mtimeNs);expect(lstatSync(registry(),{bigint:true}).ino).toBe(stat.ino);
});
it('writes only under HOME and honors an explicit config directory',async()=>{
 const actual=await vi.importActual<typeof import('node:os')>('node:os'),real=join(actual.userInfo().homedir,'.xiaok','profile-sources');
 function snapshot(path:string):unknown[]{if(!existsSync(path))return [];const stat=lstatSync(path,{bigint:true});return [[path,String(stat.mtimeNs),String(stat.size)],...(stat.isDirectory()?readdirSync(path).sort().flatMap(name=>snapshot(join(path,name))):[])];}
 const before=snapshot(real),a=join(root,'A');mkdirSync(a);registerOrdinaryProfileSource({kind:'session-root',directory:a});expect(existsSync(registry())).toBe(true);
 expect(snapshot(real)).toEqual(before);
 process.env.XIAOK_CONFIG_DIR=join(root,'config');registerOrdinaryProfileSource({kind:'session-root',directory:a});expect(existsSync(join(root,'config','profile-sources','registry.json'))).toBe(true);expect(snapshot(real)).toEqual(before);
});

it('merges unknown histories when both namespace and source rows are stale',()=>{
 const a=join(root,'A'),b=join(root,'B');for(const path of [a,b]){mkdirSync(path);writeFileSync(join(path,'loop.sqlite'),'db');}
 const input=(directory:string)=>({kind:'sqlite-db' as const,directory,databaseBasename:'loop.sqlite',snapshotFormat:'loop-sqlite-v1' as const});
 for(const [path,component] of [[a,'loop'],[b,'completion']] as const){const components=[component];registerOrdinarySQLiteLayout(input(path),{version:1,components,layoutRevision:1,layoutHash:hash({version:1,components,layoutRevision:1})});}
 renameSync(join(a,'loop.sqlite'),join(a,'held'));writeFileSync(join(a,'loop.sqlite'),'new');
 rewrite(rows=>{const index=rows.findIndex(row=>row.directory.canonicalPath===b),prior=rows[index]!,stat=lstatSync(join(a,'loop.sqlite'),{bigint:true}),database={...prior.database!,device:String(stat.dev),inode:String(stat.ino)};const row=carryIdentity(prior,a);rows[index]={...row,database,sourceId:hash([row.kind,row.directory.device,row.directory.inode,database])};});
 registerOrdinaryProfileSource(input(a));const facts=readOrdinaryProfileSources()!;expect(facts.sources).toHaveLength(1);expect(facts.generation).toBe('3');expect(facts.sources[0]!.componentHistory).toMatchObject({historyUnknown:true,components:['completion','loop']});expect(facts.sources[0]!.componentHistory!.observations).toHaveLength(2);
});
it('propagates stat failures without deleting registry rows',()=>{
 const a=join(root,'A'),b=join(root,'B');mkdirSync(a);mkdirSync(b);registerOrdinaryProfileSource({kind:'session-root',directory:a});rewrite(rows=>{rows[0]=carryIdentity(rows[0]!,b);});const before=readFileSync(registry(),'utf8');
 fake.path=a;fake.code='EACCES';try{expect(()=>registerOrdinaryProfileSource({kind:'session-root',directory:b})).toThrow('EACCES');expect(readFileSync(registry(),'utf8')).toBe(before);}finally{fake.path='';fake.code='';}
});

it.skipIf(process.platform==='win32'||!process.getuid?.())('keeps writer fences at passwd home across environment roots',async()=>{
 const actual=await import('node:os'),home=actual.userInfo().homedir,a=join(root,'A');mkdirSync(a);
 registerOrdinaryProfileSource({kind:'session-root',directory:a});const fence=createKnownDirectoryWriterFence(a,'session-root');fence.assertOpen();fence.persist();
 process.env.HOME=join(root,'other');mkdirSync(process.env.HOME);process.env.XIAOK_CONFIG_DIR=join(root,'config');
 expect(()=>createKnownDirectoryWriterFence(a,'session-root').assertOpen()).toThrow('known_writer_fence_fenced');
 expect(existsSync(join(home,'.xiaok','profile-sources','writer-fences'))).toBe(true);
});

it.skipIf(process.platform==='win32')('rejects writable bases and symlinks anywhere in the selected home/config chain',()=>{
 const unsafe=join(root,'unsafe');mkdirSync(unsafe);chmodSync(unsafe,0o777);
 try{process.env.HOME=unsafe;expect(()=>resolveProfileAccountHome()).toThrow('profile_source_registry_account');
 process.env.HOME=root;process.env.XIAOK_CONFIG_DIR=unsafe;expect(()=>resolveProfileAccountHome()).toThrow('profile_source_registry_account');
 }finally{chmodSync(unsafe,0o700);}
 const alias=join(root,'alias');symlinkSync(unsafe,alias,'dir');
 process.env.XIAOK_CONFIG_DIR=join(alias,'config');expect(()=>resolveProfileAccountHome()).toThrow('profile_source_registry_account');
 delete process.env.XIAOK_CONFIG_DIR;process.env.HOME=alias;expect(()=>resolveProfileAccountHome()).toThrow('profile_source_registry_account');
});
