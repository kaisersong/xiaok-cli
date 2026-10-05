import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DockerEngineTransport } from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
import { buildDockerWorkerRequest } from '../../../src/runtime/isolated-execution/docker-request.js';

describe('real local IPC transport rejection paths (not engine qualification)', () => {
  let root: string, socket: string, server: Server, engine: DockerEngineTransport; let paths: string[];
  let respond: (path: string) => unknown;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'docker-protocol-'));
    socket = process.platform === 'win32' ? '\\\\.\\pipe\\xiaok-probe-' + randomUUID() : join(root, 'engine.sock');
    paths = []; respond = () => ({});
    server = createServer((req, res) => { paths.push(req.url!); req.resume(); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(respond(req.url!))); });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    engine = new DockerEngineTransport({ socketPath: socket });
  });
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });
  it('rejects privilege mutations and traversal IDs before any daemon request', async () => {
    const body = buildDockerWorkerRequest({ imageDigest: 'sha256:' + 'a'.repeat(64), argv: ['/bin/true'], attemptId: 'a', scopeDigest: 'b'.repeat(64) });
    body.HostConfig.Privileged = true;
    await expect(engine.create(body)).rejects.toThrow('docker_engine_unapproved_spec');
    await expect(engine.inspect('../containers/other')).rejects.toThrow('docker_engine_container_id');
    expect(paths).toHaveLength(0);
  });
  it('never DELETEs a still-running container', async () => {
    const id = 'a'.repeat(64); respond = () => ({ Id: id, State: { Running: true, Pid: 42 } });
    await expect(engine.remove(id)).rejects.toThrow('docker_engine_remove_running'); expect(paths).toEqual(['/v1.45/containers/' + id + '/json']);
  });
  it('rejects an oversized real socket response and a non-platform image ID', async () => {
    respond = () => ({ huge: 'x'.repeat(5 * 1024 ** 2) });
    await expect(engine.inspect('a'.repeat(64))).rejects.toThrow('docker_engine_response_limit');
    respond = () => ({ Id: 'sha256:' + 'b'.repeat(64), Config: { Env: null } });
    await expect(engine.create(buildDockerWorkerRequest({ imageDigest: 'sha256:' + 'a'.repeat(64), argv: ['/bin/true'], attemptId: 'a', scopeDigest: 'b'.repeat(64) }))).rejects.toThrow('docker_engine_image_identity');
  });
  it('enforces an absolute deadline even while the real IPC server drips bytes', async () => {
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      const body = '{"StatusCode":0}'; let offset = 0;
      const timer = setInterval(() => { if (offset < body.length) res.write(body[offset++]); else { clearInterval(timer); res.end(); } }, 10);
      res.on('close', () => clearInterval(timer));
    });
    await expect(engine.wait('a'.repeat(64), { timeoutMs: 50 })).rejects.toThrow('docker_engine_timeout_unknown');
  });
  it('aborts a streaming response and closes the real socket before server shutdown', async () => {
    server.removeAllListeners('request');
    let sawRequest!: () => void; let sawClose!: () => void;
    const requested = new Promise<void>(resolve => { sawRequest = resolve; });
    const closed = new Promise<void>(resolve => { sawClose = resolve; });
    server.on('request', (_req, res) => {
      res.write('{'); sawRequest();
      res.on('close', sawClose);
    });
    const controller = new AbortController();
    const waiting = engine.wait('a'.repeat(64), { timeoutMs: 1000, signal: controller.signal });
    const rejected = expect(waiting).rejects.toThrow('docker_engine_aborted_unknown');
    await requested; controller.abort(); await rejected; await closed;
  });
  it('does not send an already aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(engine.wait('a'.repeat(64), { signal: controller.signal })).rejects.toThrow('docker_engine_aborted_unknown');
    expect(paths).toHaveLength(0);
  });
  it('rejects a response whose synchronous parsing crosses the monotonic deadline', async () => {
    respond = () => ({ StatusCode: 0 });
    const original = JSON.parse;
    const parser = vi.spyOn(JSON, 'parse').mockImplementation((text: string, ...rest: any[]) => {
      const result = original(text, ...rest);
      if (text === '{"StatusCode":0}') {
        const until = performance.now() + 70;
        while (performance.now() < until) { /* real blocked event loop, timer cannot run */ }
      }
      return result;
    });
    try { await expect(engine.wait('a'.repeat(64), { timeoutMs: 50 })).rejects.toThrow('docker_engine_timeout_unknown'); }
    finally { parser.mockRestore(); }
  });

  it('rejects a leaf larger than the exact remaining caller budget before GET allocation',async()=>{
    server.removeAllListeners('request');let gets=0;
    server.on('request',(req,res)=>{if(req.method==='GET'){gets++;res.end(Buffer.alloc(2048));return;}const path=new URL(req.url!,'http://local').searchParams.get('path')!;res.setHeader('x-docker-container-path-stat',Buffer.from(JSON.stringify({name:path.split('/').at(-1),size:path==='/artifacts'?0:64,mode:path==='/artifacts'?0x800001c0:0x100,linkTarget:''})).toString('base64'));res.end();});
    await expect(engine.readArtifactArchive('a'.repeat(64),'result',{maxBytes:12})).rejects.toThrow('docker_artifact_limit');expect(gets).toBe(0);
  });

});
