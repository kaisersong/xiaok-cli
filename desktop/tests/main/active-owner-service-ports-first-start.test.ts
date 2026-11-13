import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeOwnerServicePorts } from '../../electron/active-owner-service-ports.js';

// 1.6.3 RC blocker: on a blank-config first start the profile files already
// exist but no activity owner was ever configured. Discovery must report "no
// live owner" instead of failing preparePorts() with
// activity_owner_qualification_unavailable (which refused service bootstrap
// and blocked the first window behind a synchronous error dialog).
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function firstStartRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-first-start-ports-'));
  roots.push(root);
  writeFileSync(join(root, 'continuity-profile.json'), '{}', { mode: 0o600 });
  writeFileSync(join(root, 'codex-native.sqlite'), '', { mode: 0o600 });
  return root;
}

it('finds no live owner on a first start that has a profile but no owner config', async () => {
  await expect(activeOwnerServicePorts(firstStartRoot())).resolves.toBeUndefined();
});

it('finds no live owner when the data root does not exist yet', async () => {
  await expect(activeOwnerServicePorts(join(tmpdir(), `xiaok-missing-${process.pid}-${Date.now()}`))).resolves.toBeUndefined();
});

it('keeps refusing an owner config that exists without a qualifiable owner', async () => {
  const root = firstStartRoot();
  writeFileSync(join(root, 'activity-owner.config.json'), '{not json', { mode: 0o600 });
  await expect(activeOwnerServicePorts(root)).rejects.toThrow();
});
