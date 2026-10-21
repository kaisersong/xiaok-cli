import {it,expect} from 'vitest';
import {readControllerSocketAuditPeer} from '../../../src/runtime/verification/socket-peer.js';
import {createServer,createConnection} from 'node:net';import {spawnSync} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
it.skipIf(process.platform!=='darwin')('reads original caller audit session from the accepted socket kernel token',async()=>{
 const root=mkdtempSync(join(tmpdir(),'audit-peer-')),helper=join(root,'peer'),socketPath=join(root,'service.sock');let facts:any;
 const built=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/socket-audit-peer.c'),'-lbsm','-o',helper],{encoding:'utf8'});expect(built.status,built.stderr).toBe(0);
 const server=createServer(socket=>{facts={status:0,body:JSON.stringify(readControllerSocketAuditPeer(socket,helper))};socket.resume();socket.end('ok');});
 await new Promise<void>(r=>server.listen(socketPath,r));
 try {await new Promise<void>((r,j)=>{const c=createConnection(socketPath);c.on('connect',()=>c.write('{"uid":0,"auditSessionId":0}'));c.on('error',j);c.on('data',()=>{});c.on('end',r);});expect(facts.status).toBe(0);const peer=JSON.parse(facts.body);expect(peer.uid).toBe(process.getuid!());expect(peer.gid).toBe(process.getgid!());expect(Number.isInteger(peer.auditSessionId)).toBe(true);expect(peer.auditSessionId).toBeGreaterThan(0);expect(peer.pid).toBe(process.pid);
 expect(spawnSync(helper,[],{encoding:'utf8'}).status).not.toBe(0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}
});
