import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { configuredDesktopServicePorts, prepareDesktopServicePorts, readDesktopServicePorts } from '../../electron/desktop-service-discovery.js';
vi.mock('electron', () => ({ app: { isPackaged: false } }));

// Child environments must work across PID-specific discovery files.
import { buildDesktopServiceEnv, buildSidecarEnv } from '../../electron/sidecar-env.js';
describe('Desktop child service ports (#168 B1)', () => {
  it.each(['linux', 'win32'] as const)('passes selected non-default ports through the production env filter (%s)', async (platform) => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-child-ports-'));
    const probes = [createServer(), createServer()];
    try {
      for (const probe of probes) await new Promise<void>((resolve, reject) => {
        probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve);
      });
      const [a, b] = probes.map(probe => (probe.address() as { port: number }).port);
      // Both requested ports are held, forcing selection of different ports.
      const selected = await prepareDesktopServicePorts(join(root, 'ports.json'), { XIAOK_DESKTOP_PORT: String(a), KSWARM_PORT: String(b) });
      expect(selected.broker).not.toBe(a);
      expect(selected.kswarm).not.toBe(b);
      const parent = { HOME: root, GH_TOKEN: 'must-not-pass' };
      const inherited = buildDesktopServiceEnv(parent, selected);
      expect(configuredDesktopServicePorts(inherited)).toEqual(selected);
      const child = buildSidecarEnv(inherited, platform);
      expect(child.XIAOK_DESKTOP_PORT).toBe(String(selected.broker));
      expect(child.KSWARM_PORT).toBe(String(selected.kswarm));
      expect(configuredDesktopServicePorts(child)).toEqual(selected);
      expect(child).not.toHaveProperty('GH_TOKEN');
      expect(parent).toEqual({ HOME: root, GH_TOKEN: 'must-not-pass' });
    } finally {
      await Promise.all(probes.map(probe => new Promise<void>(resolve => probe.close(() => resolve()))));
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('publishes selected ports consistently across both broker names and keeps requested precedence in the configuration parser', () => {
    for (const parent of [
      { XIAOK_DESKTOP_PORT: '45121', INTENT_BROKER_PORT: '45122', KSWARM_PORT: '45123' },
      { INTENT_BROKER_PORT: '45122', KSWARM_PORT: '45123' },
    ]) {
      const requested = configuredDesktopServicePorts(parent);
      expect(requested.broker).toBe(parent.XIAOK_DESKTOP_PORT === undefined ? 45122 : 45121);
      const selected = { broker: 45124, kswarm: 45125 };
      const child = buildSidecarEnv(buildDesktopServiceEnv(parent, selected));
      expect(configuredDesktopServicePorts(child)).toEqual(selected);
      expect(child.INTENT_BROKER_PORT).toBe(String(selected.broker));
      expect(child.KSWARM_PORT).toBe(String(selected.kswarm));
      expect(configuredDesktopServicePorts(parent)).toEqual(requested);
    }
  });
});

import { createKSwarmService } from '../../electron/kswarm-service.js';
it.each(['implicit', 'explicit-canonical', 'explicit-alias'] as const)('publishes selected ports at the real Desktop preparation entry (%s)', async source => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-prepare-child-'));
  for (const name of ['XIAOK_DESKTOP_PORT', 'INTENT_BROKER_PORT', 'KSWARM_PORT']) vi.stubEnv(name, undefined);
  vi.stubEnv('XIAOK_CONFIG_DIR', root);
  const broker = join(root, 'broker.js'), kswarm = join(root, 'kswarm.js');
  writeFileSync(broker, '// broker fixture');
  writeFileSync(kswarm, '// kswarm fixture');
  vi.stubEnv('BROKER_SERVER_PATH', broker);
  vi.stubEnv('KSWARM_SERVER_PATH', kswarm);
  const probes = [createServer(), createServer()];
  const requested: number[] = [];
  if (source !== 'implicit') {
    for (const probe of probes) await new Promise<void>((resolve, reject) => {
      probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve);
    });
    requested.push(...probes.map(probe => (probe.address() as { port: number }).port));
    vi.stubEnv(source === 'explicit-alias' ? 'INTENT_BROKER_PORT' : 'XIAOK_DESKTOP_PORT', String(requested[0]));
    vi.stubEnv('KSWARM_PORT', String(requested[1]));
  }
  let service: ReturnType<typeof createKSwarmService> | undefined;
  let primary: { present: boolean; value?: unknown } = { present: false };
  try {
    service = createKSwarmService();
    // Build the real owner launch configuration without spawning services.
    const config = await service.activityOwnerConfig!();
    const selected = readDesktopServicePorts();
    expect(process.env.XIAOK_DESKTOP_PORT).toBe(String(selected.broker));
    expect(process.env.KSWARM_PORT).toBe(String(selected.kswarm));
    expect(process.env.INTENT_BROKER_PORT).toBe(String(selected.broker));
    if (source !== 'implicit') {
      expect(selected.broker).not.toBe(requested[0]);
      expect(selected.kswarm).not.toBe(requested[1]);
    }
    expect(configuredDesktopServicePorts(buildSidecarEnv(process.env))).toEqual(selected);
    expect(config.managedSources).toHaveLength(2);
    for (const source of config.managedSources!) expect(configuredDesktopServicePorts(source.env)).toEqual(selected);
  } catch (error) {
    primary = { present: true, value: error };
  } finally {
    const outcomes = await Promise.allSettled([
      ...(service ? [Promise.resolve().then(() => service!.stop())] : []),
      ...probes.filter(probe => probe.listening).map(probe => new Promise<void>((resolve, reject) =>
        probe.close(error => error ? reject(error) : resolve()))),
    ]);
    vi.unstubAllEnvs();
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failures.length) throw new AggregateError([
      ...(primary.present ? [primary.value] : []), ...failures.map(outcome => outcome.reason),
    ], 'Desktop port fixture close failed; root retained');
    rmSync(root, { recursive: true, force: true });
    if (primary.present) throw primary.value;
  }
});


