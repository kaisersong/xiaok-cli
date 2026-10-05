import { describe, it, expect } from 'vitest';
import { buildDockerWorkerRequest, assertDockerImageConfiguration } from '../../../src/runtime/isolated-execution/docker-request.js';

describe('isolated execution fixed Docker request', () => {
  const input = () => ({ imageDigest: 'sha256:' + 'a'.repeat(64), argv: ['/bin/sh', '-c', 'id'], attemptId: 'attempt1', scopeDigest: 'b'.repeat(64) });
  it('drops privilege, network, shared namespaces and writable root without image entrypoint/env inheritance', () => {
    const body = buildDockerWorkerRequest(input());
    expect(body).toMatchObject({ Image: input().imageDigest, User: '10000:10000', Entrypoint: [''], Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp'],
      HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], PidsLimit: 64, Memory: 268435456, MemorySwap: 268435456, CgroupnsMode: 'private', IpcMode: 'none', Binds: [], PortBindings: {}, RestartPolicy: { Name: 'no' } } });
    expect(body.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
    expect(body.HostConfig.SecurityOpt.some(s => s.startsWith('seccomp='))).toBe(true);
  });
  it('rejects tags, arbitrary fields, non-finite resources and excessive command bytes', () => {
    for (const request of [{ ...input(), imageDigest: 'alpine:latest' }, { ...input(), env: { TOKEN: 'x' } }, { ...input(), memoryBytes: NaN }, { ...input(), argv: ['x'.repeat(131073)] }]) {
      expect(() => buildDockerWorkerRequest(request)).toThrow();
    }
  });
  it('does not trust image-inherited volumes, credentials, OnBuild or health scripts', () => {
    expect(() => assertDockerImageConfiguration({ Env: null, Volumes: null, OnBuild: null })).not.toThrow();
    for (const config of [{ Env: null, Entrypoint: ['/arbitrary'] }, { Env: ['TOKEN=hidden'] }, { Env: ['PATH=/bin'], Volumes: { '/controller': {} } }, { Env: ['PATH=/bin'], OnBuild: ['RUN malicious'] }]) {
      expect(() => assertDockerImageConfiguration(config)).toThrow();
    }
  });

});
