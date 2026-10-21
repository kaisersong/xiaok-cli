import {createServer,createConnection} from 'node:net';
import {readControllerSocketAuditPeer,readControllerSocketPeer} from '../../../../src/runtime/verification/socket-peer.js';
const [socketPath,helper,kind]=process.argv.slice(2),body=Buffer.alloc(1024*1024,120);
const reader=kind==='audit'?readControllerSocketAuditPeer:readControllerSocketPeer;
let timerRan=false;
const server=createServer(socket=>{
 reader(socket,helper);let received=0;
 socket.on('data',chunk=>{received+=chunk.length;if(received===body.length)socket.end(body);else if(received>body.length)throw Error('overrun');});
});
await new Promise<void>(resolve=>server.listen(socketPath,resolve));
try{
 await new Promise<void>((resolve,reject)=>{
  const client=createConnection(socketPath);let received=0;
  client.on('error',reject);client.on('connect',()=>{reader(client,helper);setTimeout(()=>{timerRan=true;},0);client.write(body);});
  client.on('data',chunk=>{received+=chunk.length;});client.on('end',()=>{if(received!==body.length)reject(Error('incomplete'));else resolve();});
 });
 if(!timerRan)throw Error('event loop stalled');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
