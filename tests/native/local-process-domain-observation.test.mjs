import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
test(
  'actual local OS domain birth and irreversible fence are observations only',
  {
    skip: process.platform !== 'darwin',
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-local-os-observation-'));
    mkdirSync(join(root, 'config'), { mode: 0o700 });
    process.env.XIAOK_CONFIG_DIR = join(root, 'config');
    const output = join(root, 'original_process_domain.node');
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
    const api = createRequire(import.meta.url)(output);
    const domain = api.openOriginal();
    assert.equal(
      api.openOriginal(),
      domain,
      'same environment has one birth slot',
    );
    const self = api.readSelf(domain);
    assert.equal(self.kind, 'original_local_os_self_observation_v1');
    assert.equal(self.observerPid, process.pid);
    assert.match(self.hostBootIdentity, /^[A-Fa-f0-9-]{36}$/);
    assert.equal(Object.hasOwn(self, 'terminal'), false);
    assert.equal(Object.hasOwn(self, 'known'), false);
    assert.equal(Object.hasOwn(self, 'quiescent'), false);
    let inheritedSetters = 0;
    const originalKind = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'kind',
    );
    let underHook;
    Object.defineProperty(Object.prototype, 'kind', {
      configurable: true,
      set() {
        inheritedSetters++;
      },
    });
    try {
      underHook = api.readSelf(domain);
    } finally {
      if (originalKind)
        Object.defineProperty(Object.prototype, 'kind', originalKind);
      else delete Object.prototype.kind;
    }
    assert.equal(
      inheritedSetters,
      0,
      'Native data projection must never call a public prototype setter',
    );
    assert.equal(underHook.kind, self.kind);
    let getters = 0;
    const trap = () => {
      getters++;
      throw Error('foreign');
    };
    const foreign = new Proxy(
      {},
      { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap },
    );
    assert.throws(() => api.readSelf(foreign));
    assert.throws(() => api.readSelf({ ...domain }));
    assert.equal(getters, 0);
    // Low-level Native tests only: production association must supply PID from
    // the original private SDK member, not accept these numeric lookup inputs.
    const observed = api.observePid(domain, process.pid);
    const historical = api.readObservation(domain, observed);
    assert.equal(historical.identityBinding, 'pid_sample_only');
    assert.equal(historical.observedPid, process.pid);
    assert.deepEqual(historical.observedBirth, self.observerBirth);
    api.assertObservationCurrent(domain, observed);
    for (const invalid of [NaN, Infinity, -Infinity, 0.5, 0]) {
      assert.throws(() => api.observePid(domain, invalid), /PID_INVALID/);
    }
    api.assertObservationCurrent(domain, observed);
    assert.throws(() => api.readObservation(domain, { ...observed }));
    assert.throws(() => api.readObservation(domain, foreign));
    assert.equal(getters, 0);
    const before = api.readFence(domain);
    api.fence(domain);
    const after = api.readFence(domain);
    assert.equal(after.epoch, before.epoch + 1);
    assert.equal(after.fenced, true);
    assert.throws(() => api.openOriginal(), /FENCED/);
    assert.throws(() => api.observePid(domain, process.pid), /FENCED/);
    assert.throws(
      () => api.assertObservationCurrent(domain, observed),
      /FENCED/,
    );
    assert.deepEqual(api.readObservation(domain, observed), historical);
    assert.equal(
      api.readSelf(domain).domainId,
      self.domainId,
      'historic metadata survives fence',
    );
    api.close(domain);
    assert.throws(() => api.openOriginal());
    writeFileSync(
      join(root, 'facts.json'),
      JSON.stringify(
        {
          self,
          historical,
          before,
          after,
          noTerminalApi: typeof api.finish === 'undefined',
          notNativeAuthorization: true,
          observedPid: process.pid,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        root,
        ownPid: process.pid,
        notNativeAuthorization: true,
      }),
    );
  },
);
