import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const SHA = 'ab'.repeat(32);
const COMMIT = '1'.repeat(40);

function runEvalModule(
  name: string,
  source: string,
  input: unknown,
): any {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    '..',
    'scripts/evals/kimi-k3-d9',
    name,
  )).href;
  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      `import * as subject from ${JSON.stringify(moduleUrl)};`,
      'const input = JSON.parse(process.env.KIMI_D9_SYNTHETIC_INPUT);',
      source,
    ].join('\n'),
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KIMI_D9_SYNTHETIC_INPUT: JSON.stringify(input),
    },
  });
  return JSON.parse(output.trim());
}

function sourceEntry(commit = COMMIT) {
  return {
    repositoryIdentity: 'github.com/kaisersong/example.git',
    commit,
    clean: true,
    statusByteCount: 0,
    lockfileDigest: SHA,
    generatedOutputDigest: SHA,
    packedInputTreeDigest: SHA,
  };
}

function sourceCommitMap() {
  return {
    'xiaok-cli': sourceEntry(),
    kswarm: sourceEntry('2'.repeat(40)),
    'intent-broker': sourceEntry('3'.repeat(40)),
    'kai-xiaok-plugins': sourceEntry('4'.repeat(40)),
  };
}

describe('Kimi K3 D9 packaged Desktop contract', () => {
  it('constructs only one unsigned packaged app from a detached sibling layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-desktop-build-'));
    try {
      const layoutRoot = join(root, 'layout');
      const outputRoot = join(root, 'artifacts', 'candidate');
      const artifactPath = join(outputRoot, 'mac-arm64', 'xiaok.app');
      const map = sourceCommitMap();
      const result = runEvalModule('desktop-build.mjs', `
        const plan = subject.createDesktopBuildPlan(input.planInput);
        const paired = subject.validatePairedDesktopSourceCommitMaps(
          input.map,
          { ...input.map, 'xiaok-cli': input.otherXiaok },
        );
        const ledger = subject.createDesktopBuildLedger();
        const reservation = ledger.reserve(plan);
        let secondError = '';
        try { ledger.reserve(plan); } catch (error) { secondError = error.message; }
        console.log(JSON.stringify({
          plan,
          paired,
          reservation,
          secondError,
          sourceEntryFrozen: Object.isFrozen(plan.sourceCommitMap.kswarm),
        }));
      `, {
        planInput: {
          arm: 'candidate',
          layoutRoot,
          xiaokCliRoot: join(layoutRoot, 'xiaok-cli'),
          artifactPath,
          sourceCommitMap: map,
        },
        map,
        otherXiaok: sourceEntry('5'.repeat(40)),
      });
      const { plan } = result;

      expect(plan.artifactPath).toBe(artifactPath);
      expect(plan.executablePath).toBe(join(
        artifactPath,
        'Contents',
        'MacOS',
        'xiaok',
      ));
      expect(plan.packagingCwd).toBe(join(layoutRoot, 'xiaok-cli', 'desktop'));
      expect(plan.outputRoot).toBe(outputRoot);
      expect(plan.command.args).toContain('--dir');
      expect(plan.command.args).toContain('-c.mac.identity=null');
      expect(plan.command.args).toContain(
        `-c.directories.output=${outputRoot}`,
      );
      expect(plan.command.env.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false');
      expect(result.sourceEntryFrozen).toBe(true);
      expect(JSON.stringify(plan)).not.toContain('/Users/song/projects/kswarm');
      expect(result.paired).toBe(true);
      expect(result.reservation).toMatchObject({
        artifactPath,
        constructionCompletionCount: 1,
      });
      expect(result.secondError).toBe(
        'KIMI_D9_DESKTOP_ARTIFACT_ALREADY_CONSTRUCTED',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects sibling provenance drift and current sibling workspace inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-desktop-provenance-'));
    try {
      const baseline = sourceCommitMap();
      const candidate = structuredClone(baseline);
      candidate.kswarm.packedInputTreeDigest = 'ff'.repeat(32);
      const result = runEvalModule('desktop-build.mjs', `
        let mismatchError = '';
        let layoutError = '';
        try {
          subject.validatePairedDesktopSourceCommitMaps(
            input.baseline,
            input.candidate,
          );
        } catch (error) { mismatchError = error.message; }
        try {
          subject.createDesktopBuildPlan(input.invalidPlan);
        } catch (error) { layoutError = error.message; }
        console.log(JSON.stringify({ mismatchError, layoutError }));
      `, {
        baseline,
        candidate,
        invalidPlan: {
          arm: 'candidate',
          layoutRoot: join(root, 'layout'),
          xiaokCliRoot: '/Users/song/projects/xiaok-cli',
          artifactPath: join(root, 'xiaok.app'),
          sourceCommitMap: baseline,
        },
      });
      expect(result.mismatchError).toBe(
        'KIMI_D9_DESKTOP_SIBLING_PROVENANCE_MISMATCH',
      );
      expect(result.layoutError).toBe('KIMI_D9_DESKTOP_BUILD_LAYOUT_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allocates fresh session roots and a unique loopback CDP port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-desktop-session-'));
    try {
      const artifactPath = join(root, 'xiaok.app');
      const result = runEvalModule('desktop-driver.mjs', `
        const { stat } = await import('node:fs/promises');
        const first = await subject.materializeFreshDesktopSession(input.first);
        const second = await subject.materializeFreshDesktopSession(input.second);
        const modes = {};
        for (const key of [
          'userData',
          'home',
          'config',
          'temp',
          'workspace',
          'logs',
          'crash',
          'taskRoot',
        ]) {
          modes[key] = (await stat(first[key])).mode & 0o777;
        }
        let reusedPortError = '';
        try {
          await subject.materializeFreshDesktopSession(input.reusedPort);
        } catch (error) { reusedPortError = error.message; }
        const launch = subject.createDesktopProductLaunch({
          ...input.launch,
          session: first,
        });
        console.log(JSON.stringify({
          first,
          second,
          modes,
          reusedPortError,
          launch,
        }));
      `, {
        first: {
          runRoot: root,
          sessionId: 'session-a',
          debuggingPort: 19331,
        },
        second: {
          runRoot: root,
          sessionId: 'session-b',
          debuggingPort: 19332,
        },
        reusedPort: {
          runRoot: root,
          sessionId: 'session-c',
          debuggingPort: 19331,
        },
        launch: {
          artifactPath,
          artifactDigest: SHA,
          sourceCommitMap: sourceCommitMap(),
          preservedThinking: true,
        },
      });
      const { first, second, launch } = result;
      for (const key of [
        'userData',
        'home',
        'config',
        'temp',
        'workspace',
        'logs',
        'crash',
        'taskRoot',
      ]) {
        expect(first[key]).not.toBe(second[key]);
      }
      expect(first.debuggingPort).not.toBe(second.debuggingPort);
      expect(Object.values(result.modes)).toEqual(Array(8).fill(0o700));
      expect(result.reusedPortError).toBe(
        'KIMI_D9_DESKTOP_SESSION_LAYOUT_INVALID',
      );

      expect(launch.command).toBe(join(
        artifactPath,
        'Contents',
        'MacOS',
        'xiaok',
      ));
      expect(launch.args).toContain('--remote-debugging-address=127.0.0.1');
      expect(launch.args).toContain('--remote-debugging-port=19331');
      expect(launch.args).toContain(`--user-data-dir=${first.userData}`);
      expect(launch.env.HOME).toBe(first.home);
      expect(launch.env.XIAOK_CONFIG_DIR).toBe(first.config);
      expect(launch.env.TMPDIR).toBe(first.temp);
      expect(launch.env.XIAOK_EXPERIMENTAL_KIMI_PROMPT_CACHE).toBe('0');
      expect(launch.env.XIAOK_EXPERIMENTAL_KIMI_PRESERVED_THINKING).toBe('1');
      expect(Object.keys(launch.env)).not.toContain('GITHUB_TOKEN');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['artifact', { runningArtifactDigest: 'ff'.repeat(32) }],
    ['selector', { runningSelectorContractDigest: 'ee'.repeat(32) }],
    ['sourceCommitMap', {
      runningSourceCommitMap: {
        ...sourceCommitMap(),
        kswarm: sourceEntry('9'.repeat(40)),
      },
    }],
  ])('fails closed on %s drift before all three side effects', async (
    _kind,
    drift,
  ) => {
    const map = sourceCommitMap();
    const result = runEvalModule('desktop-driver.mjs', `
      const counters = subject.createDesktopSideEffectCounters();
      let error = '';
      try {
        subject.verifyDesktopSessionStart({ ...input.contract, counters });
      } catch (caught) { error = caught.message; }
      console.log(JSON.stringify({ error, counters: counters.snapshot() }));
    `, {
      contract: {
        frozenArtifactDigest: SHA,
        runningArtifactDigest: SHA,
        frozenSelectorContractDigest: SHA,
        runningSelectorContractDigest: SHA,
        frozenSourceCommitMap: map,
        runningSourceCommitMap: map,
        ...drift,
      },
    });
    expect(result.error).toBe('KIMI_D9_DESKTOP_SESSION_START_REJECTED');
    expect(result.counters).toEqual({
      networkRequest: 0,
      fixtureMcpInvocation: 0,
      evidenceWrite: 0,
    });
  });

  it('does not import source renderer, product owners, or packaged smoke owners', () => {
    const scriptsRoot = join(
      process.cwd(),
      '..',
      'scripts/evals/kimi-k3-d9',
    );
    const source = [
      'desktop-build.mjs',
      'desktop-driver.mjs',
      'playwright-driver.mjs',
    ].map(name => readFileSync(join(scriptsRoot, name), 'utf8')).join('\n');
    for (const forbidden of [
      'desktop/renderer/src',
      'runDesktopToolLoop',
      'ai/adapters',
      'provider-conversation-authorization',
      'electron/kimi-packaged-smoke',
      '.test-dist',
      'fake-sdk',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
