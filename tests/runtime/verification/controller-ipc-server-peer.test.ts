import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startControllerIpc,callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
it('authenticates connected server before sending any request, rejecting async validators',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ipc-server-peer-')),socketPath=join(root,'s');let calls=0;
 const server=await startControllerIpc({socketPath,dispatch:async body=>{calls++;return body;}});
 try{
  for(const verifyServerPeer of [()=>{throw Error('wrong_server');},()=>Promise.reject(Error('async_denial'))]){
   await expect(callControllerIpc(socketPath,Buffer.from('secret'),{verifyServerPeer} as any)).rejects.toThrow();
  }
  expect(calls).toBe(0);
  let checked=false;await expect(callControllerIpc(socketPath,Buffer.from('ok'),{verifyServerPeer:()=>{checked=true;}} as any)).resolves.toEqual(Buffer.from('ok'));
  expect(checked).toBe(true);expect(calls).toBe(1);
 }finally{await server.close();rmSync(root,{recursive:true,force:true});}
});
it('uses actual kernel peer identity on client socket and sends no body to a non-root server',async()=>{
 if(process.platform==='win32'||process.getuid?.()===0)throw Error('requires ordinary Unix account');
 const {spawnSync}=await import('node:child_process');const {resolve}=await import('node:path');const {readControllerSocketPeer}=await import('../../../src/runtime/verification/socket-peer.js');
 const root=mkdtempSync(join(tmpdir(),'ipc-actual-server-')),socketPath=join(root,'s'),helper=join(root,'peer');let calls=0;
 const compile=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/socket-peer.c'),'-o',helper],{encoding:'utf8'});expect(compile.status).toBe(0);
 const server=await startControllerIpc({socketPath,dispatch:async body=>{calls++;return body;}});
 try{await expect(callControllerIpc(socketPath,Buffer.from('secret'),{verifyServerPeer(socket){const peer=readControllerSocketPeer(socket,helper);expect(peer.uid).toBe(process.getuid!());if(peer.uid!==0)throw Error('root_server_required');}})).rejects.toThrow('root_server_required');expect(calls).toBe(0);}finally{await server.close();rmSync(root,{recursive:true,force:true});}
});
