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

  it('never auto-selects a role-less or pure-worker agent as PO', () => {
    expect(getPreferredPoAgentId([
      { id: 'roleless', name: 'Role-less', runtimeType: 'xiaok' },
      { id: 'worker-only', name: 'Worker', runtimeType: 'xiaok', roles: ['worker'] },
    ])).toBeNull();

    expect(getPreferredPoAgentId([
      { id: 'roleless', name: 'Role-less', runtimeType: 'xiaok' },
      { id: 'custom-po', name: 'Custom PO', runtimeType: 'xiaok', roles: ['project_owner'] },
    ])).toBe('custom-po');
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
      extraResources: Array<{ from: string; to: string; filter?: string[] }>;
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

    const slidePluginEntry = builderConfig.extraResources.find(
      (entry) => entry.from === '../../kai-xiaok-plugins/plugins/kai-slide-creator',
    );
    expect(slidePluginEntry?.filter).toContain('skills/**/*');
    expect(slidePluginEntry?.filter).not.toContain('SKILL.md');

    const reportPluginEntry = builderConfig.extraResources.find(
      (entry) => entry.from === '../../kai-xiaok-plugins/plugins/kai-report-creator',
    );
    expect(reportPluginEntry?.filter).toContain('mcp-servers/report-renderer/dist/**/*');
    expect(reportPluginEntry?.filter).not.toContain('mcp-servers/report-renderer/dist/server.bundle.js');

    const intentBrokerAdaptersEntry = builderConfig.extraResources.find(
      (entry) => entry.from === '../../intent-broker/adapters',
    );
    expect(intentBrokerAdaptersEntry?.filter).toContain('!**/.env');
    expect(intentBrokerAdaptersEntry?.filter).toContain('!**/.env.*');
  });
});
