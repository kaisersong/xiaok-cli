import { describe, it, expect } from 'vitest';
import { DockerEngineTransport } from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
import { buildDockerWorkerRequest } from '../../../src/runtime/isolated-execution/docker-request.js';

const socket = process.env.SOL_PI_DOCKER_PROBE_SOCKET;
const image = process.env.SOL_PI_DOCKER_PROBE_IMAGE;
describe.skipIf(!socket || !image)('real Docker isolation diagnostic (not service identity qualification)', () => {
  it('actually enforces readonly root, nonroot, seccomp, no privileges, cgroup limits and no host socket', async () => {
    const engine = new DockerEngineTransport({ socketPath: socket! });
    const request = buildDockerWorkerRequest({ imageDigest: image!, attemptId: 'probe-' + process.pid, scopeDigest: 'b'.repeat(64), argv: ['/bin/sh', '-c',
      "id -u; awk '/NoNewPrivs|Seccomp:|CapEff/{print}' /proc/self/status; if touch /escape 2>/dev/null; then exit 91; fi; test ! -e /var/run/docker.sock || exit 92; test ! -e /Users || exit 93; cat /sys/fs/cgroup/pids.max; cat /sys/fs/cgroup/memory.max; if nc -w 1 1.1.1.1 443 </dev/null; then exit 94; fi; printf 'ISOLATION_PROBE_DONE\\n'" ] });
    const created = await engine.create(request);
    try {
      await engine.start(created.Id); await engine.wait(created.Id);
      const inspected = await engine.inspect(created.Id);
      expect(inspected.State).toMatchObject({ Running: false, Pid: 0, ExitCode: 0 });
      expect(inspected.HostConfig).toMatchObject({ NetworkMode: 'none', Privileged: false, ReadonlyRootfs: true, PidsLimit: 64 });
      const output = await engine.logs(created.Id);
      expect(output).toContain('10000'); expect(output).toContain('ISOLATION_PROBE_DONE');
      expect(output).toMatch(/NoNewPrivs:\s+1/); expect(output).toMatch(/Seccomp:\s+2/);
      expect(output).toMatch(/CapEff:\s+0000000000000000/); expect(output).toContain('268435456');
    } finally { await engine.remove(created.Id); }
  }, 30000);
  it('wait supports a worker that produces no response for more than fifteen seconds', async () => {
    const engine = new DockerEngineTransport({ socketPath: socket! });
    const created = await engine.create(buildDockerWorkerRequest({ imageDigest: image!, attemptId: 'long-probe-' + process.pid, scopeDigest: 'b'.repeat(64), argv: ['/bin/sleep', '16'] }));
    try { await engine.start(created.Id); expect((await engine.wait(created.Id)).StatusCode).toBe(0); }
    finally {
      const state = await engine.inspect(created.Id); if (state.State.Running) { await engine.kill(created.Id); await engine.wait(created.Id); }
      await engine.remove(created.Id);
    }
  }, 30000);

});
