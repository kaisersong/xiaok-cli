import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { startControllerIpc, callControllerIpc } from '../../../src/runtime/verification/controller-ipc.js';
describe('bounded private controller IPC over real local sockets', () => {
  const endpoint = (root: string) => process.platform === 'win32' ? '\\\\.\\pipe\\xiaok-controller-' + randomUUID() : join(root, 'controller.sock');
  it('runs the real dispatcher and refuses an occupied endpoint without replacing its owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-ipc-')), socketPath = endpoint(root);
    const server = await startControllerIpc({ socketPath, dispatch: async body => Buffer.from('ok:' + body.toString('utf8')) });
    try {
      expect((await callControllerIpc(socketPath, Buffer.from('request'))).toString()).toBe('ok:request');
      await expect(startControllerIpc({ socketPath, dispatch: async body => body })).rejects.toThrow();
      expect((await callControllerIpc(socketPath, Buffer.from('second'))).toString()).toBe('ok:second');
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects oversized frames before dispatch and closes a dripping partial request at its absolute deadline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-ipc-')), socketPath = endpoint(root); let calls = 0;
    const server = await startControllerIpc({ socketPath, requestTimeoutMs: 50, dispatch: async body => { calls++; return body; } });
    try {
      const client = connect(socketPath); client.on('error', () => {});
      await new Promise<void>(resolve => { client.on('connect', () => { const header = Buffer.alloc(4); header.writeUInt32BE(2 * 1024 ** 2); client.write(header); }); client.on('close', resolve); });
      const drip = connect(socketPath); drip.on('error', () => {});
      await new Promise<void>(resolve => {
        let timer: ReturnType<typeof setInterval>;
        drip.on('connect', () => { const header = Buffer.alloc(4); header.writeUInt32BE(1000); drip.write(header); timer = setInterval(() => drip.write('x'), 5); });
        drip.on('close', () => { clearInterval(timer); resolve(); });
      });
      expect(calls).toBe(0);
    } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('aborts an in-flight dispatch when its client leaves, without claiming its side effects were undone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-ipc-')), socketPath = endpoint(root);
    let notify!: () => void; const aborted = new Promise<void>(resolve => { notify = resolve; });
    const server = await startControllerIpc({ socketPath, dispatch: async (_body, signal) => new Promise<Buffer>((_resolve, reject) => { signal.addEventListener('abort', () => { notify(); reject(Error('cancelled')); }, { once: true }); }) });
    try { await expect(callControllerIpc(socketPath, Buffer.from('request'), { timeoutMs: 30 })).rejects.toThrow('controller_ipc_timeout_unknown'); await aborted; }
    finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
  });  it('retains admission slots for disconnected handlers until physical drain completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'controller-ipc-')), socketPath = endpoint(root);
    let calls = 0; const drains: Array<() => void> = [];
    const server = await startControllerIpc({ socketPath, dispatch: async () => {
      calls++; await new Promise<void>(resolve => drains.push(resolve)); return Buffer.from('done');
    } });
    try {
      for (let i = 0; i < 5; i++) await expect(callControllerIpc(socketPath, Buffer.from('request'), { timeoutMs: 30 })).rejects.toThrow();
      expect(calls).toBe(4);
    } finally { for (const drain of drains) drain(); await server.close(); rmSync(root, { recursive: true, force: true }); }
  });

});

it.skipIf(process.platform === 'win32')('snapshots the socket endpoint before listen so an accessor cannot redirect chmod', async () => {
 const root=mkdtempSync(join(tmpdir(),'ipc-options-')),socketPath=join(root,'service.sock'),victim=join(root,'victim');writeFileSync(victim,'untouched',{mode:0o600});let reads=0;
 const server=await startControllerIpc({get socketPath(){return ++reads<4?socketPath:victim;},publicPeerAuthenticated:true,acceptPeer:()=>({}),dispatch:async b=>b});
 try {expect(statSync(victim).mode&0o777).toBe(0o600);expect(reads).toBe(1);expect(statSync(socketPath).mode&0o777).toBe(0o666);}finally{await server.close();rmSync(root,{recursive:true,force:true});}
});

it('captures public peer authenticator once before validation and socket admission', async () => {
 const root=mkdtempSync(join(tmpdir(),'ipc-peer-getter-')),socketPath=join(root,'service.sock');let reads=0,authenticated=0;
 const server=await startControllerIpc({socketPath,publicPeerAuthenticated:true,get acceptPeer(){return ++reads===1?()=>{authenticated++;return {uid:501};}:undefined;},async dispatch(_body,_signal,peer){expect(peer).toEqual({uid:501});return Buffer.from('ok');}});
 try{await expect(callControllerIpc(socketPath,Buffer.from('request'))).resolves.toEqual(Buffer.from('ok'));expect(reads).toBe(1);expect(authenticated).toBe(1);}
 finally{await server.close();rmSync(root,{recursive:true,force:true});}
});
