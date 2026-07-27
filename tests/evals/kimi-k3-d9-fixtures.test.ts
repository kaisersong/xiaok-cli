import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadFixtures(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/fixtures.mjs',
  )).href);
}

describe('Kimi K3 D9 formal fixtures', () => {
  it('freezes 120 disjoint fixtures with six samples in every stratum', async () => {
    const { createFormalFixtures } = await loadFixtures();
    const fixtures = createFormalFixtures();
    expect(fixtures).toHaveLength(120);
    expect(new Set(fixtures.map((fixture: any) => fixture.fixtureId)).size).toBe(120);
    expect(new Set(fixtures.map((fixture: any) => fixture.digest)).size).toBe(120);

    const counts = new Map<string, number>();
    for (const fixture of fixtures) {
      const key = `${fixture.profile}:${fixture.surface}:${fixture.stratum}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      expect(fixture.digest).toMatch(/^[0-9a-f]{64}$/u);
      expect(fixture.turns.length).toBeGreaterThanOrEqual(2);
      expect(fixture.timeoutMs).toBeGreaterThan(0);
      expect(fixture.latencyPenaltyMs).toBeGreaterThanOrEqual(fixture.timeoutMs);
      expect(fixture.promptTemplateSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect([...counts.values()]).toEqual(Array(20).fill(6));
  });

  it('materializes runtime-only attestation values without changing fixture identity', async () => {
    const {
      createFormalFixtures,
      materializeFixture,
    } = await loadFixtures();
    const fixture = createFormalFixtures().find(
      (entry: any) => entry.stratum === 'cli-single-tool',
    );
    const runtime = {
      nonce: '11'.repeat(32),
      environmentDigest: '22'.repeat(32),
      assignmentDigest: '33'.repeat(32),
    };
    const materialized = materializeFixture(fixture, runtime);
    expect(materialized.fixtureId).toBe(fixture.fixtureId);
    expect(materialized.digest).toBe(fixture.digest);
    expect(materialized.turns[0].prompt).toContain(runtime.nonce);
    expect(materialized.turns[0].prompt).toContain(runtime.environmentDigest);
    expect(materialized.turns[0].prompt).toContain(runtime.assignmentDigest);
    expect(materialized.expectedInvocations).toHaveLength(1);
    expect(materialized.expectedInvocations[0]).toMatchObject({
      toolName: 'd9_fixture_echo',
      nonce: runtime.nonce,
      environmentDigest: runtime.environmentDigest,
      assignmentDigest: runtime.assignmentDigest,
    });
    expect(JSON.stringify(fixture)).not.toContain(runtime.nonce);
  });

  it('keeps compaction and recovery inside their approved non-durable boundaries', async () => {
    const { createFormalFixtures } = await loadFixtures();
    const fixtures = createFormalFixtures();
    for (const fixture of fixtures) {
      if (fixture.stratum === 'cli-compaction-parent-continuation') {
        expect(fixture.boundary).toEqual({
          kind: 'same-live-task-compaction',
          sameLiveTask: true,
          canonicalHistoryRoleVector: ['system', 'user', 'tool'],
        });
      }
      if (fixture.stratum === 'desktop-new-invocation-recovery') {
        expect(fixture.boundary).toEqual({
          kind: 'before-first-assistant-recovery',
          recoveryPhase: 'before-first-assistant',
          canonicalHistoryRoleVector: ['system', 'user'],
        });
      }
      expect(fixture.boundary?.canonicalHistoryRoleVector ?? [])
        .not.toContain('assistant');
    }
  });
});
