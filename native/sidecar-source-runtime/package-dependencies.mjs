import {writeFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
// No external SQLite runtime is copied. Qualification still checks the actual
// executing sidecar and original source/authority independently.
if(process.argv.length!==3)throw Error('runtime output required');
const output=resolve(process.argv[2]),facts=await lstat(output);
if(!facts.isDirectory()||facts.isSymbolicLink())throw Error('runtime output directory required');
const db=new DatabaseSync(':memory:');let sqliteVersion;
try{if(db.prepare('SELECT 1 AS n').get().n!==1)throw Error('builtin_sqlite_query_failed');sqliteVersion=db.prepare('SELECT sqlite_version() AS v').get().v;}finally{db.close();}
const manifest={kind:'fixed_sidecar_runtime_dependencies_v1',qualification:false,targetAbiVerified:false,buildNode:process.versions.node,sqliteBackend:'node:sqlite',sqliteVersion,files:[],sources:[]};
await writeFile(join(output,'dependency-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,packages:[],sqliteBackend:'node:sqlite',sqliteVersion,actualMemoryQuery:true,qualification:false,targetAbiVerified:false}));
