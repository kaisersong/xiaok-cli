import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadManifestModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/manifest.mjs',
  )).href);
}

async function loadAssignmentModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/assignment.mjs',
  )).href);
}

const STRATA = {
  cli: [
    'cli-no-tool-multiturn',
    'cli-single-tool',
    'cli-multi-tool',
    'cli-long-history',
    'cli-compaction-parent-continuation',
  ],
  desktop: [
    'desktop-no-tool-multiturn',
    'desktop-single-tool',
    'desktop-multi-tool',
    'desktop-long-synthesized-history',
    'desktop-new-invocation-recovery',
  ],
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function validManifestInput(): Promise<any> {
  const { createCellAssignment } = await loadAssignmentModule();
  const { canonicalSha256 } = await import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/canonical.mjs',
  )).href);
  const eligibility = {
    'k3:cli': 'paired-eligible',
    'k3:desktop': 'paired-eligible',
    'k3-256k:cli': 'no-product-baseline',
    'k3-256k:desktop': 'no-product-baseline',
  };
  const fixtures: any[] = [];
  const assignments: Record<string, any[]> = {};
  for (const profile of ['k3', 'k3-256k']) {
    for (const surface of ['cli', 'desktop'] as const) {
      const fixtureIdsByStratum = Object.fromEntries(STRATA[surface].map(stratum => {
        const ids = Array.from(
          { length: 6 },
          (_, index) => `d9:${profile}:${surface}:${stratum}:${index}`,
        );
        for (const fixtureId of ids) {
          fixtures.push({
            fixtureId,
            digest: digest(fixtureId),
            profile,
            surface,
            stratum,
          });
        }
        return [stratum, ids];
      }));
      const cellKey = `${profile}:${surface}`;
      assignments[cellKey] = createCellAssignment({
        profile,
        surface,
        eligibility: eligibility[cellKey as keyof typeof eligibility],
        fixtureIdsByStratum,
      });
    }
  }
  const preflightPlan = {
    schemaVersion: 1,
    designSha256: '71fb4c66ac5b48c7d2a3d73c0bf786b4f81f3e542b51aa05a04b2ffabffcbb75',
  };
  const artifactDigests = {
    'baseline.cli.runtimeClosure': '31'.repeat(32),
    'baseline.desktop.app': '32'.repeat(32),
    'candidate.cli.runtimeClosure': '33'.repeat(32),
    'candidate.desktop.app': '34'.repeat(32),
  };
  const artifactKeys = Object.keys(artifactDigests);
  const preflightPlanHash = canonicalSha256(preflightPlan);
  const preflightArtifactAttestation = {
    schemaVersion: 1,
    preflightPlanHash,
    artifactDigestAlgorithm: 'sha256-canonical-full-tree-v1',
    artifacts: Object.fromEntries(artifactKeys.map((key, index) => [
      key,
      {
        artifactPath: `/frozen/d9/artifact-${index}`,
        physicalIdentity: {
          realpath: `/frozen/d9/artifact-${index}`,
          device: 1,
          inode: index + 1,
          size: 1_000 + index,
          mode: 0o500,
          fileType: index % 2 === 0 ? 'directory' : 'file',
        },
        digest: artifactDigests[key as keyof typeof artifactDigests],
      },
    ])),
    constructionCompletionCounters: Object.fromEntries(
      artifactKeys.map(key => [key, 1]),
    ),
  };
  return {
    preflightPlan,
    preflightPlanHash,
    preflightArtifactAttestation,
    preflightArtifactAttestationHash:
      canonicalSha256(preflightArtifactAttestation),
    eligibility,
    artifactDigests,
    nonSecretQueryKeyAllowlist: [],
    nonSecretHeaderNameAllowlist: ['x-api-version'],
    runStartRequestInputs: {
      'k3:cli:baseline': runStartInput(false),
      'k3:cli:candidate': runStartInput(true),
      'k3:desktop:baseline': runStartInput(false),
      'k3:desktop:candidate': runStartInput(true),
      'k3-256k:cli:candidate': runStartInput(true, 'k3-256k'),
      'k3-256k:desktop:candidate': runStartInput(true, 'k3-256k'),
    },
    fixtures,
    assignments,
    withdrawnFixtureDigests: ['ff'.repeat(32)],
  };
}

