import {it,expect} from 'vitest';
import {createServer} from 'node:http';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DockerEngineTransport} from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
const id='a'.repeat(64);
function frame(kind:number,body:string){const bytes=Buffer.from(body),head=Buffer.alloc(8);head[0]=kind;head.writeUInt32BE(bytes.length,4);return Buffer.concat([head,bytes]);}
async function fixture(run:(socketPath:string,server:ReturnType<typeof createServer>)=>Promise<void>){const root=mkdtempSync(join(tmpdir(),'docker-output-')),path=join(root,'engine.sock'),server=createServer(),sockets=new Set<import('node:net').Socket>();server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise<void>(r=>server.listen(path,r));try{await run(path,server);}finally{for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}}
it('attaches before start and decodes fragmented multiplex streams through actual EOF',async()=>fixture(async(path,server)=>{
 let started=false;server.on('upgrade',(req,socket)=>{expect(req.url).toBe('/v1.45/containers/'+id+'/attach?stream=1&stdout=1&stderr=1&stdin=0');expect(started).toBe(false);socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');setTimeout(()=>{expect(started).toBe(true);const bytes=Buffer.concat([frame(1,'hello'),frame(2,'error')]);socket.write(bytes.subarray(0,3));socket.end(bytes.subarray(3));},20);});
 const capture=await new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:1000});started=true;const result=await capture.completed;expect(result.complete).toBe(true);expect(result.stdout.toString()).toBe('hello');expect(result.stderr.toString()).toBe('error');
}));
it.each(['partial','invalid','limit','drip'])('does not claim complete output on %s',async(mode)=>fixture(async(path,server)=>{
 server.on('upgrade',(_req,socket)=>{socket.on('error',()=>{});socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');if(mode==='partial')socket.end(frame(1,'hello').subarray(0,10));else if(mode==='invalid'){const bytes=frame(1,'hello');bytes[1]=1;socket.end(bytes);}else if(mode==='limit')socket.end(frame(1,'x'.repeat(50)));else{const interval=setInterval(()=>socket.write(frame(1,'x')),10);socket.on('close',()=>clearInterval(interval));}});
 const start=performance.now(),capture=await new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:100,maximumBytes:32});const result=await capture.completed;expect(result.complete).toBe(false);if(mode==='limit')expect(result.truncated).toBe(true);if(mode==='drip'){expect(result.reason).toBe('deadline');expect(performance.now()-start).toBeLessThan(1000);}
}));
it('rejects failed handshake without starting and resolves capture cancellation as incomplete',async()=>fixture(async(path,server)=>{
 server.once('upgrade',(_req,socket)=>{socket.on('error',()=>{});socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');});
 await expect(new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:100})).rejects.toThrow('docker_attach_');
 server.once('upgrade',(_req,socket)=>{socket.on('error',()=>{});socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');});
 const capture=await new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:1000});capture.cancel();expect(await capture.completed).toMatchObject({complete:false,reason:'aborted'});
}));
it('half-closes only stdin and keeps reading delayed output, using a frozen input copy',async()=>fixture(async(path,server)=>{
 const input=Buffer.from('original\0input'),expected=Buffer.from(input);let received=Buffer.alloc(0);
 server.on('upgrade',(req,socket)=>{socket.allowHalfOpen=true;socket.on('error',()=>{});expect(req.url).toContain('stdin=1');socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);});socket.on('end',()=>setTimeout(()=>socket.end(frame(1,'after stdin EOF')),20));});
 const promise=new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:1000,stdin:input});input.fill(88);const capture=await promise,result=await capture.completed;expect(received).toEqual(expected);expect(result.complete).toBe(true);expect(result.stdout.toString()).toBe('after stdin EOF');
}));
it('refuses read-only HTTP attach fallback for stdin without hanging readiness',async()=>fixture(async(path,server)=>{
 server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n'));
 await expect(new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:100,stdin:Buffer.alloc(0)})).rejects.toThrow('docker_attach_stdin');
}));
it('bounds input before connecting and aborts a stalled full-duplex input/output stream',async()=>fixture(async(path,server)=>{
 let connected=0;server.on('upgrade',(_req,socket)=>{connected++;socket.on('error',()=>{});socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');socket.pause();});
 await expect(new DockerEngineTransport({socketPath:path}).attachOutput(id,{stdin:Buffer.alloc(2*1024**2+1)})).rejects.toThrow('docker_attach_stdin_limit');expect(connected).toBe(0);
 const capture=await new DockerEngineTransport({socketPath:path}).attachOutput(id,{timeoutMs:100,stdin:Buffer.alloc(2*1024**2)});expect(await capture.completed).toMatchObject({complete:false,reason:'deadline'});
}));
