import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(repo, 'package.json'));
test(
  'original OS Source accepts no caller PID, DTO, or copied SDK association',
  {
    skip: process.platform !== 'darwin',
    timeout: 20000,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-os-source-member-'));
    mkdirSync(join(root, 'config'), { mode: 0o700 });
    process.env.XIAOK_CONFIG_DIR = join(root, 'config');
    const output = join(
      repo,
      'native/original-process-domain/build/Release/original_process_domain.node',
    );
    const built = spawnSync(
      process.execPath,
      [
        join(repo, 'native/original-process-domain/build-observation.mjs'),
        process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,
        output,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const { tsImport } = require('tsx/esm/api');
    const api = await tsImport(
      join(repo, 'src/runtime/verification/original-local-process-domain.ts'),
      import.meta.url,
    );
    const pending = api.openOriginalLocalProcessDomain();
    assert.equal(api.openOriginalLocalProcessDomain(), pending);
    const domain = await pending;
    assert.equal(
      api.readOriginalLocalProcessDomain(domain).observerPid,
      process.pid,
    );
    let traps = 0;
    const trap = () => {
      traps++;
      throw Error('foreign');
    };
    const foreign = new Proxy(
      {},
      { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap },
    );
    await assert.rejects(
      api.observeOriginalLocalProcessAttempt(domain, foreign),
    );
    await assert.rejects(
      api.observeOriginalLocalProcessAttempt(domain, {
        pid: process.pid,
        nativeMetered: true,
      }),
    );
    assert.throws(() => api.readOriginalLocalProcessDomain(foreign));
    assert.throws(() => api.readOriginalLocalProcessDomain({ ...domain }));
    assert.throws(() =>
      api.readOriginalLocalProcessObservation(domain, foreign),
    );
    assert.equal(traps, 0);
    api.fenceOriginalLocalProcessDomain(domain);
    await assert.rejects(
      api.observeOriginalLocalProcessAttempt(domain, foreign),
    );
    assert.equal(
      api.readOriginalLocalProcessDomain(domain).observerPid,
      process.pid,
    );
    await api.closeOriginalLocalProcessDomain(domain);
    console.log(
      JSON.stringify({
        root,
        actualKernel: true,
        ownPid: process.pid,
        traps,
        noTerminalGrant: true,
      }),
    );
  },
);
