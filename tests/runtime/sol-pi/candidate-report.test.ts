import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildCandidateDecisionReport } from '../../../scripts/evals/sol-pi/candidate-decision-report.js';

describe('frozen baseline candidate decision report', () => {
  it('reads real frozen result entries, reports adjacency only, and cannot admit engineering data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sol-pi-candidate-'));
    try {
      const entry = { key: 'cli-code-1', surface: 'cli', taskId: 'code', repeat: 1 };
      const events = [{ kind: 'adapter_request' }, { kind: 'registry_return', family: 'edit' }, { kind: 'registry_return', family: 'bash' }, { kind: 'provider_usage', cacheReadTokens: null, cacheWriteTokens: null }];
      const raw = JSON.stringify({ ...entry, passed: true, metrics: [{ complete: true, events }], actualCost: null });
      await mkdir(join(root, entry.key)); await writeFile(join(root, entry.key, 'result.json'), raw);
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ kind: 'sol-pi-basic-engineering-baseline', plan: [entry], snapshotSha256: 'fixture' }));
      await writeFile(join(root, 'finished.json'), JSON.stringify({ integrity: 'verified' }));
      await writeFile(join(root, 'ledger.json'), JSON.stringify({ [entry.key]: { ...entry, resultSha256: createHash('sha256').update(raw).digest('hex') } }));
      const report = await buildCandidateDecisionReport(root);
      expect(report.opportunities).toMatchObject({ adjacentMutationBashPairs: 1, registryReturns: 2, adapterRequests: 1, semanticCompactionOpportunities: null });
      expect(report.candidates).toMatchObject({ 'P3-R': { status: 'no-go' }, 'P3-C': { status: 'inconclusive' } });
      expect(report.semanticExecutorEnabled).toBe(false);
      await writeFile(join(root, entry.key, 'result.json'), raw + ' ');
      await expect(buildCandidateDecisionReport(root)).rejects.toThrow(/hash/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
