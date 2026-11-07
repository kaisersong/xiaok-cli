import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, lstatSync, symlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {prepareMainInstalledFixture} from './helpers/main-installed-fixture.mjs';
import {getProtectedNmpSqlFixtureAssets} from './helpers/protected-nmp-sql-assets.mjs';
import {buildMainProtectedSqliteFixture} from './helpers/main-protected-sqlite-fixture.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
test('actual Main restores protected admission and budget databases with the same Core and Root NMP SQL',
  {skip: process.platform !== 'darwin', timeout: 90000}, async () => {
    // Two serial, zero-window Main births. This verifies SQL/lifecycle only;
    // it does not certify SDK execution, containment or production genesis.
    const sources = {};
    for (const directory of ['native/root-resource-authority', 'native/main-installation'])
      for (const name of readdirSync(join(repo, directory))) {
        const file = join(directory, name);
        if (/\.(?:c|cc|h|mjs|json)$/.test(name) && lstatSync(join(repo, file)).isFile())
          sources[file] = hash(join(repo, file));
      }
    for (const file of ['tests/native/fixtures/main-installed-root-pool.cjs',
      'tests/native/fixtures/main-installed-root-pool-entry.ts',
      'tests/native/fixtures/protected-nmp-sql-fragment.cjs',
      'tests/native/helpers/protected-nmp-sql-assets.mjs']) sources[file] = hash(join(repo, file));
    const prepared = await prepareMainInstalledFixture(repo, process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS, {authorityFamilies: true});
    const {root} = prepared, bundle = join(root, 'core-pool.mjs');
    const built = await createRequire(import.meta.url)('esbuild').build({
      entryPoints: [join(repo, 'tests/native/fixtures/main-installed-root-pool-entry.ts')],
      outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', metafile: true,
      banner: {js: "import {createRequire as fixtureRequire} from 'node:module';const require=fixtureRequire(import.meta.url);"},
    });
    const bundleSources = Object.fromEntries(Object.keys(built.metafile.inputs)
      .filter(file => !file.startsWith('<')).map(file => [resolve(repo, file), hash(resolve(repo, file))]));
    symlinkSync(join(repo, 'desktop/node_modules'), join(root, 'node_modules'));
    writeFileSync(prepared.entry, `require(${JSON.stringify(join(repo, 'tests/native/fixtures/main-installed-root-pool.cjs'))})(${JSON.stringify({root, bundle})});\n`);
    const finite = join(root, 'nmp-finite.h');
    writeFileSync(finite, getProtectedNmpSqlFixtureAssets().finiteHeader);
    const args = [join(repo, 'native/root-resource-authority/build-main-session.mjs'),
      prepared.builds[1].args[1], prepared.embedded, prepared.nativeRoot, 'embedded', finite, prepared.configuration];
    const compiled = spawnSync(process.execPath, args, {cwd: repo, encoding: 'utf8'});
    writeFileSync(join(root, 'core-build.json'), JSON.stringify({pid: compiled.pid, args,
      code: compiled.status, signal: compiled.signal, stderr: compiled.stderr}, null, 2));
    assert.equal(compiled.status, 0, compiled.stderr);
    const facade = buildMainProtectedSqliteFixture(repo, prepared.builds[1].args[1],
      join(root, 'protected_sqlite.node'), prepared.configuration, {electronExecutable: prepared.executable});
    const artifacts = Object.fromEntries([prepared.helper, prepared.embedded, prepared.standalone,
      prepared.entry, prepared.configuration, bundle, finite].map(file => [file, hash(file)]));
    Object.assign(artifacts, facade.artifacts);
    const check = () => {
      for (const [file, digest] of Object.entries(sources)) assert.equal(hash(join(repo, file)), digest, file);
      for (const [file, digest] of Object.entries({...bundleSources, ...artifacts})) assert.equal(hash(file), digest, file);
      for (const [file, digest] of Object.entries(facade.sources)) assert.equal(hash(file), digest, file);
    };
    writeFileSync(join(root, 'core-source-hashes.json'), JSON.stringify({sources, bundleSources, artifacts}, null, 2));
    const results = [];
    for (const phase of ['fresh', 'restored']) {
      check();
      const child = spawn(prepared.helper, [], {cwd: root,
        env: {PATH: '/usr/bin:/bin', LC_ALL: 'C'}, stdio: ['pipe', 'pipe', 'pipe']});
      const row = {phase, helperPid: child.pid, stdout: '', stderr: '', signals: [], reaped: false};
      results.push(row);
      const save = () => writeFileSync(join(root, 'core-runs.json'), JSON.stringify(results, null, 2));
      save();
      let released = false;
      child.stdout.on('data', value => {
        row.stdout += value;
        if (!released && row.stdout.includes('"kind":"original-main-installed-ready"')) {
          released = true; child.stdin.end('STOP\n');
        }
      });
      child.stderr.on('data', value => {row.stderr += value;});
      const closed = new Promise((yes, no) => {
        child.once('error', no);
        child.once('close', (code, signal) => {Object.assign(row, {code, signal, reaped: true}); yes();});
      });
      const timer = setTimeout(() => {row.signals.push('SIGTERM'); child.kill('SIGTERM');}, 25000);
      try { await closed; }
      finally {
        clearTimeout(timer);
        if (!row.reaped) {row.signals.push('SIGTERM'); child.kill('SIGTERM'); await closed;}
        save();
      }
      assert.equal(row.code, 0, row.stdout + row.stderr);
      assert.equal(row.signal, null); assert.deepEqual(row.signals, []);
      const records = row.stdout.split('\n').filter(v => v.startsWith('{')).map(v => JSON.parse(v));
      assert.equal(records.filter(v => v.event === 'spawn').length, 1);
      const facts = records.find(v => v.kind === 'original-main-installed-root-pool');
      assert.ok(facts); assert.equal(facts.failed, false); assert.equal(facts.bootstrap, phase);
      for (const key of ['coreStartedBeforeStore', 'protectedAdmission', 'protectedBudgetRuntime', 'budgetDisposed', 'ownerReturned', 'sameLease', 'closed']) assert.equal(facts[key], true, key);
      assert.equal(facts.legacyGroupsDatabaseCreated, false);
      assert.equal(facts.legacyBudgetDatabaseCreated, false);
      assert.equal(facts.windows, 0); assert.equal(facts.dockVisible, false);
      assert.equal(facts.productionQualified, false);
      assert.equal(facts.nmpSql.sqlProtocolOnly, true); assert.equal(facts.nmpSql.sdkInvocations, 0);
      assert.equal(facts.nmpSql.physicalFateEvidence, false);
      const exits = records.filter(v => v.event === 'reaped');
      assert.equal(exits.length, 1); assert.equal(exits[0].pid, facts.pid);
      assert.equal(exits[0].status, 0); assert.equal(exits[0].unknown, false);
      check();
    }
    console.log(JSON.stringify({root, phases: results.map(r => r.phase), productionQualified: false, nmpSdkInvocations: 0, protectedBudgetRuntime: true}));
  });
