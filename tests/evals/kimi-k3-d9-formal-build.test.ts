import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const SHA = '1'.repeat(64);
const BASELINE_COMMIT = 'a'.repeat(40);
const CANDIDATE_COMMIT = 'b'.repeat(40);

async function loadModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/formal-build.mjs',
  )).href);
}

function sourceEntry(repositoryIdentity: string, commit: string) {
  return {
    repositoryIdentity,
    commit,
    clean: true,
    statusByteCount: 0,
    lockfileDigest: SHA,
    generatedOutputDigest: SHA,
    packedInputTreeDigest: SHA,
  };
}

function desktopMap(xiaokCommit: string) {
  return {
    'xiaok-cli': sourceEntry('xiaok-cli', xiaokCommit),
    kswarm: sourceEntry('kswarm', 'c'.repeat(40)),
    'intent-broker': sourceEntry('intent-broker', 'd'.repeat(40)),
    'kai-xiaok-plugins': sourceEntry(
      'kai-xiaok-plugins',
      'e'.repeat(40),
    ),
  };
}

function computedEdgeAllowlist() {
  return [{
    importerSha256: SHA,
    astLocation: '14:17',
    pattern: 'require(BINARY_PATH)',
    targets: ['./build/Release/nodejieba.node'],
  }];
}

function validInput(root: string) {
  return {
    baselineCommit: BASELINE_COMMIT,
    candidateCommit: CANDIDATE_COMMIT,
    buildParent: join(root, 'builds'),
    artifactParent: join(root, 'artifacts'),
    repositoryRoots: {
      'xiaok-cli': join(root, 'repos/xiaok-cli'),
      kswarm: join(root, 'repos/kswarm'),
      'intent-broker': join(root, 'repos/intent-broker'),
      'kai-xiaok-plugins': join(root, 'repos/kai-xiaok-plugins'),
    },
    sourceCommitMaps: {
      baseline: {
        cli: {
          'xiaok-cli': sourceEntry('xiaok-cli', BASELINE_COMMIT),
        },
        desktop: desktopMap(BASELINE_COMMIT),
      },
      candidate: {
        cli: {
          'xiaok-cli': sourceEntry('xiaok-cli', CANDIDATE_COMMIT),
        },
        desktop: desktopMap(CANDIDATE_COMMIT),
      },
    },
    nodeRuntimeInput: {
      archiveIdentity: 'node-v24.15.0-darwin-arm64.tar.gz',
      archiveSha256:
        '372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4',
      archivePath: join(root, 'node-v24.15.0-darwin-arm64.tar.gz'),
      distributionRoot: join(root, 'node-v24.15.0-darwin-arm64'),
      distributionTreeDigest: SHA,
      nodeVersion: 'v24.15.0',
      modulesAbi: '137',
      nodeApi: '10',
      platform: 'darwin',
      arch: 'arm64',
      npmVersion: '11.12.1',
      npmCliRelativePath: 'lib/node_modules/npm/bin/npm-cli.js',
      npmCliSha256: SHA,
      installAffectingNpmConfigAllowlist: [],
    },
    guardInput: {
      sourcePath: join(root, 'runtime-guard.mjs'),
      relativePath: 'runtime/guard/runtime-guard.mjs',
      contentSha256: SHA,
      version: 'kimi-k3-d9-runtime-guard-v1',
    },
    cliGraphInputs: {
      baseline: {
        computedEdgeAllowlist: computedEdgeAllowlist(),
        nativeCompatibilityByRelativePath: {},
      },
      candidate: {
        computedEdgeAllowlist: computedEdgeAllowlist(),
        nativeCompatibilityByRelativePath: {},
      },
    },
    generatedOutputAllowlists: {
      cli: ['dist'],
      desktop: {
        'xiaok-cli': ['dist', 'desktop/dist'],
        kswarm: [],
        'intent-broker': [],
        'kai-xiaok-plugins': [
          'plugins/kai-report-creator/mcp-servers/report-renderer/dist',
        ],
      },
    },
    eligibilitySmokeDriver: {
      relativePath: 'scripts/evals/kimi-k3-d9/coordinator.mjs',
      contentSha256: SHA,
      version: 'kimi-k3-d9-eligibility-smoke-v1',
    },
  };
}

