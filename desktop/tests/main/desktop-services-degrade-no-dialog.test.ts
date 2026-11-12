// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createServer,type Server,type Socket} from 'node:net';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {startDesktopKSwarmServiceDegrading} from '../../electron/kswarm-service-lifetime.js';
import type {KSwarmService} from '../../electron/kswarm-service.js';

// #235: a broker that listens but never answers, as on a Windows host whose
// loopback to the bundled runtime is filtered. Startup must degrade without
// rejecting and without a dialog; Main only gets one code for a notice.
const servers:Server[]=[],sockets:Socket[]=[];
afterEach(async()=>{for(const s of sockets.splice(0))s.destroy();await Promise.all(servers.splice(0).map(s=>new Promise(done=>s.close(()=>done(undefined)))));vi.restoreAllMocks();});
async function silentBroker():Promise<number>{
 const server=createServer(socket=>{sockets.push(socket);});servers.push(server);
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 return (server.address() as {port:number}).port;
}
function serviceProbing(port:number):KSwarmService{
 let lastError:string|null=null;
 return {
  async start(){try{await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(300)});}catch{lastError='Server startup timeout';}},
  getStatus:()=>({running:lastError===null,lastError}),
 } as unknown as KSwarmService;
}

it('degrades without rejecting when the broker listens but never answers', async () => {
 const port=await silentBroker(),gate=new DesktopShutdownGate(),onDegraded=vi.fn(),error=vi.spyOn(console,'error').mockImplementation(()=>{});
 await expect(startDesktopKSwarmServiceDegrading(gate,serviceProbing(port),undefined,undefined,onDegraded)).resolves.toBeUndefined();
 expect(onDegraded).toHaveBeenCalledOnce();expect(onDegraded).toHaveBeenCalledWith('Server startup timeout');
 expect(error).toHaveBeenCalledWith('[main] Service bootstrap refused:','Server startup timeout');
 expect(await gate.drain(0)).toBe(true);
});

it('degrades the former Service bootstrap refused path when start itself rejects', async () => {
 const gate=new DesktopShutdownGate(),onDegraded=vi.fn();vi.spyOn(console,'error').mockImplementation(()=>{});
 const service={start:async()=>{throw Error('listen EADDRINUSE: address already in use 127.0.0.1:4318');},getStatus:()=>({running:false,lastError:null})} as unknown as KSwarmService;
 await expect(startDesktopKSwarmServiceDegrading(gate,service,undefined,undefined,onDegraded)).resolves.toBeUndefined();
 expect(onDegraded).toHaveBeenCalledWith('listen EADDRINUSE: address already in use 127.0.0.1:4318');
});

// The Runtime bridge startup failed path is exercised on Main's actual
// startRuntimeBridge in runtime-bridge-readiness.cases.ts (warning kept, notice added).
it('Main composes both paths through the degrade contract and opens no error dialog', () => {
 const main=readFileSync(fileURLToPath(new URL('../../electron/main.ts',import.meta.url)),'utf8');
 expect(main).not.toMatch(/showMessageBox\(\s*\{\s*type:\s*'error'/);
 expect(main).not.toContain('服务启动失败 / Service startup failed');
 expect(main).toMatch(/:\s*startDesktopKSwarmServiceDegrading\(desktopShutdownGate,\s*kswarmService,/);
 expect(main).toMatch(/console\.warn\('\[main\] Runtime bridge startup failed:'[^\n]*\n\s*desktopServicesDegradedNoticeOnce\(/);
});
