import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildSeedAgentReconciliationPlan,
  getPreferredPoAgentId,
  getPreferredWorkerSeedId,
} from '../../shared/kswarm-seed-contract.js';
import {
  getDevelopmentBrokerLaunchSpec,
  getDevelopmentServiceCandidates,
} from '../../electron/kswarm-service-paths.js';

describe('kswarm seed contract', () => {
  it('returns no-op when dedicated xiaok seed pair already exists', () => {
    const plan = buildSeedAgentReconciliationPlan([
      { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'] },
      { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'] },
    ]);

    expect(plan.create).toEqual([]);
    expect(plan.archive).toEqual([]);
  });

  it('replaces the legacy singleton xiaok seed with dedicated po + worker seeds', () => {
    const plan = buildSeedAgentReconciliationPlan([
      { id: 'xiaok', name: 'xiaok', runtimeType: 'xiaok', roles: ['project_owner', 'worker'] },
    ]);

    expect(plan.create).toEqual([
      expect.objectContaining({ id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'] }),
      expect.objectContaining({ id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'] }),
    ]);
    expect(plan.archive).toEqual(['xiaok']);
  });

  it('fills only the missing seed without touching the existing dedicated agent', () => {
    const plan = buildSeedAgentReconciliationPlan([
      { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'] },
    ]);

    expect(plan.create).toEqual([
      expect.objectContaining({ id: 'xiaok-worker', name: 'Worker-Agent', roles: ['worker'] }),
    ]);
    expect(plan.archive).toEqual([]);
  });

  it('prefers dedicated seed ids for default po/worker selection', () => {
    const agents = [
      { id: 'legacy-worker', name: 'legacy-worker', runtimeType: 'xiaok', roles: ['worker'] },
      { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'] },
      { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'] },
      { id: 'xiaok', name: 'xiaok', runtimeType: 'xiaok', roles: ['project_owner', 'worker'] },
    ];

    expect(getPreferredPoAgentId(agents)).toBe('xiaok-po');
    expect(getPreferredWorkerSeedId(agents, 'xiaok-po')).toBe('xiaok-worker');
  });
});

describe('desktop service path contract', () => {
  it('resolves sibling repo candidates from the xiaok-cli repo root in development', () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const candidates = getDevelopmentServiceCandidates(
      join(repoRoot, 'desktop', 'dist', 'main', 'desktop', 'electron'),
      'kswarm',
      join('src', 'server', 'index.js'),
    );

    expect(candidates).toContain(join(repoRoot, '..', 'kswarm', 'src', 'server', 'index.js'));
  });

  it('builds the intent-broker launch spec against src/cli.js with experimental sqlite in development', () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const spec = getDevelopmentBrokerLaunchSpec(
      join(repoRoot, 'desktop', 'dist', 'main', 'desktop', 'electron'),
    );

    expect(spec).toEqual({
      cwd: join(repoRoot, '..', 'intent-broker'),
      entryPath: join(repoRoot, '..', 'intent-broker', 'src', 'cli.js'),
      nodeArgs: ['--experimental-sqlite', join(repoRoot, '..', 'intent-broker', 'src', 'cli.js')],
    });
  });

  it('keeps electron-builder extraResources pointed at repo-sibling services and plugins', async () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const builderConfig = JSON.parse(await readFile(join(repoRoot, 'desktop', 'electron-builder.json'), 'utf8')) as {
      extraResources: Array<{ from: string; to: string }>;
    };
    const fromEntries = builderConfig.extraResources.map((entry) => entry.from);

    expect(fromEntries).toContain('../../kswarm/src');
    expect(fromEntries).toContain('../../kswarm/scripts');
    expect(fromEntries).toContain('../../kswarm/package.json');
    expect(fromEntries).toContain('../../kswarm/node_modules/ws');
    expect(fromEntries).toContain('../../intent-broker/src');
    expect(fromEntries).toContain('../../intent-broker/package.json');
    expect(fromEntries).toContain('../../intent-broker/adapters');
    expect(fromEntries).toContain('../../intent-broker/node_modules/ws');
    expect(fromEntries).toContain('.generated/kswarm/scripts/auto-worker.js');
    expect(fromEntries).toContain('overrides/kswarm/windows-xiaok-launch.js');
    expect(fromEntries).toContain('../../kai-xiaok-plugins/plugins/kai-report-creator');
    expect(fromEntries).toContain('../../kai-xiaok-plugins/plugins/kai-slide-creator');
  });
});
