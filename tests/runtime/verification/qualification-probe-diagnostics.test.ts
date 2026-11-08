import {afterEach, expect, it, vi} from 'vitest';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveBlobAuthority} from '../../support/primitive-blob-authority.js';
import {createInstalledEngineQualification} from '../../../src/runtime/verification/installed-engine-qualification.js';
import {buildNetdeviceTransmitDisabledCheck} from '../../../src/runtime/verification/netdevice-transmit-disabled.js';

const retainedUnknownFixtures = new Set<object>();
const captured = vi.hoisted(() => ({requests: [] as Array<{Cmd: string[]}>}));
vi.mock('../../../src/runtime/verification/installed-engine.js', () => ({
  assertInstalledMacEngineHandle() {}, assertInstalledEngineDatabase() {},
  inspectInstalledMacEngineHandle: async () => {},
}));
vi.mock('../../../src/runtime/verification/root-broker-client.js', () => ({
  createInstalledRootBrokerClient: () => ({dispose() {}}),
}));
vi.mock('../../../src/runtime/isolated-execution/docker-engine-transport.js', () => ({
  DockerEngineTransport: class {
    async create(request: {Cmd: string[]}) {
      captured.requests.push(request);
      throw Error('fixture diagnostic request captured before Docker dispatch');
    }
    async recoverAttempt() { throw Error('fixture has no Docker container'); }
  },
}));
afterEach(() => { captured.requests.length = 0; });

// Real qualification producer/SQLite/journal/budget, with existing test-only
// engine identity and transport leaves. This never issues an OS qualification.
async function withActualProbe(body: (script: string, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'qualification-diagnostic-'));
  const database = openPrivateVerificationDatabase(root);
  const budget = createPrimitiveBlobAuthority({
    database, authorityId: 'qualification-diagnostic', assertCurrent() {},
    deletion: {assertDeleted() { throw Error('no physical deletion'); }},
  }).budget;
  const engine = {hostSocket: '/unused-fixture.sock', imageDigest: 'sha256:' + 'a'.repeat(64), observation: {engineId: 'fixture-engine'}};
  const qualification = createInstalledEngineQualification({engine: engine as never, database, budget});
  const held = {root, database, budget, qualification};
  retainedUnknownFixtures.add(held);
  let primary: {error: unknown} | undefined;
  const errors: unknown[] = [];
  try {
    await expect(qualification.qualify()).rejects.toThrow('fixture diagnostic request captured before Docker dispatch');
    expect(captured.requests).toHaveLength(1);
    const request = captured.requests[0]!;
    expect(request.Cmd.slice(0, 2)).toEqual(['/bin/sh', '-c']);
    expect(request.Cmd).toHaveLength(3);
    body(request.Cmd[2]!, root);
  } catch (error) { primary = {error}; }
  finally {
    for (const close of [() => qualification.close(), () => budget.close(), () => database.close()]) {
      try { close(); } catch (error) { errors.push(error); }
    }
    if (!errors.length) {
      rmSync(root, {recursive: true, force: true});
      retainedUnknownFixtures.delete(held);
    }
  }
  if (errors.length) throw new AggregateError([...(primary ? [primary.error] : []), ...errors], 'qualification_fixture_cleanup_unknown');
  if (primary) throw primary.error;
}

it('keeps the actual fixed network-transmit check and adds stage diagnostics without changing policy order', async () => {
  await withActualProbe(script => {
    expect(script).toContain(buildNetdeviceTransmitDisabledCheck());
    expect(script).toContain('probe_stage=network_transmit_disabled');
    expect(script).not.toContain('[ "$(ls /sys/class/net)" = lo ]');
    expect(script).toContain('qualification_probe_failure stage=%s exit=%s');
    expect(script.indexOf('probe_stage=cpu_max')).toBeLessThan(script.indexOf('probe_stage=network_transmit_disabled'));
    expect(script.indexOf('probe_stage=network_transmit_disabled')).toBeLessThan(script.indexOf('probe_stage=docker_socket_absent'));
  });
});

it.skipIf(process.platform === 'win32')('the actual fixed shell probe preserves a failed UID exit and reports its stage on stderr', async () => {
  await withActualProbe((script, root) => {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // Only the test child gets this deterministic failed UID executable.
    writeFileSync(join(bin, 'id'), '#!/bin/sh\nprintf 9999\n', {mode: 0o700});
    // The full probe targets the Linux worker shell. Darwin bash 3.2 rejects
    // the unchanged nested case parser in -n mode; the early UID failure below
    // still runs the exact production command on this POSIX host.
    if (process.platform === 'linux') {
      const syntax = spawnSync('/bin/sh', ['-n', '-c', script], {encoding: 'utf8'});
      expect(syntax.error).toBeUndefined();
      expect(syntax.status, syntax.stderr).toBe(0);
    }
    const result = spawnSync('/bin/sh', ['-c', script], {
      encoding: 'utf8', env: {...process.env, PATH: bin + delimiter + (process.env.PATH ?? '')},
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('qualification_probe_failure stage=uid exit=1\n');
  });
});
