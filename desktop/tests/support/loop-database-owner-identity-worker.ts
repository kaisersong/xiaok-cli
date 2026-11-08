import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {strict as assert} from 'node:assert';import {join} from 'node:path';import {tmpdir} from 'node:os';
const root=fs.mkdtempSync(join(tmpdir(),'loop-zero-inode-')),original=fs.statSync,descriptor=Object.getOwnPropertyDescriptor(fs,'statSync')!;let calls=0;
Object.defineProperty(fs,'statSync',{...descriptor,value:((...args:Parameters<typeof fs.statSync>)=>{const result=original(...args);if(result&&typeof result.ino==='bigint'){calls++;result.ino=0n;result.dev=0n;}return result;}) as typeof fs.statSync});syncBuiltinESMExports();
try{
 const {createLoopDatabaseOwnerGroup,openLoopDatabase}=await import('../../electron/loop-database-owner.js');
 if(process.argv[2]==='different'){
  const group=createLoopDatabaseOwnerGroup([join(root,'one.sqlite'),join(root,'two.sqlite')]);try{assert.notEqual(openLoopDatabase(group.sources[0]).database,openLoopDatabase(group.sources[1]).database);assert(calls>=2);}finally{group.close();}
 }else if(process.argv[2]==='dangling'){
  const target=join(root,'target.sqlite'),alias=join(root,'alias.sqlite');fs.symlinkSync(target,alias);
  // The owner still deduplicates a dangling alias without reliable inode data.
  // A durable runtime additionally needs real physical identity for discovery.
  const group=createLoopDatabaseOwnerGroup([alias,target]);
  try{assert(calls>=2);assert.equal(openLoopDatabase(group.sources[0]).database,openLoopDatabase(group.sources[1]).database);}finally{group.close();}
  const {createDesktopLoopRuntime}=await import('../../electron/loop-executor.js');
  if(process.platform==='win32'){
   const runtime=createDesktopLoopRuntime({dataRoot:root,loopDbPath:alias,completionEvidenceDbPath:target});
   try{assert.equal((runtime.loopStore as any).db,(runtime.evidenceStore as any).db);assert.equal((runtime.scanner as any).db,(runtime.loopStore as any).db);}finally{runtime.close();}
  }else {
   let runtime:ReturnType<typeof createDesktopLoopRuntime>|undefined;
   try{assert.throws(()=>{runtime=createDesktopLoopRuntime({dataRoot:root,loopDbPath:alias,completionEvidenceDbPath:target});},/loop_database_metadata_file/);}
   finally{runtime?.close();}
  }
 }else throw Error('worker mode');
 process.stdout.write(JSON.stringify({ok:true,maskedStatCalls:calls})+'\n');
}finally{Object.defineProperty(fs,'statSync',descriptor);syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});}
