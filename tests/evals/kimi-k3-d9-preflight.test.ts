import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadPreflightModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/preflight.mjs',
  )).href);
}

describe('Kimi K3 D9 immutable preflight', () => {
  it('creates the plan once and rejects a missing or rewritten frozen plan', async () => {
    const {
      createImmutablePreflightPlan,
      verifyImmutablePreflightPlan,
    } = await loadPreflightModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-preflight-'));
    const planPath = join(root, 'preflight-plan.json');
    const plan = {
      schemaVersion: 1,
      baselineCommit: 'fb5a77144ace1b4d53b70f75fd6106a95bf61c41',
      designSha256: '71fb4c66ac5b48c7d2a3d73c0bf786b4f81f3e542b51aa05a04b2ffabffcbb75',
    };
    try {
      const frozen = await createImmutablePreflightPlan(planPath, plan);
      expect(await readFile(planPath, 'utf8')).toBe(frozen.canonicalBytes);
      await expect(verifyImmutablePreflightPlan({
        planPath,
        expectedHash: frozen.hash,
        expectedPhysicalIdentity: frozen.physicalIdentity,
      })).resolves.toEqual(plan);
      await expect(createImmutablePreflightPlan(planPath, plan))
        .rejects.toThrow('KIMI_D9_PREFLIGHT_PLAN_ALREADY_EXISTS');

      await chmod(planPath, 0o600);
      await writeFile(planPath, '{"schemaVersion":2}');
      await expect(verifyImmutablePreflightPlan({
        planPath,
        expectedHash: frozen.hash,
        expectedPhysicalIdentity: frozen.physicalIdentity,
      })).rejects.toThrow('KIMI_D9_PREFLIGHT_PLAN_INVALID');

      await rm(planPath);
      await expect(verifyImmutablePreflightPlan({
        planPath,
        expectedHash: frozen.hash,
      })).rejects.toThrow('KIMI_D9_PREFLIGHT_PLAN_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects missing, replaced, or drifted artifacts before all three side effects', async () => {
    const {
      capturePhysicalIdentity,
      createSideEffectCounters,
      verifyArtifactAttestation,
    } = await loadPreflightModule();
    const { digestTree } = await import(pathToFileURL(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/tree-digest.mjs',
    )).href);
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-artifact-'));
    const artifact = join(root, 'artifact');
    const replacement = join(root, 'replacement');
    try {
      const physicalRoot = join(root, 'physical');
      const linkedRoot = join(root, 'linked');
      await mkdir(physicalRoot);
      await symlink('physical', linkedRoot, 'dir');
      await writeFile(join(physicalRoot, 'identity.txt'), 'identity');
      expect((await capturePhysicalIdentity(
        join(linkedRoot, 'identity.txt'),
      )).realpath).toBe(await realpath(join(physicalRoot, 'identity.txt')));

      await writeFile(artifact, 'frozen bytes');
      const identity = await capturePhysicalIdentity(artifact);
      const expectedDigest = (await digestTree(artifact)).digest;

      const successCounters = createSideEffectCounters();
      await expect(verifyArtifactAttestation({
        artifactPath: artifact,
        expectedDigest,
        expectedPhysicalIdentity: identity,
        counters: successCounters,
      })).resolves.toMatchObject({ digest: expectedDigest });
      expect(successCounters.snapshot()).toEqual({
        networkRequest: 0,
        fixtureMcpInvocation: 0,
        evidenceWrite: 0,
      });

      await writeFile(replacement, 'frozen bytes');
      await rm(artifact);
      await writeFile(artifact, 'frozen bytes');
      const replacedCounters = createSideEffectCounters();
      await expect(verifyArtifactAttestation({
        artifactPath: artifact,
        expectedDigest,
        expectedPhysicalIdentity: identity,
        counters: replacedCounters,
      })).rejects.toThrow('KIMI_D9_ARTIFACT_ATTESTATION_FAILED');
      expect(replacedCounters.snapshot()).toEqual({
        networkRequest: 0,
        fixtureMcpInvocation: 0,
        evidenceWrite: 0,
      });

      const driftIdentity = await capturePhysicalIdentity(artifact);
      await writeFile(artifact, 'drifted bytes');
      const driftCounters = createSideEffectCounters();
      await expect(verifyArtifactAttestation({
        artifactPath: artifact,
        expectedDigest,
        expectedPhysicalIdentity: driftIdentity,
        counters: driftCounters,
      })).rejects.toThrow('KIMI_D9_ARTIFACT_ATTESTATION_FAILED');
      expect(driftCounters.snapshot()).toEqual({
        networkRequest: 0,
        fixtureMcpInvocation: 0,
        evidenceWrite: 0,
      });

      await rm(artifact);
      const missingCounters = createSideEffectCounters();
      await expect(verifyArtifactAttestation({
        artifactPath: artifact,
        expectedDigest,
        expectedPhysicalIdentity: driftIdentity,
        counters: missingCounters,
      })).rejects.toThrow('KIMI_D9_ARTIFACT_ATTESTATION_FAILED');
      expect(missingCounters.snapshot()).toEqual({
        networkRequest: 0,
        fixtureMcpInvocation: 0,
        evidenceWrite: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('freezes the four-artifact construction attestation once and binds it to the plan', async () => {
    const {
      capturePhysicalIdentity,
      createImmutableArtifactAttestation,
      verifyImmutableArtifactAttestation,
    } = await loadPreflightModule();
    const { digestTree } = await import(pathToFileURL(join(
      process.cwd(),
      'scripts/evals/kimi-k3-d9/tree-digest.mjs',
    )).href);
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-attestation-'));
    const attestationPath = join(root, 'preflight-artifact-attestation.json');
    const planHash = '11'.repeat(32);
    const artifactKeys = [
      'baseline.cli.runtimeClosure',
      'baseline.desktop.app',
      'candidate.cli.runtimeClosure',
      'candidate.desktop.app',
    ];
    try {
      const artifacts: Record<string, unknown> = {};
      for (const [index, key] of artifactKeys.entries()) {
        const artifactPath = join(root, `artifact-${index}`);
        await mkdir(artifactPath);
        await writeFile(join(artifactPath, 'payload'), `artifact-${index}`);
        artifacts[key] = {
          artifactPath,
          physicalIdentity: await capturePhysicalIdentity(artifactPath),
          digest: (await digestTree(artifactPath)).digest,
        };
      }
      const artifactDigests = Object.fromEntries(
        artifactKeys.map(key => [key, (artifacts[key] as any).digest]),
      );
      const attestation = {
        schemaVersion: 1,
        preflightPlanHash: planHash,
        artifactDigestAlgorithm: 'sha256-canonical-full-tree-v1',
        artifacts,
        constructionCompletionCounters: Object.fromEntries(
          artifactKeys.map(key => [key, 1]),
        ),
      };
      await expect(createImmutableArtifactAttestation(
        join(root, 'forged-attestation.json'),
        {
          ...attestation,
          artifacts: {
            ...attestation.artifacts,
            'baseline.cli.runtimeClosure': {
              ...(attestation.artifacts['baseline.cli.runtimeClosure'] as any),
              artifactPath: join(root, 'does-not-exist'),
            },
          },
        },
      )).rejects.toThrow('KIMI_D9_ARTIFACT_ATTESTATION_INVALID');

      const frozen = await createImmutableArtifactAttestation(
        attestationPath,
        attestation,
      );
      await expect(verifyImmutableArtifactAttestation({
        attestationPath,
        expectedHash: frozen.hash,
        expectedPhysicalIdentity: frozen.physicalIdentity,
        expectedPreflightPlanHash: planHash,
        expectedArtifactDigests: artifactDigests,
      })).resolves.toEqual(attestation);
      await expect(createImmutableArtifactAttestation(
        attestationPath,
        attestation,
      )).rejects.toThrow('KIMI_D9_ARTIFACT_ATTESTATION_ALREADY_EXISTS');

      await chmod(attestationPath, 0o600);
      await writeFile(attestationPath, '{"schemaVersion":2}');
      await expect(verifyImmutableArtifactAttestation({
        attestationPath,
        expectedHash: frozen.hash,
        expectedPhysicalIdentity: frozen.physicalIdentity,
        expectedPreflightPlanHash: planHash,
        expectedArtifactDigests: artifactDigests,
      })).rejects.toThrow('KIMI_D9_ARTIFACT_ATTESTATION_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