function runStartInput(
  preservedThinking: boolean,
  profile = 'k3',
): Record<string, unknown> {
  return {
    modelId: profile === 'k3' ? 'kimi-k3' : 'kimi-k3-256k',
    profileId: profile === 'k3'
      ? 'kimi-k3-coding-openai'
      : 'kimi-k3-256k-coding-openai',
    wireModel: profile,
    reasoningEffort: 'high',
    contextLimit: 262_144,
    preservedThinking,
    promptCacheKey: false,
    temperature: null,
    topP: null,
    maxOutputTokens: null,
    stop: null,
    responseFormat: null,
    streamingMode: 'stream',
    toolChoice: 'auto',
    parallelToolMode: false,
    apiVersionHeaders: [{ name: 'x-api-version', value: '2026-07-28' }],
    sdkTransportMode: 'openai-legacy',
    productTimeoutMs: 120_000,
    retryPolicy: 'none',
    backoffPolicy: 'none',
    proxyIdentity: null,
    noProxyIdentity: null,
    endpoint: {
      scheme: 'https',
      host: 'api.kimi.com',
      effectivePort: 443,
      pathname: '/coding/v1',
      query: [],
    },
    systemPromptDigest: '41'.repeat(32),
    toolCatalogDigest: '42'.repeat(32),
    skillCatalogDigest: '43'.repeat(32),
    fixtureMcpRegistrationDigest: '44'.repeat(32),
  };
}

