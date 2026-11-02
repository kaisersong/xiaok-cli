import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ownerPathPrefixes, ownersWithPrefixes, retireActivityOwnersUnder, type ActivityOwnerProcess,
} from '../../support/activity-owner-teardown.js';

// #145：用例收尾闸门自身的失败路径。进程表与产品 retire 都用桩，只验证闸门的分类与认领。
describe('activity owner teardown gate (#145)', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  const makeOwner = (pid: number, statusPid: number | null = pid) => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-owner-gate-'));
    roots.push(root);
    const dataRoot = join(realpathSync(root), 'config', 'conversation-activity', 'abc');
    mkdirSync(dataRoot, { recursive: true });
    if (statusPid !== null) writeFileSync(join(dataRoot, 'activity-owner.status.json'), JSON.stringify({ pid: statusPid, ownerEpoch: 'e', rootHash: 'h' }));
    return { root, dataRoot, owner: { pid, configPath: join(dataRoot, 'activity-owner.config.json') } as ActivityOwnerProcess };
  };

  it('reports an owner the product keeps for pending work as a survivor', async () => {
    const { root, dataRoot, owner } = makeOwner(41001);
    const seen: string[] = [];
    const survivors = await retireActivityOwnersUnder([root], {
      list: () => [owner],
      retire: async (dir) => { seen.push(dir); return 'kept_pending'; },
    });
    expect(seen).toEqual([dataRoot]);
    expect(survivors).toEqual([{ ...owner, reason: 'kept_pending' }]);
  });

  it('reports retired_but_alive when the product says retired but the process is still listed', async () => {
    const { root, owner } = makeOwner(41002);
    const survivors = await retireActivityOwnersUnder([root], { list: () => [owner], retire: async () => 'retired' });
    expect(survivors).toEqual([{ ...owner, reason: 'retired_but_alive' }]);
  });

  it('returns no survivors once the retired owner is gone from the process table', async () => {
    const { root, owner } = makeOwner(41003);
    let table = [owner];
    const survivors = await retireActivityOwnersUnder([root], { list: () => table, retire: async () => { table = []; return 'retired'; } });
    expect(survivors).toEqual([]);
  });

  it('does not call retire for an owner without a usable status file or with a foreign pid', async () => {
    const missing = makeOwner(41004, null);
    const foreign = makeOwner(41005, 99999);
    let calls = 0;
    const survivors = await retireActivityOwnersUnder([missing.root, foreign.root], {
      list: () => [missing.owner, foreign.owner],
      retire: async () => { calls += 1; return 'retired'; },
    });
    expect(calls).toBe(0);
    expect(survivors).toEqual([{ ...missing.owner, reason: 'missing_status' }, { ...foreign.owner, reason: 'status_pid_mismatch' }]);
  });

  it.skipIf(process.platform === 'win32')('claims owners through a symlinked case root and ignores owners of other roots', async () => {
    const mine = makeOwner(41006);
    const other = makeOwner(41007);
    const alias = `${mine.root}-alias`;
    symlinkSync(mine.root, alias, 'dir');
    roots.push(alias);
    const survivors = await retireActivityOwnersUnder([alias], { list: () => [mine.owner, other.owner], retire: async () => 'kept_unknown' });
    expect(survivors).toEqual([{ ...mine.owner, reason: 'kept_unknown' }]);
  });

  it('keeps matching a late owner after its case directory was removed when prefixes were taken beforehand', () => {
    const { root, owner } = makeOwner(41008);
    const prefixes = ownerPathPrefixes([root]);
    rmSync(root, { recursive: true, force: true });
    expect(ownersWithPrefixes(prefixes, () => [owner])).toEqual([owner]);
  });
});
