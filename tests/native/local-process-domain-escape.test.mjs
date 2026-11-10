import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(repo, 'package.json'));
const pause = (milliseconds) =>
  new Promise((done) => setTimeout(done, milliseconds));

test(
  'actual original discussion adapter never calls escaped descendant released',
  {
    skip: process.platform !== 'darwin',
    timeout: 20000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-original-domain-escape-'));
    const config = join(root, 'config');
    mkdirSync(config, { mode: 0o700 });
    // Set before any product import. No HOME or global user config change.
    process.env.XIAOK_CONFIG_DIR = config;
    const bundle = join(root, 'adapter.mjs');
    await require('esbuild').build({
      entryPoints: [
        join(repo, 'desktop/electron/room-external-discussion-adapter.ts'),
      ],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
    });
    const { createRoomExternalDiscussionAdapter } = await import(
      pathToFileURL(bundle).href
    );
    const adapter = createRoomExternalDiscussionAdapter({
      profiles: {
        xiaok: {
          executable: process.execPath,
          argsPrefix: [
            join(
              repo,
              'tests/native/fixtures/process-domain-escape-profile.cjs',
            ),
          ],
        },
      },
      temporaryRoot: root,
    });
    const receipt = join(root, 'own-descendant.json');
    const nonce = `own-domain-${randomUUID()}`;
    let child,
      exited,
      result,
      liveAfterResult = false,
      cleaned = false;
    const started = [];
    function actualBirth(pid) {
      return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
    }
    function exists(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    }
    try {
      result = await adapter.execute({
        runtime: 'xiaok',
        operationId: nonce,
        prompt: JSON.stringify({ receipt, nonce }),
        signal: new AbortController().signal,
        onPrepared: async () => {},
        onStarted: async (row) => {
          started.push(row);
        },
        onExited: async (row) => {
          exited = row;
        },
      });
      child = JSON.parse(readFileSync(receipt, 'utf8'));
      assert.equal(child.nonce, nonce);
      assert.equal(actualBirth(child.pid), child.birth);
      liveAfterResult = exists(child.pid);
    } finally {
      if (!child) {
        try {
          child = JSON.parse(readFileSync(receipt, 'utf8'));
        } catch {}
      }
      if (child && exists(child.pid)) {
        // Exact own recorded birth + nonce is checked before cleanup. Never a name kill.
        assert.equal(child.nonce, nonce);
        assert.equal(actualBirth(child.pid), child.birth);
        const command = execFileSync(
          '/bin/ps',
          ['-o', 'command=', '-p', String(child.pid)],
          {
            encoding: 'utf8',
          },
        );
        assert.ok(command.includes(nonce));
        process.kill(child.pid, 'SIGTERM');
        for (let i = 0; i < 100 && exists(child.pid); i++) await pause(10);
        cleaned = !exists(child.pid);
      } else cleaned = true;
      const evidence = {
        root,
        currentPid: process.pid,
        child,
        started,
        exited,
        result,
        liveAfterResult,
        cleaned,
        notNativeAuthorization: true,
      };
      writeFileSync(
        join(root, 'facts.json'),
        JSON.stringify(evidence, null, 2),
      );
      console.log(JSON.stringify(evidence));
      assert.equal(
        cleaned,
        true,
        'own escaped child must be reclaimed even on red',
      );
    }
    assert.equal(result.text, 'Actual local profile completed.');
    assert.equal(
      liveAfterResult,
      true,
      'this regression must actually create a live escape',
    );
    assert.equal(
      result.resourcesReleased === true || exited?.groupExitVerified === true,
      false,
      'parent/group exit cannot certify the actual detached descendant terminal',
    );
  },
);