describe('Kimi K3 D9 frozen manifest', () => {
  it('sanitizes the closed run-start schema and permits only preservedThinking treatment', async () => {
    const {
      assertPairedTreatmentInvariant,
      sanitizeRunStartRequestInputsV1,
    } = await loadManifestModule();
    const baseline = sanitizeRunStartRequestInputsV1(runStartInput(false), {
      allowedQueryKeys: [],
      allowedHeaderNames: ['x-api-version'],
    });
    const candidate = sanitizeRunStartRequestInputsV1(runStartInput(true), {
      allowedQueryKeys: [],
      allowedHeaderNames: ['x-api-version'],
    });
    expect(assertPairedTreatmentInvariant(baseline, candidate)).toBe(true);

    expect(() => sanitizeRunStartRequestInputsV1({
      ...runStartInput(false),
      secretHeader: 'must-not-enter-manifest',
    }, {
      allowedQueryKeys: [],
      allowedHeaderNames: ['x-api-version'],
    })).toThrow('KIMI_D9_RUN_START_INPUT_REJECTED');
    expect(() => assertPairedTreatmentInvariant(
      baseline,
      { ...candidate, productTimeoutMs: 1 },
    )).toThrow('KIMI_D9_TREATMENT_INVARIANT_VIOLATION');
    expect(() => assertPairedTreatmentInvariant(
      { ...baseline, ignoredSecret: 'same-on-both-arms' },
      { ...candidate, ignoredSecret: 'same-on-both-arms' },
    )).toThrow('KIMI_D9_TREATMENT_INVARIANT_VIOLATION');

    const withUnsortedEndpoint = runStartInput(false);
    withUnsortedEndpoint.apiVersionHeaders = [
      { name: 'x-beta-version', value: 'b' },
      { name: 'x-api-version', value: 'a' },
    ];
    (withUnsortedEndpoint.endpoint as Record<string, unknown>).query = [
      { key: 'z', value: 'last' },
      { key: 'a', value: 'first' },
    ];
    const sorted = sanitizeRunStartRequestInputsV1(withUnsortedEndpoint, {
      allowedQueryKeys: ['a', 'z'],
      allowedHeaderNames: ['x-api-version', 'x-beta-version'],
    });
    expect(sorted.apiVersionHeaders).toEqual([
      { name: 'x-api-version', value: 'a' },
      { name: 'x-beta-version', value: 'b' },
    ]);
    expect(sorted.endpoint.query).toEqual([
      { key: 'a', value: 'first' },
      { key: 'z', value: 'last' },
    ]);

    expect(() => sanitizeRunStartRequestInputsV1({
      ...runStartInput(false),
      endpoint: {
        scheme: 'javascript',
        host: 'api.kimi.com',
        effectivePort: 99_999,
        pathname: 'relative',
        query: [],
      },
    }, {
      allowedQueryKeys: [],
      allowedHeaderNames: ['x-api-version'],
    })).toThrow('KIMI_D9_RUN_START_INPUT_REJECTED');
  });

  it('freezes a matching canonical hash and rejects all preregistration drift', async () => {
    const {
      buildFrozenManifest,
      verifyFrozenManifest,
    } = await loadManifestModule();
    const input = await validManifestInput();
    const frozen = buildFrozenManifest(input);

    expect(frozen.manifest.assignments['k3:cli']).toHaveLength(30);
    expect(frozen.manifest.assignments['k3-256k:desktop']).toHaveLength(30);
    expect(Object.keys(frozen.manifest.productRuntimeConfigDigests)).toHaveLength(6);
    expect(frozen.manifest.preflightPlan).toEqual(input.preflightPlan);
    expect(frozen.manifest.preflightArtifactAttestation)
      .toEqual(input.preflightArtifactAttestation);
    expect(frozen.manifest.performanceRegressionBudget).toBe(0.05);
    expect(frozen.manifest.bootstrapIterations).toBe(10_000);
    expect(frozen.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(verifyFrozenManifest(frozen.manifest, frozen.hash)).toEqual(frozen.manifest);
    expect(() => verifyFrozenManifest(frozen.manifest, '00'.repeat(32)))
      .toThrow('KIMI_D9_MANIFEST_HASH_MISMATCH');

    expect(() => buildFrozenManifest({
      ...input,
      withdrawnFixtureDigests: [input.fixtures[0].digest],
    })).toThrow('KIMI_D9_WITHDRAWN_FIXTURE_REUSED');
    expect(() => buildFrozenManifest({
      ...input,
      randomizationSeed: 7,
    })).toThrow('KIMI_D9_MANIFEST_CONSTANT_MISMATCH');
    expect(() => buildFrozenManifest({
      ...input,
      assignments: {
        ...input.assignments,
        'k3:cli': input.assignments['k3:cli'].slice(1),
      },
    })).toThrow('KIMI_D9_ASSIGNMENT_INVALID');
    expect(() => buildFrozenManifest({
      ...input,
      samplesPerStratum: 5,
    })).toThrow('KIMI_D9_MANIFEST_CONSTANT_MISMATCH');
    expect(() => buildFrozenManifest({
      ...input,
      preflightArtifactAttestationHash: '00'.repeat(32),
    })).toThrow('KIMI_D9_ARTIFACT_ATTESTATION_INVALID');
    expect(() => buildFrozenManifest({
      ...input,
      runStartRequestInputs: {
        ...input.runStartRequestInputs,
        'k3:cli:candidate': {
          ...input.runStartRequestInputs['k3:cli:candidate'],
          productTimeoutMs: 1,
        },
      },
    })).toThrow('KIMI_D9_TREATMENT_INVARIANT_VIOLATION');
    expect(() => buildFrozenManifest({
      ...input,
      unregisteredField: 'must-not-be-silently-ignored',
    })).toThrow('KIMI_D9_MANIFEST_SCHEMA_INVALID');

    const wrongCellAssignments = structuredClone(input.assignments);
    wrongCellAssignments['k3:cli'][0].fixtureId =
      input.assignments['k3-256k:desktop'][0].fixtureId;
    expect(() => buildFrozenManifest({
      ...input,
      assignments: wrongCellAssignments,
    })).toThrow('KIMI_D9_ASSIGNMENT_INVALID');
  });
});
