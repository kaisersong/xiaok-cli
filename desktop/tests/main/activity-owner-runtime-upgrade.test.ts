import { expect, it, vi } from 'vitest';
import { ACTIVITY_OWNER_RUNTIME_UPGRADE_REQUIRED, isActivityOwnerRuntimeUpgrade } from '../../electron/activity-owner-runtime-upgrade.js';
import { createOnceNotice } from '../../electron/activity-owner-startup.js';
import { startDesktopKSwarmServiceDegrading } from '../../electron/kswarm-service-lifetime.js';
import { DesktopShutdownGate } from '../../electron/shutdown-aware-ipc-main.js';
import { activityOwnerConfigDigest } from '../../../src/runtime/conversation-activity/owner-config.js';
import type { ActivityOwnerConfig } from '../../../src/runtime/conversation-activity/owner-runtime.js';

function config(node: string, sqlite: string, hash: string): ActivityOwnerConfig {
  return {
    schemaVersion: 1,
    dataRoot: '/test/profile',
    profileRoot: '/test/profile',
    profileId: 'desktop-test',
    actorId: 'desktop-user:desktop-test',
    identity: { kind: 'desktop', path: '/test/profile/groups.sqlite' },
    managedSources: [{
      name: 'broker', executable: '/test/app/node', entryPath: '/test/app/broker.js',
      cwd: '/test/profile', healthUrl: 'http://127.0.0.1:4318/health',
      expectedHealth: {
        ok: true, 'service.entryPath': '/test/app/broker.js', 'service.entryHash': 'a'.repeat(64),
        'service.runtime.node': node, 'service.runtime.sqlite': sqlite,
        'service.runtime.executableSha256': hash, 'service.runtime.execPath': '/test/app/node',
      },
    }],
  };
}

const current = config('24.22.3', '3.54.1', 'c'.repeat(64));
const previous = () => config('24.19.0', '3.53.3', 'b'.repeat(64));

it('identifies the authenticated previous broker pin without accepting the previous owner', () => {
  const old = previous();
  expect(isActivityOwnerRuntimeUpgrade(current, old, activityOwnerConfigDigest(old))).toBe(true);
  expect(isActivityOwnerRuntimeUpgrade(current, old, activityOwnerConfigDigest(current))).toBe(false);
  expect(isActivityOwnerRuntimeUpgrade(current, current, activityOwnerConfigDigest(current))).toBe(false);
});

it('keeps profile, source, port and unrecognized version mismatches on the existing failure path', () => {
  for (const change of [
    (old: ActivityOwnerConfig) => { old.profileId = 'other'; },
    (old: ActivityOwnerConfig) => { old.managedSources![0]!.healthUrl = 'http://127.0.0.1:14618/health'; },
    (old: ActivityOwnerConfig) => { old.managedSources![0]!.expectedHealth['service.entryHash'] = 'd'.repeat(64); },
    (old: ActivityOwnerConfig) => { old.managedSources![0]!.expectedHealth['service.runtime.node'] = '24.16.0'; },
  ]) {
    const old = previous();
    change(old);
    expect(isActivityOwnerRuntimeUpgrade(current, old, activityOwnerConfigDigest(old))).toBe(false);
  }
});

it.each(['zh', 'en'] as const)('shows restart instructions and does not start a second writer (%s)', async locale => {
  const show = vi.fn();
  const release = vi.fn();
  const start = vi.fn();
  const attach = vi.fn(async () => { throw Error(ACTIVITY_OWNER_RUNTIME_UPGRADE_REQUIRED); });
  const service = { activityOwnerConfig: vi.fn(async () => ({})), releaseActivityOwnerDelegation: release, start };
  await startDesktopKSwarmServiceDegrading(new DesktopShutdownGate(), service as never, attach, vi.fn(),
    createOnceNotice(show, locale));
  expect(attach).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  expect(show).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(locale === 'zh' ? /重启电脑/ : /restart your computer/));
});
