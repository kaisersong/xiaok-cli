import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  require = createRequire(join(repo, 'package.json'));
for (const mode of ['process'])
  test(
    'actual original Main process association supplies OS facts without releasing P through ' +
      mode,
    { skip: process.platform !== 'darwin', timeout: 90000 },
    async () => {
      const root = mkdtempSync(
          join(tmpdir(), 'xiaok-native-process-composition-'),
        ),
        domain = join(root, 'domain'),
        addon = join(root, 'root_resource_authority_main.node'),
        bundle = join(root, 'component.mjs');
      mkdirSync(domain);
      const osAddon = join(root, 'original_process_domain.node');
      const osBuild = spawnSync(
        process.execPath,
        [
          join(repo, 'native/original-process-domain/build-observation.mjs'),
          process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,
          osAddon,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(osBuild.status, 0, osBuild.stderr || osBuild.stdout);
      const entry = join(root, 'os-entry.ts');
      writeFileSync(
        entry,
        'export * from ' +
          JSON.stringify(
            join(
              repo,
              'tests/native/fixtures/original-process-composition-entry.ts',
            ),
          ) +
          ';\nexport * from ' +
          JSON.stringify(
            join(
              repo,
              'src/runtime/verification/original-local-process-domain.ts',
            ),
          ) +
          ';\n',
      );
      const originalFixture = readFileSync(
        join(repo, 'tests/native/fixtures/original-process-composition.cjs'),
        'utf8',
      );
      let fixture = originalFixture.replace(
        'process.stdout.write("actual-owned-process");',
        'setTimeout(()=>process.stdout.write("actual-owned-process"),500); setTimeout(()=>{},1000);',
      );
      const associationPoint = '                    let closeDone;';
      assert.equal(fixture.split(associationPoint).length, 2);
      fixture = fixture.replace(
        associationPoint,
        `
                    const osDomain = await api.openOriginalLocalProcessDomain();
                    const osObserved = await api.observeOriginalLocalProcessAttempt(osDomain, attempt.attempt);
                    const osFact = api.readOriginalLocalProcessObservation(osDomain, osObserved);
                    assert.equal(osFact.os.observedPid, attempt.handle.pid);
                    assert.match(osFact.specHash, /^[a-f0-9]{64}$/);
                    api.assertOriginalLocalProcessObservationCurrent(osDomain, osObserved);
                    fs.writeFileSync(path.join(domain, 'os-domain-fact.json'), JSON.stringify({osFact, notTerminal:true}));
                    let closeDone;`,
      );
      const closedPoint =
        '                        assert.equal(childClosed, true);';
      assert.equal(fixture.split(closedPoint).length, 2);
      fixture = fixture.replace(
        closedPoint,
        `
                        assert.throws(()=>api.assertOriginalLocalProcessObservationCurrent(osDomain, osObserved), /UNCONFIRMED/);
                        assert.deepEqual(api.readOriginalLocalProcessObservation(osDomain, osObserved), osFact);
                        await api.closeOriginalLocalProcessDomain(osDomain);
                        assert.equal(childClosed, true);`,
      );
      assert.notEqual(fixture, originalFixture);
      const actualFixture = join(root, 'original-process-os-fact.cjs');
      writeFileSync(actualFixture, fixture);
      const build = spawnSync(
        process.execPath,
        [
          join(repo, 'native/root-resource-authority/build-main-session.mjs'),
          process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS,
          addon,
          domain,
          'embedded',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(build.status, 0, build.stderr || build.stdout);
      await require('esbuild').build({
        entryPoints: [entry],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        plugins: [
          {
            name: 'fixed-os-addon-packaging-location',
            setup(build) {
              build.onLoad(
                { filter: /original-local-process-domain\.ts$/ },
                async (args) => {
                  const source = readFileSync(args.path, 'utf8');
                  const start = source.indexOf(
                      'const addonPath = fileURLToPath(',
                    ),
                    end = source.indexOf('const apply =', start);
                  assert.ok(start >= 0 && end > start);
                  return {
                    contents:
                      source.slice(0, start) +
                      'const addonPath = ' +
                      JSON.stringify(osAddon) +
                      ';\n' +
                      source.slice(end),
                    loader: 'ts',
                    resolveDir: dirname(args.path),
                  };
                },
              );
            },
          },
        ],
        banner: {
          js: "import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);",
        },
      });
      if (mode === 'protection' || mode === 'delivery')
        for (const worker of [
          'delivery-verifier-worker',
          'protection-read-worker',
        ])
          await require('esbuild').build({
            entryPoints: [join(repo, 'src/runtime/task-host', worker + '.ts')],
            outfile: join(root, worker + '.js'),
            bundle: true,
            platform: 'node',
            format: 'esm',
            packages: 'external',
            banner: {
              js: "import {createRequire as fixtureRequire} from 'node:module'; const require=fixtureRequire(import.meta.url);",
            },
          });
      writeFileSync(
        join(root, 'glob-worker.mjs'),
        readFileSync(join(repo, 'src/ai/tools/glob-worker.mjs')),
      );
      writeFileSync(
        join(root, 'search-scope.mjs'),
        readFileSync(join(repo, 'src/ai/tools/search-scope.mjs')),
      );
      symlinkSync(
        join(repo, 'desktop/node_modules'),
        join(root, 'node_modules'),
      );
      const electron = await getNativeTestElectronExecutable(repo),
        result = join(root, 'facts.json'),
        env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.ELECTRON_RUN_AS_NODE;
      const args = [
        actualFixture,
        bundle,
        domain,
        result,
        join(root, 'userData'),
        resolve(repo, '../intent-broker/src/broker/service.js'),
        resolve(repo, '../intent-broker/src/http/server.js'),
        mode,
      ];
      const child = spawn(electron, args, {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
        row = {
          pid: child.pid,
          argv: [electron, ...args],
          signals: [],
          stdout: '',
          stderr: '',
        };
      row.birth = spawnSync('ps', ['-p', String(child.pid), '-o', 'lstart='], {
        encoding: 'utf8',
      }).stdout.trim();
      writeFileSync(join(root, 'birth.json'), JSON.stringify(row, null, 2));
      child.stdout.on('data', (v) => {
        row.stdout += v;
      });
      child.stderr.on('data', (v) => {
        row.stderr += v;
      });
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          row.signals.push('SIGTERM');
          child.kill('SIGTERM');
        }
      }, 45000);
      try {
        await new Promise((yes, no) => {
          child.once('error', no);
          child.once('close', (code, signal) => {
            row.code = code;
            row.signal = signal;
            row.reaped = true;
            yes();
          });
        });
      } finally {
        clearTimeout(timer);
        writeFileSync(join(root, 'run.json'), JSON.stringify(row, null, 2));
      }
      console.log(JSON.stringify({ root, ...row }));
      assert.equal(row.code, 0, row.stderr);
      assert.deepEqual(row.signals, []);
      const os = JSON.parse(
        readFileSync(join(domain, 'os-domain-fact.json'), 'utf8'),
      );
      assert.equal(os.notTerminal, true);
      assert.ok(os.osFact.os.observedPid > 0);
      const facts = JSON.parse(readFileSync(result, 'utf8'));
      assert.equal(facts.pid, child.pid);
      assert.equal(facts.ok, true, JSON.stringify(facts));
    },
  );
