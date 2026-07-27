import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadAssignmentModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/assignment.mjs',
  )).href);
}

const CLI_STRATA = [
  'cli-no-tool-multiturn',
  'cli-single-tool',
  'cli-multi-tool',
  'cli-long-history',
  'cli-compaction-parent-continuation',
];

function fixtureIdsByStratum(): Record<string, string[]> {
  return Object.fromEntries(CLI_STRATA.map(stratum => [
    stratum,
    Array.from({ length: 6 }, (_, index) => `${stratum}-f${index}`),
  ]));
}

describe('Kimi K3 D9 assignment vectors', () => {
  it('produces the frozen 5x6 round-robin vector and a strict 3:3 paired order', async () => {
    const { createCellAssignment } = await loadAssignmentModule();
    const assignment = createCellAssignment({
      profile: 'k3',
      surface: 'cli',
      eligibility: 'paired-eligible',
      fixtureIdsByStratum: fixtureIdsByStratum(),
    });

    expect(assignment).toHaveLength(30);
    expect(assignment.slice(0, 10).map((record: any) => record.fixtureId)).toEqual([
      'cli-no-tool-multiturn-f5',
      'cli-single-tool-f0',
      'cli-multi-tool-f0',
      'cli-long-history-f2',
      'cli-compaction-parent-continuation-f5',
      'cli-no-tool-multiturn-f4',
      'cli-single-tool-f4',
      'cli-multi-tool-f4',
      'cli-long-history-f3',
      'cli-compaction-parent-continuation-f1',
    ]);
    expect(assignment.slice(0, 5).every((record: any) =>
      record.firstArm === 'baseline-first')).toBe(true);
    expect(assignment.slice(5, 10).every((record: any) =>
      record.firstArm === 'candidate-first')).toBe(true);

    for (const stratum of CLI_STRATA) {
      const records = assignment.filter((record: any) => record.stratum === stratum);
      expect(records).toHaveLength(6);
      expect(records.filter((record: any) => record.firstArm === 'baseline-first')).toHaveLength(3);
      expect(records.filter((record: any) => record.firstArm === 'candidate-first')).toHaveLength(3);
    }
  });

  it('keeps the same deterministic fixture vector without inventing a baseline arm', async () => {
    const { createCellAssignment } = await loadAssignmentModule();
    const fixtures = fixtureIdsByStratum();
    const paired = createCellAssignment({
      profile: 'k3',
      surface: 'cli',
      eligibility: 'paired-eligible',
      fixtureIdsByStratum: fixtures,
    });
    const candidateOnly = createCellAssignment({
      profile: 'k3-256k',
      surface: 'cli',
      eligibility: 'no-product-baseline',
      fixtureIdsByStratum: fixtures,
    });

    expect(candidateOnly.slice(0, 10).map((record: any) => record.fixtureId)).toEqual([
      'cli-no-tool-multiturn-f1',
      'cli-single-tool-f2',
      'cli-multi-tool-f4',
      'cli-long-history-f0',
      'cli-compaction-parent-continuation-f4',
      'cli-no-tool-multiturn-f0',
      'cli-single-tool-f5',
      'cli-multi-tool-f3',
      'cli-long-history-f5',
      'cli-compaction-parent-continuation-f3',
    ]);
    expect(candidateOnly).toHaveLength(paired.length);
    expect(candidateOnly.every((record: any) =>
      !Object.hasOwn(record, 'firstArm'))).toBe(true);
  });
});