// Actual process env crossing; the child reads no PID-specific discovery file.
it.each(['linux', 'win32'] as const)('occupied explicit ports reach a real child as selected facts (%s)', async platform => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-explicit-child-'));
  const probes = [createServer(), createServer()];
  let primary: { present: boolean; value?: unknown } = { present: false };
  try {
    for (const probe of probes) await new Promise<void>((resolve, reject) => {
      probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve);
    });
    const [broker, kswarm] = probes.map(probe => (probe.address() as { port: number }).port);
    const parent = { ...process.env, XIAOK_DESKTOP_PORT: String(broker), INTENT_BROKER_PORT: String(kswarm),
      KSWARM_PORT: String(kswarm), GH_TOKEN: 'not-a-real-token' };
    const before = { ...parent };
    const selected = await prepareDesktopServicePorts(join(root, 'ports.json'), parent);
    const env = buildSidecarEnv(buildDesktopServiceEnv(parent, selected), platform);
    const child = spawnSync(process.execPath, ['-e',
      'process.stdout.write(JSON.stringify({broker:process.env.XIAOK_DESKTOP_PORT,alias:process.env.INTENT_BROKER_PORT,kswarm:process.env.KSWARM_PORT,secret:process.env.GH_TOKEN}))'],
      { env, encoding: 'utf8' });
    console.info(JSON.stringify({ kind: 'desktop-selected-port-child', pid: child.pid, status: child.status, signal: child.signal,
      reaped: child.status !== null || child.signal !== null, platformFilter: platform, requested: { broker, kswarm }, selected }));
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ broker: String(selected.broker), alias: String(selected.broker), kswarm: String(selected.kswarm) });
    expect(selected.broker).not.toBe(broker);
    expect(selected.kswarm).not.toBe(kswarm);
    expect(parent).toEqual(before);
  } catch (error) {
    primary = { present: true, value: error };
  } finally {
    const outcomes = await Promise.allSettled(probes.filter(probe => probe.listening).map(probe => new Promise<void>((resolve, reject) =>
      probe.close(error => error ? reject(error) : resolve()))));
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failures.length) throw new AggregateError([
      ...(primary.present ? [primary.value] : []), ...failures.map(outcome => outcome.reason),
    ], 'Child port probes close failed; root retained');
    rmSync(root, { recursive: true, force: true });
    if (primary.present) throw primary.value;
  }
});
