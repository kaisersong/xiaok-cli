import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {parseOrdinaryProfileSources,readOrdinaryProfileSources} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import type {OrdinaryProfileSource} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
import {decodeOrdinaryProfileSourceStorage,serializeOrdinaryProfileSourceStorage} from '../../../src/runtime/verification/ordinary-profile-source-storage-codec.js';
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
it.skipIf(process.platform==='win32')('saves after a deleted sqlite source identity is reused by another directory',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'sqlite-inode-reuse-'))),home=process.env.HOME,config=process.env.XIAOK_CONFIG_DIR;
 let store:SQLiteSessionStore|undefined;
 try{
  process.env.HOME=root;delete process.env.XIAOK_CONFIG_DIR;const a=join(root,'A'),b=join(root,'B');mkdirSync(a);
  const session={sessionId:'sess_inode_reuse',cwd:root,createdAt:1,updatedAt:1,lineage:['sess_inode_reuse'],messages:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]};
  store=new SQLiteSessionStore(join(a,'sessions.sqlite'));await store.save(session);store.dispose();store=undefined;rmSync(a,{recursive:true});mkdirSync(b);
  // Make B's database before constructing its store, which registers on open.
  const {default:Database}=await import('better-sqlite3');const db=new Database(join(b,'sessions.sqlite'));db.close();
  const path=join(root,'.xiaok','profile-sources','registry.json'),raw=decodeOrdinaryProfileSourceStorage(JSON.parse(readFileSync(path,'utf8'))) as {uid:number;sources:OrdinaryProfileSource[]};
  const dir=lstatSync(b,{bigint:true}),file=lstatSync(join(b,'sessions.sqlite'),{bigint:true});
  raw.sources=raw.sources.map(row=>{
   if(row.directory.canonicalPath!==a)return row;
   const directory={...row.directory,device:String(dir.dev),inode:String(dir.ino)},database=row.database?{...row.database,device:String(file.dev),inode:String(file.ino)}:undefined;
   const sourceId=createHash('sha256').update(JSON.stringify([row.kind,directory.device,directory.inode,database??null])).digest('hex');
   return {...row,directory,sourceId,...(database?{database}:{})};
  });writeFileSync(path,serializeOrdinaryProfileSourceStorage(parseOrdinaryProfileSources(raw,raw.uid)));
  store=new SQLiteSessionStore(join(b,'sessions.sqlite'));await expect(store.save(session)).resolves.toBeUndefined();expect(await store.load(session.sessionId)).toMatchObject({sessionId:session.sessionId});
  expect(readOrdinaryProfileSources()!.sources.some(row=>row.directory.canonicalPath===b)).toBe(true);expect(readOrdinaryProfileSources()!.sources.some(row=>row.directory.canonicalPath===a)).toBe(false);
 }finally{store?.dispose();if(home===undefined)delete process.env.HOME;else process.env.HOME=home;if(config===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=config;rmSync(root,{recursive:true,force:true});}
});
