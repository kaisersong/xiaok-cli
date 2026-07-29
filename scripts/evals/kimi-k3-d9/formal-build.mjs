import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { promisify } from 'node:util';
import {
  attestCliRuntimeClosure,
  constructCliRuntimeClosure,
  createDetachedRecordedWorktree,
  OFFICIAL_NODE_RUNTIME_INPUT,
} from './cli-closure-build.mjs';
import { createDarwinArm64ComputedEdgeAllowlist } from './cli-computed-edges.mjs';
import { probeNodeLaunchContract } from './cli-launch.mjs';
import { canonicalSha256, canonicalize } from './canonical.mjs';
import {
  createDesktopBuildPlan,
  runDesktopBuildOnce,
  validateDesktopSourceCommitMap,
  validatePairedDesktopSourceCommitMaps,
} from './desktop-build.mjs';
import {
  D9_ARTIFACT_DIGEST_ALGORITHM,
  D9_ARTIFACT_KEYS,
  D9_DESIGN_SHA256,
  D9_STAGE,
} from './constants.mjs';
import { buildFrozenManifest } from './manifest.mjs';
import { buildNativeDependencyGraph } from './native-graph.mjs';
import {
  capturePhysicalIdentity,
  createImmutableArtifactAttestation,
} from './preflight.mjs';
import { buildReachableResolutionGraph } from './resolution-graph.mjs';
import { digestGuardTree } from './runtime-guard.mjs';
import {
  digestTree as digestArtifactTree,
  inventoryTree,
} from './tree-digest.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORIES = Object.freeze([
  'xiaok-cli',
  'kswarm',
  'intent-broker',
  'kai-xiaok-plugins',
]);
const ARMS = Object.freeze(['baseline', 'candidate']);
const SOURCE_ENTRY_KEYS = Object.freeze([
  'repositoryIdentity',
  'commit',
  'clean',
  'statusByteCount',
  'lockfileDigest',
  'generatedOutputDigest',
  'packedInputTreeDigest',
]);
const COMPUTED_EDGE_KEYS = Object.freeze([
  'importerSha256',
  'astLocation',
  'pattern',
  'targets',
]);
const OFFICIAL_NODE_KEYS = Object.freeze([
  ...Object.keys(OFFICIAL_NODE_RUNTIME_INPUT),
  'archivePath',
  'distributionRoot',
  'distributionTreeDigest',
  'npmCliRelativePath',
  'npmCliSha256',
  'installAffectingNpmConfigAllowlist',
]);
const DESKTOP_BUILD_STEP_IDS = Object.freeze([
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
const FORMAL_BUILD_INPUT_KEYS = Object.freeze([
  'baselineCommit',
  'candidateCommit',
  'buildParent',
  'artifactParent',
  'repositoryRoots',
  'sourceCommitMaps',
  'nodeRuntimeInput',
  'guardInput',
  'cliGraphInputs',
  'generatedOutputAllowlists',
  'eligibilitySmokeDriver',
]);

function fail(code, details = '') {
  throw new Error(details ? `${code}: ${details}` : code);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every(key => typeof key === 'string' && expected.includes(key));
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isCommit(value) {
  return typeof value === 'string' && COMMIT_PATTERN.test(value);
}

function isWithin(root, child) {
  const path = relative(resolve(root), resolve(child));
  return path === ''
    || (
      path !== '..'
      && !path.startsWith(`..${sep}`)
      && !isAbsolute(path)
    );
}

function isIndependent(left, right) {
  return !isWithin(left, right) && !isWithin(right, left);
}

function isSafeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !isAbsolute(value)
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalClone(value) {
  return JSON.parse(canonicalize(value));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validateSourceEntry(entry, expectedCommit) {
  if (
    !hasExactKeys(entry, SOURCE_ENTRY_KEYS)
    || typeof entry.repositoryIdentity !== 'string'
    || entry.repositoryIdentity.length === 0
    || entry.repositoryIdentity.includes('://')
    || entry.repositoryIdentity.includes('@')
    || /[?#]/u.test(entry.repositoryIdentity)
    || entry.commit !== expectedCommit
    || entry.clean !== true
    || entry.statusByteCount !== 0
    || !isSha256(entry.lockfileDigest)
    || !isSha256(entry.generatedOutputDigest)
    || !isSha256(entry.packedInputTreeDigest)
  ) {
    fail('KIMI_D9_FORMAL_BUILD_PROVENANCE_INVALID');
  }
}

function validateSourceCommitMaps(
  input,
  baselineCommit,
  candidateCommit,
) {
  if (
    !hasExactKeys(input, ARMS)
    || ARMS.some(arm => !hasExactKeys(input[arm], ['cli', 'desktop']))
  ) {
    fail('KIMI_D9_FORMAL_BUILD_SOURCE_MAP_INVALID');
  }
  for (const arm of ARMS) {
    const expectedCommit = arm === 'baseline'
      ? baselineCommit
      : candidateCommit;
    if (
      !hasExactKeys(input[arm].cli, ['xiaok-cli'])
    ) {
      fail('KIMI_D9_FORMAL_BUILD_SOURCE_MAP_INVALID');
    }
    validateSourceEntry(input[arm].cli['xiaok-cli'], expectedCommit);
    validateDesktopSourceCommitMap(input[arm].desktop);
    validateSourceEntry(input[arm].desktop['xiaok-cli'], expectedCommit);
  }
  validatePairedDesktopSourceCommitMaps(
    input.baseline.desktop,
    input.candidate.desktop,
  );
}

function isSafeComputedTarget(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !isAbsolute(value)
    && (value.startsWith('./') || value.startsWith('../'));
}

function validateOfficialNode(input) {
  if (
    !hasExactKeys(input, OFFICIAL_NODE_KEYS)
    || !isAbsolute(input.archivePath)
    || !isAbsolute(input.distributionRoot)
    || !isSha256(input.distributionTreeDigest)
    || !isSafeRelativePath(input.npmCliRelativePath)
    || !isSha256(input.npmCliSha256)
    || !Array.isArray(input.installAffectingNpmConfigAllowlist)
    || input.installAffectingNpmConfigAllowlist.some(value => (
      typeof value !== 'string'
      || value.length === 0
    ))
    || new Set(input.installAffectingNpmConfigAllowlist).size
      !== input.installAffectingNpmConfigAllowlist.length
    || Object.entries(OFFICIAL_NODE_RUNTIME_INPUT).some(
      ([key, value]) => input[key] !== value,
    )
  ) {
    fail('KIMI_D9_FORMAL_BUILD_NODE_INPUT_INVALID');
  }
}

function validateComputedEdgeAllowlist(value) {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some(edge => (
      !hasExactKeys(edge, COMPUTED_EDGE_KEYS)
      || !isSha256(edge.importerSha256)
      || !/^[1-9]\d*:[1-9]\d*$/u.test(edge.astLocation)
      || typeof edge.pattern !== 'string'
      || edge.pattern.length === 0
      || !Array.isArray(edge.targets)
      || edge.targets.length === 0
      || edge.targets.some(target => !isSafeComputedTarget(target))
      || new Set(edge.targets).size !== edge.targets.length
    ))
  ) {
    fail('KIMI_D9_FORMAL_BUILD_COMPUTED_EDGE_INVALID');
  }
}

function validateCliGraphInputs(input) {
  if (!hasExactKeys(input, ARMS)) {
    fail('KIMI_D9_FORMAL_BUILD_CLI_GRAPH_INVALID');
  }
  for (const arm of ARMS) {
    if (
      !hasExactKeys(input[arm], [
        'computedEdgeAllowlist',
        'nativeCompatibilityByRelativePath',
      ])
      || !isPlainObject(input[arm].nativeCompatibilityByRelativePath)
    ) {
      fail('KIMI_D9_FORMAL_BUILD_CLI_GRAPH_INVALID');
    }
    validateComputedEdgeAllowlist(input[arm].computedEdgeAllowlist);
  }
}

function validateRepositoryRoots(input) {
  if (
    !hasExactKeys(input, REPOSITORIES)
    || REPOSITORIES.some(repo => !isAbsolute(input[repo]))
  ) {
    fail('KIMI_D9_FORMAL_BUILD_REPOSITORY_ROOT_INVALID');
  }
  const roots = Object.values(input).map(value => resolve(value));
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (!isIndependent(roots[left], roots[right])) {
        fail('KIMI_D9_FORMAL_BUILD_REPOSITORY_ROOT_INVALID');
      }
    }
  }
}

function validateGuardInput(input) {
  if (
    !hasExactKeys(input, [
      'sourcePath',
      'relativePath',
      'contentSha256',
      'version',
    ])
    || !isAbsolute(input.sourcePath)
    || input.relativePath !== 'runtime/guard/runtime-guard.mjs'
    || !isSha256(input.contentSha256)
    || typeof input.version !== 'string'
    || input.version.length === 0
  ) {
    fail('KIMI_D9_FORMAL_BUILD_GUARD_INVALID');
  }
}

function validateGeneratedOutputAllowlists(input) {
  if (
    !hasExactKeys(input, ['cli', 'desktop'])
    || !Array.isArray(input.cli)
    || !hasExactKeys(input.desktop, REPOSITORIES)
  ) {
    fail('KIMI_D9_FORMAL_BUILD_GENERATED_ALLOWLIST_INVALID');
  }
  for (const values of [input.cli, ...Object.values(input.desktop)]) {
    if (
      !Array.isArray(values)
      || values.some(value => !isSafeRelativePath(value))
      || new Set(values).size !== values.length
    ) {
      fail('KIMI_D9_FORMAL_BUILD_GENERATED_ALLOWLIST_INVALID');
    }
  }
}

function validateSmokeDriver(input) {
  if (
    !hasExactKeys(input, ['relativePath', 'contentSha256', 'version'])
    || !isSafeRelativePath(input.relativePath)
    || !isSha256(input.contentSha256)
    || typeof input.version !== 'string'
    || input.version.length === 0
  ) {
    fail('KIMI_D9_FORMAL_BUILD_SMOKE_DRIVER_INVALID');
  }
}

function constructionRecipe({
  artifactKey,
  arm,
  surface,
  expectedCommit,
  sourceCommitMap,
  nodeRuntimeInput,
  guardInput,
  cliGraphInput,
  generatedOutputAllowlist,
  desktopBuildSteps,
  desktopPackagingCommand,
}) {
  const common = {
    schemaVersion: 1,
    artifactKey,
    arm,
    surface,
    expectedCommit,
    sourceCommitMap,
    generatedOutputAllowlist,
    constructionCompletionCount: 1,
  };
  if (surface === 'cli') {
    return {
      ...common,
      operations: [
        'build-install',
        'build-release',
        'runtime-install',
        'assemble',
        'resolution-graph',
        'native-graph',
        'guard-manifest',
      ],
      nodeRuntimeInput,
      guardInput,
      computedEdgeAllowlist: cliGraphInput.computedEdgeAllowlist,
      nativeCompatibilityByRelativePath:
        cliGraphInput.nativeCompatibilityByRelativePath,
    };
  }
  return {
    ...common,
    operations: [
      'detached-sibling-layout',
      'frozen-install-build-steps',
      'unsigned-package-once',
    ],
    desktopBuildSteps,
    desktopPackagingCommand,
    signing: false,
  };
}

function createClosedDesktopBuildEnvironment({
  nodeDistributionRoot,
  buildStateRoot,
}) {
  return {
    HOME: join(buildStateRoot, 'home'),
    TMPDIR: join(buildStateRoot, 'tmp'),
    TMP: join(buildStateRoot, 'tmp'),
    TEMP: join(buildStateRoot, 'tmp'),
    PATH: `${join(nodeDistributionRoot, 'bin')}:/usr/bin:/bin`,
    NODE_OPTIONS: '',
    NODE_PATH: '',
    DYLD_LIBRARY_PATH: '',
    DYLD_FALLBACK_LIBRARY_PATH: '',
    DYLD_INSERT_LIBRARIES: '',
    npm_config_cache: join(buildStateRoot, 'npm-cache'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    CI: '1',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  };
}

function createFrozenDesktopBuildSteps({
  layoutRoot,
  nodeRuntimeInput,
  buildStateRoot,
}) {
  const nodeExecutable = join(
    nodeRuntimeInput.distributionRoot,
    'bin',
    'node',
  );
  const npmCli = join(
    nodeRuntimeInput.distributionRoot,
    nodeRuntimeInput.npmCliRelativePath,
  );
  const env = createClosedDesktopBuildEnvironment({
    nodeDistributionRoot: nodeRuntimeInput.distributionRoot,
    buildStateRoot,
  });
  const definitions = [
    ['xiaok-root-install', 'xiaok-cli', '.', ['ci']],
    ['desktop-install', 'xiaok-cli', 'desktop', ['ci']],
    ['kswarm-install', 'kswarm', '.', ['ci']],
    ['intent-broker-install', 'intent-broker', '.', ['ci']],
    [
      'report-renderer-install',
      'kai-xiaok-plugins',
      'plugins/kai-report-creator/mcp-servers/report-renderer',
      ['ci'],
    ],
    [
      'report-renderer-build',
      'kai-xiaok-plugins',
      'plugins/kai-report-creator/mcp-servers/report-renderer',
      ['run', 'build'],
    ],
    [
      'report-renderer-bundle',
      'kai-xiaok-plugins',
      'plugins/kai-report-creator/mcp-servers/report-renderer',
      ['run', 'build:bundle'],
    ],
    [
      'infinity-canvas-install',
      'kai-xiaok-plugins',
      'plugins/kai-infinity-canvas',
      ['ci'],
    ],
    ['desktop-build', 'xiaok-cli', 'desktop', ['run', 'build']],
  ];
  return definitions.map(([
    stepId,
    repository,
    cwdRelativePath,
    npmArguments,
  ]) => ({
    stepId,
    repository,
    cwdRelativePath,
    command: {
      executable: nodeExecutable,
      args: [npmCli, ...npmArguments],
      cwd: resolve(layoutRoot, repository, cwdRelativePath),
      env,
    },
  }));
}

function buildConstructionTasks(input, sanitizedNodeRuntimeInput) {
  const tasks = {};
  for (const arm of ARMS) {
    const expectedCommit = arm === 'baseline'
      ? input.baselineCommit
      : input.candidateCommit;
    const cliKey = `${arm}.cli.runtimeClosure`;
    const cliSourceRoot = resolve(input.buildParent, `${arm}-cli`, 'xiaok-cli');
    const cliConstructionParent = resolve(
      input.artifactParent,
      `${arm}-cli-construction`,
    );
    tasks[cliKey] = {
      artifactKey: cliKey,
      arm,
      surface: 'cli',
      expectedCommit,
      sourceRoot: cliSourceRoot,
      sourceCommitMap: input.sourceCommitMaps[arm].cli,
      constructionParent: cliConstructionParent,
      repositoryRoots: input.repositoryRoots,
      nodeRuntimeInput: input.nodeRuntimeInput,
      guardInput: input.guardInput,
      cliGraphInput: input.cliGraphInputs[arm],
      generatedOutputAllowlist: input.generatedOutputAllowlists.cli,
      recipe: constructionRecipe({
        artifactKey: cliKey,
        arm,
        surface: 'cli',
        expectedCommit,
        sourceCommitMap: input.sourceCommitMaps[arm].cli,
        nodeRuntimeInput: sanitizedNodeRuntimeInput,
        guardInput: {
          relativePath: input.guardInput.relativePath,
          contentSha256: input.guardInput.contentSha256,
          version: input.guardInput.version,
        },
        cliGraphInput: input.cliGraphInputs[arm],
        generatedOutputAllowlist: input.generatedOutputAllowlists.cli,
      }),
    };

    const desktopKey = `${arm}.desktop.app`;
    const layoutRoot = resolve(input.buildParent, `${arm}-desktop-layout`);
    const artifactPath = resolve(
      input.artifactParent,
      `${arm}-desktop`,
      'mac-arm64',
      'xiaok.app',
    );
    const buildStateRoot = resolve(
      input.artifactParent,
      `${arm}-desktop-build-state`,
    );
    const desktopBuildSteps = createFrozenDesktopBuildSteps({
      layoutRoot,
      nodeRuntimeInput: input.nodeRuntimeInput,
      buildStateRoot,
    });
    const baseDesktopBuildPlan = createDesktopBuildPlan({
      arm,
      layoutRoot,
      xiaokCliRoot: join(layoutRoot, 'xiaok-cli'),
      artifactPath,
      sourceCommitMap: input.sourceCommitMaps[arm].desktop,
    });
    const desktopBuildPlan = {
      ...baseDesktopBuildPlan,
      command: {
        ...baseDesktopBuildPlan.command,
        executable: join(
          input.nodeRuntimeInput.distributionRoot,
          'bin',
          'node',
        ),
        env: createClosedDesktopBuildEnvironment({
          nodeDistributionRoot:
            input.nodeRuntimeInput.distributionRoot,
          buildStateRoot,
        }),
      },
    };
    tasks[desktopKey] = {
      artifactKey: desktopKey,
      arm,
      surface: 'desktop',
      expectedCommit,
      sourceRoot: layoutRoot,
      layoutRoot,
      xiaokCliRoot: join(layoutRoot, 'xiaok-cli'),
      artifactPath,
      buildStateRoot,
      sourceCommitMap: input.sourceCommitMaps[arm].desktop,
      repositoryRoots: input.repositoryRoots,
      nodeRuntimeInput: input.nodeRuntimeInput,
      desktopBuildSteps,
      desktopBuildPlan,
      generatedOutputAllowlist: input.generatedOutputAllowlists.desktop,
      recipe: constructionRecipe({
        artifactKey: desktopKey,
        arm,
        surface: 'desktop',
        expectedCommit,
        sourceCommitMap: input.sourceCommitMaps[arm].desktop,
        generatedOutputAllowlist:
          input.generatedOutputAllowlists.desktop,
        desktopBuildSteps,
        desktopPackagingCommand: desktopBuildPlan.command,
      }),
    };
  }
  return tasks;
}

export function createFormalBuildPlan(input) {
  if (
    !hasExactKeys(input, FORMAL_BUILD_INPUT_KEYS)
    || !isCommit(input.baselineCommit)
    || !isCommit(input.candidateCommit)
    || input.baselineCommit === input.candidateCommit
    || !isAbsolute(input.buildParent)
    || !isAbsolute(input.artifactParent)
    || !isIndependent(input.buildParent, input.artifactParent)
  ) {
    fail('KIMI_D9_FORMAL_BUILD_INPUT_INVALID');
  }
  validateRepositoryRoots(input.repositoryRoots);
  for (const repoRoot of Object.values(input.repositoryRoots)) {
    if (
      !isIndependent(repoRoot, input.buildParent)
      || !isIndependent(repoRoot, input.artifactParent)
    ) {
      fail('KIMI_D9_FORMAL_BUILD_LAYOUT_INVALID');
    }
  }
  validateOfficialNode(input.nodeRuntimeInput);
  validateGuardInput(input.guardInput);
  validateCliGraphInputs(input.cliGraphInputs);
  validateGeneratedOutputAllowlists(input.generatedOutputAllowlists);
  validateSmokeDriver(input.eligibilitySmokeDriver);
  validateSourceCommitMaps(
    input.sourceCommitMaps,
    input.baselineCommit,
    input.candidateCommit,
  );

  const sanitizedNodeRuntimeInput = {
    archiveIdentity: input.nodeRuntimeInput.archiveIdentity,
    archiveSha256: input.nodeRuntimeInput.archiveSha256,
    distributionTreeDigest:
      input.nodeRuntimeInput.distributionTreeDigest,
    nodeVersion: input.nodeRuntimeInput.nodeVersion,
    modulesAbi: input.nodeRuntimeInput.modulesAbi,
    nodeApi: input.nodeRuntimeInput.nodeApi,
    platform: input.nodeRuntimeInput.platform,
    arch: input.nodeRuntimeInput.arch,
    npmVersion: input.nodeRuntimeInput.npmVersion,
    npmCliRelativePath: input.nodeRuntimeInput.npmCliRelativePath,
    npmCliSha256: input.nodeRuntimeInput.npmCliSha256,
    installAffectingNpmConfigAllowlist:
      input.nodeRuntimeInput.installAffectingNpmConfigAllowlist,
  };
  const tasks = buildConstructionTasks(input, sanitizedNodeRuntimeInput);
  const artifactConstructionCommandDigests = Object.fromEntries(
    D9_ARTIFACT_KEYS.map(key => [key, canonicalSha256(tasks[key].recipe)]),
  );
  const preflightPlan = deepFreeze(canonicalClone({
    schemaVersion: 1,
    designSha256: D9_DESIGN_SHA256,
    stage: D9_STAGE,
    baselineProductCommit: input.baselineCommit,
    candidateProductCommit: input.candidateCommit,
    artifactConstructionOrder: D9_ARTIFACT_KEYS,
    artifactConstructionCommandDigests,
    constructionRoots: Object.fromEntries(
      D9_ARTIFACT_KEYS.map(key => [key, {
        sourceRoot: tasks[key].sourceRoot,
        artifactRoot: tasks[key].surface === 'cli'
          ? tasks[key].constructionParent
          : tasks[key].artifactPath,
      }]),
    ),
    localInputBindings: {
      officialNodeArchivePath: resolve(input.nodeRuntimeInput.archivePath),
      officialNodeDistributionRoot:
        resolve(input.nodeRuntimeInput.distributionRoot),
      guardSourcePath: resolve(input.guardInput.sourcePath),
    },
    nodeRuntimeInput: sanitizedNodeRuntimeInput,
    guardInput: {
      relativePath: input.guardInput.relativePath,
      contentSha256: input.guardInput.contentSha256,
      version: input.guardInput.version,
    },
    cliGraphInputs: input.cliGraphInputs,
    sourceCommitMaps: input.sourceCommitMaps,
    generatedOutputAllowlists: input.generatedOutputAllowlists,
    eligibilitySmokeDriver: input.eligibilitySmokeDriver,
  }));
  return deepFreeze({
    preflightPlan,
    preflightPlanHash: canonicalSha256(preflightPlan),
    constructionTasks: tasks,
  });
}

export function createFormalBuildLedger() {
  const reserved = new Set();
  return Object.freeze({
    reserve(artifactKey) {
      if (!D9_ARTIFACT_KEYS.includes(artifactKey)) {
        fail('KIMI_D9_FORMAL_BUILD_KEY_INVALID');
      }
      if (reserved.has(artifactKey)) {
        fail('KIMI_D9_FORMAL_ARTIFACT_ALREADY_CONSTRUCTED');
      }
      reserved.add(artifactKey);
      return 1;
    },
    snapshot() {
      return Object.fromEntries(
        D9_ARTIFACT_KEYS.map(key => [key, reserved.has(key) ? 1 : 0]),
      );
    },
  });
}

async function defaultPrepareSource(task) {
  if (task.surface === 'cli') {
    const created = await createDetachedRecordedWorktree({
      repoRoot: task.repositoryRoots['xiaok-cli'],
      worktreePath: task.sourceRoot,
      commit: task.expectedCommit,
    });
    return {
      sourceRoot: created.worktreePath,
      commit: created.commit,
      clean: created.clean,
    };
  }
  for (const repo of REPOSITORIES) {
    await createDetachedRecordedWorktree({
      repoRoot: task.repositoryRoots[repo],
      worktreePath: join(task.layoutRoot, repo),
      commit: task.sourceCommitMap[repo].commit,
    });
  }
  await mkdir(join(task.buildStateRoot, 'home'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(join(task.buildStateRoot, 'tmp'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(join(task.buildStateRoot, 'npm-cache'), {
    recursive: true,
    mode: 0o700,
  });
  await runFrozenDesktopBuildSteps(task);
  return {
    sourceRoot: task.layoutRoot,
    commit: task.expectedCommit,
    clean: true,
  };
}

function pathAllowed(path, allowlist) {
  return allowlist.some(allowed => (
    path === allowed
    || path.startsWith(`${allowed.replace(/\/+$/u, '')}/`)
  ));
}

async function defaultInspectDesktopRepository(task, repository) {
  const repoRoot = join(task.layoutRoot, repository);
  const [{ stdout: commitOutput }, { stdout: statusOutput }] =
    await Promise.all([
      execFileAsync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }),
      execFileAsync(
        'git',
        ['-C', repoRoot, 'status', '--porcelain=v1'],
        { encoding: 'utf8' },
      ),
    ]);
  const statusPaths = statusOutput
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => line.slice(3));
  return {
    commit: commitOutput.trim(),
    dirty: statusPaths.length > 0,
    statusByteCount: Buffer.byteLength(statusOutput, 'utf8'),
    statusPaths,
  };
}

async function defaultRunDesktopBuildStep(step) {
  await execFileAsync(
    step.command.executable,
    step.command.args,
    {
      cwd: step.command.cwd,
      env: step.command.env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
}

function validateDesktopBuildSteps(task) {
  if (
    !Array.isArray(task.desktopBuildSteps)
    || task.desktopBuildSteps.length !== DESKTOP_BUILD_STEP_IDS.length
    || task.desktopBuildSteps.some((step, index) => (
      step.stepId !== DESKTOP_BUILD_STEP_IDS[index]
      || !REPOSITORIES.includes(step.repository)
      || !isSafeRelativePath(step.cwdRelativePath)
      || !isPlainObject(step.command)
      || step.command.executable !== join(
        task.nodeRuntimeInput.distributionRoot,
        'bin',
        'node',
      )
      || !Array.isArray(step.command.args)
      || step.command.args[0] !== join(
        task.nodeRuntimeInput.distributionRoot,
        task.nodeRuntimeInput.npmCliRelativePath,
      )
      || step.command.cwd !== resolve(
        task.layoutRoot,
        step.repository,
        step.cwdRelativePath,
      )
      || !sameCanonical(
        step.command.env,
        createClosedDesktopBuildEnvironment({
          nodeDistributionRoot:
            task.nodeRuntimeInput.distributionRoot,
          buildStateRoot: task.buildStateRoot,
        }),
      )
    ))
  ) {
    fail('KIMI_D9_DESKTOP_BUILD_STEPS_INVALID');
  }
}

function validateDesktopRepositoryInspection(
  task,
  repository,
  inspection,
  allowGenerated,
) {
  const expected = task.sourceCommitMap[repository];
  if (
    !isPlainObject(inspection)
    || inspection.commit !== expected.commit
    || typeof inspection.dirty !== 'boolean'
    || !Number.isSafeInteger(inspection.statusByteCount)
    || inspection.statusByteCount < 0
    || !Array.isArray(inspection.statusPaths)
    || inspection.statusPaths.some(path => typeof path !== 'string')
  ) {
    fail('KIMI_D9_DESKTOP_BUILD_PROVENANCE_DRIFT');
  }
  if (!allowGenerated) {
    if (
      inspection.dirty
      || inspection.statusByteCount !== 0
      || inspection.statusPaths.length !== 0
    ) {
      fail('KIMI_D9_DESKTOP_BUILD_START_DIRTY');
    }
    return;
  }
  const unexpected = inspection.statusPaths.filter(
    path => !pathAllowed(
      path,
      task.generatedOutputAllowlist[repository],
    ),
  );
  if (unexpected.length > 0) {
    fail('KIMI_D9_DESKTOP_GENERATED_OUTPUT_DRIFT');
  }
}

export async function runFrozenDesktopBuildSteps(task, options = {}) {
  validateDesktopBuildSteps(task);
  const runStep = options.runStep ?? defaultRunDesktopBuildStep;
  const inspectRepository = options.inspectRepository
    ?? (repository => defaultInspectDesktopRepository(task, repository));
  if (
    typeof runStep !== 'function'
    || typeof inspectRepository !== 'function'
  ) {
    fail('KIMI_D9_DESKTOP_BUILD_STEPS_INVALID');
  }

  for (const repository of REPOSITORIES) {
    validateDesktopRepositoryInspection(
      task,
      repository,
      await inspectRepository(repository),
      false,
    );
  }
  const counters = {};
  for (const step of task.desktopBuildSteps) {
    if (Object.hasOwn(counters, step.stepId)) {
      fail('KIMI_D9_DESKTOP_BUILD_STEP_DUPLICATE');
    }
    counters[step.stepId] = 1;
    await runStep(step);
    validateDesktopRepositoryInspection(
      task,
      step.repository,
      await inspectRepository(step.repository),
      true,
    );
  }
  if (
    !hasExactKeys(counters, DESKTOP_BUILD_STEP_IDS)
    || DESKTOP_BUILD_STEP_IDS.some(stepId => counters[stepId] !== 1)
  ) {
    fail('KIMI_D9_DESKTOP_BUILD_STEP_MISSING');
  }
  for (const repository of REPOSITORIES) {
    validateDesktopRepositoryInspection(
      task,
      repository,
      await inspectRepository(repository),
      true,
    );
  }
  return deepFreeze({
    stepCompletionCounters: counters,
  });
}

async function defaultConstructCli(task) {
  return constructCliRuntimeClosure({
    expectedCommit: task.expectedCommit,
    sourceWorktree: task.sourceRoot,
    constructionParent: task.constructionParent,
    nodeDistributionRoot: task.nodeRuntimeInput.distributionRoot,
    guardSourcePath: task.guardInput.sourcePath,
    officialNodeArchive: {
      archivePath: task.nodeRuntimeInput.archivePath,
      expectedIdentity: task.nodeRuntimeInput.archiveIdentity,
      expectedSha256: task.nodeRuntimeInput.archiveSha256,
    },
    expectedNodeDistributionTreeDigest:
      task.nodeRuntimeInput.distributionTreeDigest,
    generatedOutputAllowlist: task.generatedOutputAllowlist,
  });
}

function sameCanonical(left, right) {
  return canonicalize(left) === canonicalize(right);
}

async function defaultFinalizeCli(task, built) {
  const closureRoot = await realpath(built.closurePath);
  const actualComputedEdges =
    await createDarwinArm64ComputedEdgeAllowlist(closureRoot);
  if (
    !sameCanonical(
      actualComputedEdges,
      task.cliGraphInput.computedEdgeAllowlist,
    )
  ) {
    fail('KIMI_D9_FORMAL_BUILD_COMPUTED_EDGE_DRIFT');
  }
  const resolutionGraph = await buildReachableResolutionGraph({
    closureRoot,
    entryRelativePath: 'dist/index.js',
    computedEdgeAllowlist: actualComputedEdges,
  });
  const nodeLaunchProbe = await probeNodeLaunchContract(
    join(closureRoot, 'runtime/node/bin/node'),
  );
  const nodeLaunchContract = {
    ...nodeLaunchProbe,
    officialNodeDistributionArchiveSha256:
      task.nodeRuntimeInput.archiveSha256,
    officialNodeDistributionTreeDigest:
      task.nodeRuntimeInput.distributionTreeDigest,
    execArgv: [
      '--no-global-search-paths',
      '--import',
      task.guardInput.relativePath,
    ],
    defaultExportsConditionSet: ['node', 'import', 'require', 'default'],
    userConditions: [],
    nodeOptions: '',
    nodePath: '',
  };
  const allNativeArtifacts = (await inventoryTree(closureRoot))
    .filter(entry => (
      entry.fileType === 'file'
      && entry.relativePath.endsWith('.node')
    ))
    .map(entry => entry.relativePath);
  const reachableNativeRoots = resolutionGraph.modules
    .filter(path => path.endsWith('.node'));
  const nativeDependencyGraph = await buildNativeDependencyGraph({
    closureRoot,
    nodeExecutable: 'runtime/node/bin/node',
    allNativeArtifacts,
    reachableNativeRoots,
    expectedArch: task.nodeRuntimeInput.arch,
    expectedModulesAbi: task.nodeRuntimeInput.modulesAbi,
    expectedNodeApi: task.nodeRuntimeInput.nodeApi,
    compatibilityByRelativePath:
      task.cliGraphInput.nativeCompatibilityByRelativePath,
  });
  return {
    artifactPath: closureRoot,
    constructionCompletionCount: built.constructionCount,
    closureAttestation: await attestCliRuntimeClosure(closureRoot),
    resolutionGraph,
    nodeLaunchContract,
    nativeDependencyGraph,
    guardTreeDigest: await digestGuardTree(
      join(closureRoot, 'runtime/guard'),
    ),
  };
}

async function defaultConstructDesktop(task) {
  return runDesktopBuildOnce({
    plan: task.desktopBuildPlan,
    ledger: {
      reserve() {
        return {
          artifactPath: task.artifactPath,
          constructionCompletionCount: 1,
        };
      },
    },
  });
}

async function validatePreparedSource(task, prepared) {
  const [expectedSourceRoot, preparedSourceRoot] = await Promise.all([
    realpath(task.sourceRoot).catch(() => null),
    typeof prepared?.sourceRoot === 'string'
      ? realpath(prepared.sourceRoot).catch(() => null)
      : null,
  ]);
  if (
    !isPlainObject(prepared)
    || expectedSourceRoot === null
    || preparedSourceRoot !== expectedSourceRoot
    || prepared.commit !== task.expectedCommit
    || prepared.clean !== true
  ) {
    fail('KIMI_D9_FORMAL_BUILD_SOURCE_PREPARATION_INVALID');
  }
}

function validateConstructionCount(result) {
  if (result?.constructionCompletionCount !== 1) {
    fail('KIMI_D9_FORMAL_BUILD_COUNT_INVALID');
  }
}

function validateResolutionGraph(graph) {
  if (
    !isPlainObject(graph)
    || graph.entryRelativePath !== 'dist/index.js'
    || !Array.isArray(graph.modules)
    || graph.modules.length === 0
    || !graph.modules.includes(graph.entryRelativePath)
    || graph.modules.some(path => (
      !isSafeRelativePath(path)
      || path.includes('.test-dist')
    ))
    || new Set(graph.modules).size !== graph.modules.length
  ) {
    fail('KIMI_D9_FORMAL_BUILD_RESOLUTION_GRAPH_INVALID');
  }
}

function buildCliRuntimeManifest(finalized) {
  validateResolutionGraph(finalized.resolutionGraph);
  if (
    !isPlainObject(finalized.closureAttestation)
    || !isPlainObject(finalized.nodeLaunchContract)
    || !isPlainObject(finalized.nativeDependencyGraph)
    || !isSha256(finalized.guardTreeDigest)
  ) {
    fail('KIMI_D9_FORMAL_BUILD_CLI_PROOF_INVALID');
  }
  const modules = [...finalized.resolutionGraph.modules].sort();
  return {
    schemaVersion: 1,
    artifactKind: 'cli-runtime-closure-v1',
    closureRoot: finalized.artifactPath,
    closureAttestation: finalized.closureAttestation,
    nodeRelativePath: 'runtime/node/bin/node',
    entryRelativePath: 'dist/index.js',
    guardRelativePath: 'runtime/guard/runtime-guard.mjs',
    allowedModuleRelativePaths: modules,
    resolutionGraphDigest: sha256(canonicalize({
      entryRelativePath: 'dist/index.js',
      modules,
    })),
  };
}

export async function runFormalArtifactBuilds({
  plan,
  ledger,
  operations = {},
}) {
  if (
    !isPlainObject(plan)
    || canonicalSha256(plan.preflightPlan) !== plan.preflightPlanHash
    || !hasExactKeys(plan.constructionTasks, D9_ARTIFACT_KEYS)
    || !ledger
  ) {
    fail('KIMI_D9_FORMAL_BUILD_PLAN_INVALID');
  }
  const prepareSource = operations.prepareSource ?? defaultPrepareSource;
  const constructCli = operations.constructCli ?? defaultConstructCli;
  const finalizeCli = operations.finalizeCli ?? defaultFinalizeCli;
  const constructDesktop =
    operations.constructDesktop ?? defaultConstructDesktop;
  for (const operation of [
    prepareSource,
    constructCli,
    finalizeCli,
    constructDesktop,
  ]) {
    if (typeof operation !== 'function') {
      fail('KIMI_D9_FORMAL_BUILD_OPERATION_INVALID');
    }
  }

  const artifacts = {};
  const cliRuntimeManifests = {};
  const cliArtifactProofs = {};
  for (const artifactKey of D9_ARTIFACT_KEYS) {
    const task = plan.constructionTasks[artifactKey];
    ledger.reserve(artifactKey);
    const prepared = await prepareSource(task);
    await validatePreparedSource(task, prepared);

    let built;
    if (task.surface === 'cli') {
      built = await constructCli(task);
      validateConstructionCount(built);
      const finalized = await finalizeCli(task, built);
      validateConstructionCount(finalized);
      const resolvedArtifactPath = await realpath(
        finalized.artifactPath,
      ).catch(() => fail('KIMI_D9_FORMAL_BUILD_ARTIFACT_MISSING'));
      const resolvedConstructionParent = await realpath(
        task.constructionParent,
      ).catch(() => fail('KIMI_D9_FORMAL_BUILD_ARTIFACT_MISSING'));
      if (!isWithin(resolvedConstructionParent, resolvedArtifactPath)) {
        fail('KIMI_D9_FORMAL_BUILD_ARTIFACT_PATH_INVALID');
      }
      finalized.artifactPath = resolvedArtifactPath;
      const cliManifest = buildCliRuntimeManifest(finalized);
      cliRuntimeManifests[task.arm] = cliManifest;
      cliArtifactProofs[task.arm] = {
        computedEdgeAllowlist: task.cliGraphInput.computedEdgeAllowlist,
        resolutionGraph: finalized.resolutionGraph,
        nodeLaunchContract: finalized.nodeLaunchContract,
        nativeDependencyGraph: finalized.nativeDependencyGraph,
        guardTreeDigest: finalized.guardTreeDigest,
        closureAttestation: finalized.closureAttestation,
      };
      built = finalized;
    } else {
      built = await constructDesktop(task);
      validateConstructionCount(built);
      const resolvedArtifactPath = await realpath(
        built.artifactPath,
      ).catch(() => fail('KIMI_D9_FORMAL_BUILD_ARTIFACT_MISSING'));
      const expectedArtifactPath = await realpath(
        task.artifactPath,
      ).catch(() => fail('KIMI_D9_FORMAL_BUILD_ARTIFACT_MISSING'));
      if (
        resolvedArtifactPath !== expectedArtifactPath
      ) {
        fail('KIMI_D9_FORMAL_BUILD_ARTIFACT_PATH_INVALID');
      }
      built.artifactPath = resolvedArtifactPath;
    }

    const artifactPath = built.artifactPath;
    artifacts[artifactKey] = {
      artifactPath,
      physicalIdentity: await capturePhysicalIdentity(artifactPath),
      digest: (await digestArtifactTree(artifactPath)).digest,
    };
  }

  const constructionCompletionCounters = ledger.snapshot();
  if (
    D9_ARTIFACT_KEYS.some(
      key => constructionCompletionCounters[key] !== 1,
    )
  ) {
    fail('KIMI_D9_FORMAL_BUILD_COUNT_INVALID');
  }
  const artifactDigests = Object.fromEntries(
    D9_ARTIFACT_KEYS.map(key => [key, artifacts[key].digest]),
  );
  const preflightArtifactAttestation = deepFreeze(canonicalClone({
    schemaVersion: 1,
    preflightPlanHash: plan.preflightPlanHash,
    artifactDigestAlgorithm: D9_ARTIFACT_DIGEST_ALGORITHM,
    artifacts,
    constructionCompletionCounters,
  }));
  return deepFreeze({
    preflightPlan: plan.preflightPlan,
    preflightPlanHash: plan.preflightPlanHash,
    artifacts,
    artifactDigests,
    constructionCompletionCounters,
    cliRuntimeManifests,
    cliArtifactProofs,
    preflightArtifactAttestation,
  });
}

export async function freezeFormalArtifactAttestation({
  attestationPath,
  buildResult,
}) {
  if (
    !isAbsolute(attestationPath)
    || !isPlainObject(buildResult?.preflightArtifactAttestation)
  ) {
    fail('KIMI_D9_FORMAL_BUILD_ATTESTATION_INPUT_INVALID');
  }
  return createImmutableArtifactAttestation(
    attestationPath,
    buildResult.preflightArtifactAttestation,
  );
}

export function buildFormalFrozenManifest({
  plan,
  buildResult,
  preflightArtifactAttestationHash,
  manifestInput,
}) {
  if (
    canonicalSha256(plan.preflightPlan) !== plan.preflightPlanHash
    || buildResult.preflightPlanHash !== plan.preflightPlanHash
    || !isSha256(preflightArtifactAttestationHash)
    || !isPlainObject(manifestInput)
    || Object.hasOwn(manifestInput, 'preflightPlan')
    || Object.hasOwn(manifestInput, 'preflightArtifactAttestation')
    || Object.hasOwn(manifestInput, 'artifactDigests')
  ) {
    fail('KIMI_D9_FORMAL_BUILD_MANIFEST_INPUT_INVALID');
  }
  return buildFrozenManifest({
    ...manifestInput,
    preflightPlan: plan.preflightPlan,
    preflightPlanHash: plan.preflightPlanHash,
    preflightArtifactAttestation:
      buildResult.preflightArtifactAttestation,
    preflightArtifactAttestationHash,
    artifactDigests: buildResult.artifactDigests,
  });
}