describe('Kimi K3 D9 formal build orchestration', () => {
  it('freezes four independent one-shot construction recipes from distinct clean recorded commits', async () => {
    const { createFormalBuildPlan } = await loadModule();
    const root = join(tmpdir(), 'kimi-d9-formal-plan');
    const base = validInput(root);
    const result = createFormalBuildPlan(base);

    expect(result.preflightPlan.baselineProductCommit).toBe(BASELINE_COMMIT);
    expect(result.preflightPlan.candidateProductCommit).toBe(CANDIDATE_COMMIT);
    expect(result.preflightPlan.artifactConstructionOrder).toEqual([
      'baseline.cli.runtimeClosure',
      'baseline.desktop.app',
      'candidate.cli.runtimeClosure',
      'candidate.desktop.app',
    ]);
    expect(Object.keys(result.constructionTasks)).toEqual(
      result.preflightPlan.artifactConstructionOrder,
    );
    expect(Object.values(
      result.preflightPlan.artifactConstructionCommandDigests,
    )).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.stringMatching(/^[0-9a-f]{64}$/u),
      expect.stringMatching(/^[0-9a-f]{64}$/u),
    ]);
    expect(new Set(Object.values(result.constructionTasks)
      .map((task: any) => task.sourceRoot))).toHaveProperty('size', 4);
    for (const arm of ['baseline', 'candidate']) {
      const task = result.constructionTasks[`${arm}.desktop.app`];
      expect(task.desktopBuildSteps.map((step: any) => step.stepId)).toEqual([
        'xiaok-root-install',
        'desktop-install',
        'kswarm-install',
        'intent-broker-install',
        'report-renderer-install',
        'report-renderer-build',
        'report-renderer-bundle',
        'infinity-canvas-install',
        'desktop-build',
      ]);
      expect(task.desktopBuildSteps.every((step: any) => (
        step.command.executable
          === join(base.nodeRuntimeInput.distributionRoot, 'bin/node')
        && step.command.args[0]
          === join(
            base.nodeRuntimeInput.distributionRoot,
            base.nodeRuntimeInput.npmCliRelativePath,
          )
        && !step.command.cwd.startsWith(process.cwd())
        && !Object.hasOwn(step.command.env, 'KIMI_API_KEY')
      ))).toBe(true);
      expect(task.desktopBuildPlan.command.executable).toBe(
        join(base.nodeRuntimeInput.distributionRoot, 'bin/node'),
      );
    }
    expect(result.preflightPlan.nodeRuntimeInput.archivePath).toBeUndefined();
    expect(result.preflightPlan.nodeRuntimeInput.distributionRoot).toBeUndefined();
    expect(result.preflightPlan.sourceCommitMaps.baseline.desktop.kswarm)
      .toEqual(result.preflightPlan.sourceCommitMaps.candidate.desktop.kswarm);
    expect(Object.isFrozen(result.preflightPlan)).toBe(true);
    expect(result.preflightPlanHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('runs every frozen Desktop preparation step once and rejects omission, duplication, or generated drift', async () => {
    const {
      createFormalBuildPlan,
      runFrozenDesktopBuildSteps,
    } = await loadModule();
    const root = join(tmpdir(), 'kimi-d9-formal-desktop-steps');
    const plan = createFormalBuildPlan(validInput(root));
    const task = plan.constructionTasks['baseline.desktop.app'];
    const calls: string[] = [];
    const inspections: string[] = [];
    const successful = await runFrozenDesktopBuildSteps(task, {
      runStep: async (step: any) => {
        calls.push(step.stepId);
        expect(step.command.executable).toBe(
          join(task.nodeRuntimeInput.distributionRoot, 'bin/node'),
        );
        expect(step.command.args[0]).toBe(
          join(
            task.nodeRuntimeInput.distributionRoot,
            task.nodeRuntimeInput.npmCliRelativePath,
          ),
        );
        expect(Object.keys(step.command.env).sort()).toEqual([
          'CI',
          'CSC_IDENTITY_AUTO_DISCOVERY',
          'DYLD_FALLBACK_LIBRARY_PATH',
          'DYLD_INSERT_LIBRARIES',
          'DYLD_LIBRARY_PATH',
          'HOME',
          'LANG',
          'LC_ALL',
          'NODE_OPTIONS',
          'NODE_PATH',
          'PATH',
          'TEMP',
          'TMP',
          'TMPDIR',
          'npm_config_audit',
          'npm_config_cache',
          'npm_config_fund',
          'npm_config_update_notifier',
        ]);
      },
      inspectRepository: async (repo: string) => {
        inspections.push(repo);
        return {
          commit: task.sourceCommitMap[repo].commit,
          dirty: false,
          statusByteCount: 0,
          statusPaths: [],
        };
      },
    });
    expect(calls).toEqual(task.desktopBuildSteps.map(
      (step: any) => step.stepId,
    ));
    expect(successful.stepCompletionCounters).toEqual(Object.fromEntries(
      calls.map(stepId => [stepId, 1]),
    ));
    expect(inspections.length).toBeGreaterThan(calls.length);

    const missing = {
      ...task,
      desktopBuildSteps: task.desktopBuildSteps.slice(1),
    };
    await expect(runFrozenDesktopBuildSteps(missing, {
      runStep: async () => {},
      inspectRepository: async () => ({
        commit: BASELINE_COMMIT,
        dirty: false,
        statusByteCount: 0,
        statusPaths: [],
      }),
    })).rejects.toThrow('KIMI_D9_DESKTOP_BUILD_STEPS_INVALID');

    const duplicate = {
      ...task,
      desktopBuildSteps: [
        ...task.desktopBuildSteps,
        task.desktopBuildSteps[0],
      ],
    };
    await expect(runFrozenDesktopBuildSteps(duplicate, {
      runStep: async () => {},
      inspectRepository: async () => ({
        commit: BASELINE_COMMIT,
        dirty: false,
        statusByteCount: 0,
        statusPaths: [],
      }),
    })).rejects.toThrow('KIMI_D9_DESKTOP_BUILD_STEPS_INVALID');

    let driftInspectionCount = 0;
    await expect(runFrozenDesktopBuildSteps(task, {
      runStep: async () => {},
      inspectRepository: async (repo: string) => {
        driftInspectionCount += 1;
        return {
          commit: task.sourceCommitMap[repo].commit,
          dirty: driftInspectionCount > 4,
          statusByteCount: driftInspectionCount > 4 ? 24 : 0,
          statusPaths: driftInspectionCount > 4
            ? ['src/unreviewed.js']
            : [],
        };
      },
    })).rejects.toThrow('KIMI_D9_DESKTOP_GENERATED_OUTPUT_DRIFT');
  });

  it('fails closed on provenance, official Node, layout, computed edge, or sibling drift', async () => {
    const { createFormalBuildPlan } = await loadModule();
    const root = join(tmpdir(), 'kimi-d9-formal-negative');
    const base = validInput(root);

    const invalidInputs = [
      { ...base, candidateCommit: BASELINE_COMMIT },
      {
        ...base,
        nodeRuntimeInput: {
          ...base.nodeRuntimeInput,
          archiveSha256: '0'.repeat(64),
        },
      },
      {
        ...base,
        artifactParent: join(root, 'builds/artifacts'),
      },
      {
        ...base,
        cliGraphInputs: {
          ...base.cliGraphInputs,
          baseline: {
            ...base.cliGraphInputs.baseline,
            computedEdgeAllowlist: [],
          },
        },
      },
      {
        ...base,
        sourceCommitMaps: {
          ...base.sourceCommitMaps,
          candidate: {
            ...base.sourceCommitMaps.candidate,
            desktop: {
              ...base.sourceCommitMaps.candidate.desktop,
              kswarm: sourceEntry('kswarm', 'f'.repeat(40)),
            },
          },
        },
      },
      {
        ...base,
        unreviewedConstructionOverride: 'forbidden',
      },
      {
        ...base,
        sourceCommitMaps: {
          ...base.sourceCommitMaps,
          baseline: {
            ...base.sourceCommitMaps.baseline,
            cli: {
              'xiaok-cli': {
                ...base.sourceCommitMaps.baseline.cli['xiaok-cli'],
                clean: false,
              },
            },
          },
        },
      },
    ];
    for (const invalid of invalidInputs) {
      expect(() => createFormalBuildPlan(invalid))
        .toThrow(/KIMI_D9_FORMAL_BUILD_|KIMI_D9_DESKTOP_/u);
    }
  });

  it('constructs every physical artifact exactly once and emits bounded CLI graph manifests', async () => {
    const {
      createFormalBuildLedger,
      createFormalBuildPlan,
      freezeFormalArtifactAttestation,
      runFormalArtifactBuilds,
    } = await loadModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-formal-run-'));
    try {
      const input = validInput(root);
      const plan = createFormalBuildPlan(input);
      const buildCalls: string[] = [];
      const result = await runFormalArtifactBuilds({
        plan,
        ledger: createFormalBuildLedger(),
        operations: {
          prepareSource: async (task: any) => {
            await mkdir(task.sourceRoot, { recursive: true });
            buildCalls.push(`source:${task.artifactKey}`);
            return {
              // macOS commonly canonicalizes /tmp and /var through /private.
              // A physical-path alias must not invalidate a correct checkout.
              sourceRoot: await realpath(task.sourceRoot),
              commit: task.expectedCommit,
              clean: true,
            };
          },
          constructCli: async (task: any) => {
            const artifactPath = join(
              task.constructionParent,
              `closure-${task.arm}`,
            );
            await mkdir(join(artifactPath, 'dist'), { recursive: true });
            await mkdir(
              join(artifactPath, 'runtime/guard'),
              { recursive: true },
            );
            await writeFile(
              join(artifactPath, 'dist/index.js'),
              `export const arm = '${task.arm}';\n`,
            );
            await writeFile(
              join(artifactPath, 'runtime/guard/runtime-guard.mjs'),
              'export {};\n',
            );
            buildCalls.push(`build:${task.artifactKey}`);
            return {
              artifactPath,
              constructionCompletionCount: 1,
              closureAttestation: {
                closureDigest: task.arm === 'baseline'
                  ? '2'.repeat(64)
                  : '3'.repeat(64),
              },
            };
          },
          finalizeCli: async (task: any, built: any) => ({
            artifactPath: built.artifactPath,
            constructionCompletionCount: 1,
            closureAttestation: built.closureAttestation,
            resolutionGraph: {
              entryRelativePath: 'dist/index.js',
              modules: [
                'dist/index.js',
                'runtime/guard/runtime-guard.mjs',
              ],
              edges: [],
            },
            nodeLaunchContract: {
              nodeVersion: 'v24.15.0',
              modulesAbi: '137',
              nodeApi: '10',
              platform: 'darwin',
              arch: 'arm64',
            },
            nativeDependencyGraph: {
              roots: [],
              classifications: [],
              dependencies: [],
            },
            guardTreeDigest: '4'.repeat(64),
          }),
          constructDesktop: async (task: any) => {
            const artifactPath = task.artifactPath;
            await mkdir(
              join(artifactPath, 'Contents/MacOS'),
              { recursive: true },
            );
            await writeFile(
              join(artifactPath, 'Contents/MacOS/xiaok'),
              task.arm,
            );
            buildCalls.push(`build:${task.artifactKey}`);
            return {
              artifactPath,
              constructionCompletionCount: 1,
            };
          },
        },
      });

      expect(buildCalls.filter(call => call.startsWith('build:'))).toEqual([
        'build:baseline.cli.runtimeClosure',
        'build:baseline.desktop.app',
        'build:candidate.cli.runtimeClosure',
        'build:candidate.desktop.app',
      ]);
      expect(result.constructionCompletionCounters).toEqual({
        'baseline.cli.runtimeClosure': 1,
        'baseline.desktop.app': 1,
        'candidate.cli.runtimeClosure': 1,
        'candidate.desktop.app': 1,
      });
      expect(result.artifactDigests).toEqual({
        'baseline.cli.runtimeClosure': expect.stringMatching(/^[0-9a-f]{64}$/u),
        'baseline.desktop.app': expect.stringMatching(/^[0-9a-f]{64}$/u),
        'candidate.cli.runtimeClosure': expect.stringMatching(/^[0-9a-f]{64}$/u),
        'candidate.desktop.app': expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      expect(result.cliRuntimeManifests.baseline.allowedModuleRelativePaths)
        .toEqual([
          'dist/index.js',
          'runtime/guard/runtime-guard.mjs',
        ]);
      expect(result.cliRuntimeManifests.baseline.resolutionGraphDigest)
        .toMatch(/^[0-9a-f]{64}$/u);
      expect(result.preflightArtifactAttestation.preflightPlanHash)
        .toBe(plan.preflightPlanHash);
      expect(result.preflightArtifactAttestation.artifacts[
        'candidate.desktop.app'
      ].physicalIdentity.realpath).toBe(
        result.preflightArtifactAttestation.artifacts[
          'candidate.desktop.app'
        ].artifactPath,
      );
      const frozen = await freezeFormalArtifactAttestation({
        attestationPath: join(root, 'preflight-artifact-attestation.json'),
        buildResult: result,
      });
      expect(frozen.hash).toMatch(/^[0-9a-f]{64}$/u);
      await expect(freezeFormalArtifactAttestation({
        attestationPath: join(root, 'preflight-artifact-attestation.json'),
        buildResult: result,
      })).rejects.toThrow(
        'KIMI_D9_ARTIFACT_ATTESTATION_ALREADY_EXISTS',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate, skipped, rebuilt, or unfinalized construction before attestation', async () => {
    const {
      createFormalBuildLedger,
      createFormalBuildPlan,
      runFormalArtifactBuilds,
    } = await loadModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-formal-count-'));
    try {
      const input = validInput(root);
      const plan = createFormalBuildPlan(input);
      const ledger = createFormalBuildLedger();
      const operations = {
        prepareSource: async (task: any) => {
          await mkdir(task.sourceRoot, { recursive: true });
          return {
            sourceRoot: task.sourceRoot,
            commit: task.expectedCommit,
            clean: true,
          };
        },
        constructCli: async () => ({
          artifactPath: join(root, 'missing-cli'),
          constructionCompletionCount: 2,
        }),
        finalizeCli: async () => {
          throw new Error('must not finalize');
        },
        constructDesktop: async () => {
          throw new Error('must not build desktop');
        },
      };

      await expect(runFormalArtifactBuilds({
        plan,
        ledger,
        operations,
      })).rejects.toThrow('KIMI_D9_FORMAL_BUILD_COUNT_INVALID');
      await expect(runFormalArtifactBuilds({
        plan,
        ledger,
        operations,
      })).rejects.toThrow(
        'KIMI_D9_FORMAL_ARTIFACT_ALREADY_CONSTRUCTED',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
