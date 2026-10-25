import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';
import {startControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
it.skipIf(process.platform==='win32')('actual subprocess helper permits full decoded frame with base64 stdin overhead',async()=>{
 const root=mkdtempSync(join(tmpdir(),'transport-helper-')),socketPath=join(root,'service.sock');
 const server=await startControllerIpc({socketPath,dispatch:async b=>b});
 try {const body=Buffer.alloc(1024**2,120);const result=await new Promise<{status:number|null;out:Buffer;err:string}>((done,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',resolve('src/runtime/verification/controller-transport-entry.ts')],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});const out:Buffer[]=[];let err='';
  child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',status=>done({status,out:Buffer.concat(out),err}));child.stdin.end(JSON.stringify({socketPath,body:body.toString('base64')}));
 });expect(result.status,result.err).toBe(0);expect(result.out.equals(body)).toBe(true);
 }finally{await server.close();rmSync(root,{recursive:true,force:true});}
},10000);
