import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DockerEngineTransport } from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
import { buildDockerWorkerRequest } from '../../../src/runtime/isolated-execution/docker-request.js';

describe('actual IPC create-response loss recovery, never terminal by absence', () => {
  it('cannot mutate approved worker policy while the real image-inspect request is in flight', async () => {
    const root = mkdtempSync(join(tmpdir(), 'attempt-policy-race-'));
    const socket = process.platform === 'win32' ? '\\\\.\\pipe\\attempt-' + randomUUID() : join(root, 'engine.sock');
    const spec = buildDockerWorkerRequest({ imageDigest: 'sha256:' + 'a'.repeat(64), argv: ['/bin/true'], attemptId: 'attempt-2', scopeDigest: 'b'.repeat(64) });
    let actualCreate: any;
    const server = createServer((req, res) => {
      if (req.url!.includes('/images/')) {
        spec.HostConfig.Privileged = true; spec.Cmd[0] = '/bin/evil';
        req.resume(); res.end(JSON.stringify({ Id: spec.Image, Config: { Env: null } }));
      } else {
        const chunks: Buffer[] = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
          actualCreate = JSON.parse(Buffer.concat(chunks).toString()); res.end(JSON.stringify({ Id: 'c'.repeat(64) }));
        });
      }
    });
    await new Promise<void>(resolve => server.listen(socket, resolve));
    try {
      await new DockerEngineTransport({ socketPath: socket }).create(spec);
      expect(actualCreate.HostConfig.Privileged).toBe(false);
      expect(actualCreate.Cmd).toEqual(['/bin/true']);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  });
  it('uses a stable attempt name and requires exact identity on recovery without starting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'attempt-recovery-'));
    const socket = process.platform === 'win32' ? '\\\\.\\pipe\\attempt-' + randomUUID() : join(root, 'engine.sock');
    const spec = buildDockerWorkerRequest({ imageDigest: 'sha256:' + 'a'.repeat(64), argv: ['/bin/true'], attemptId: 'attempt-1', scopeDigest: 'b'.repeat(64) });
    const paths: string[] = []; let mismatch = false; let missing = false;
    const server = createServer((req, res) => {
      paths.push(req.url!); req.resume();
      if (req.url!.includes('/images/')) res.end(JSON.stringify({ Id: spec.Image, Config: { Env: null } }));
      else if (req.url!.includes('/create?')) res.end(JSON.stringify({ Id: 'c'.repeat(64) }));
      else if (missing) { res.statusCode = 404; res.end('{}'); }
      else res.end(JSON.stringify({ Id: 'c'.repeat(64), Name: '/xiaok-attempt-1', Image: spec.Image, Config: { Labels: { ...spec.Labels, ...(mismatch ? { 'xiaok.scope': 'd'.repeat(64) } : {}) } } }));
    });
    await new Promise<void>(resolve => server.listen(socket, resolve));
    try {
      const engine = new DockerEngineTransport({ socketPath: socket });
      await engine.create(spec);
      expect(paths).toContain('/v1.45/containers/create?name=xiaok-attempt-1');
      await expect(engine.recoverAttempt(spec)).resolves.toEqual({ Id: 'c'.repeat(64) });
      mismatch = true;
      await expect(engine.recoverAttempt(spec)).rejects.toThrow('docker_engine_attempt_identity');
      missing = true;
      await expect(engine.recoverAttempt(spec)).rejects.toThrow('docker_engine_http_404');
      expect(paths.some(path => path.endsWith('/start'))).toBe(false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  });
});
