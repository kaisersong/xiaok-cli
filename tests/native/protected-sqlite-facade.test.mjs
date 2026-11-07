import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const scenario of ['normal', 'identity_loss', 'cursor_gc'])
  test(
      `original helper drives protected SQLite facade: ${scenario}`,
      {skip: process.platform !== 'darwin'}, async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'psf-')));
        mkdirSync(join(root, 'config'), {mode: 0o700});
        console.log(JSON.stringify({kind: 'protected-sqlite-facade-root', root}));
        const native = join(repo, 'native/root-resource-authority'),
              wire = join(repo, 'native/main-installation'),
              facade = join(repo, 'native/protected-sqlite-facade');
        const config = join(root, 'configuration.h'), addon = join(root, 'protected_sqlite.node'),
              helper = join(root, 'helper'), launcher = join(root, 'launcher'),
              entry = join(root, 'entry.cjs');
        const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
        // Fixture closure requires its own uid-owned executable; never chmod shared Node.
        const node = join(root, 'node');
        copyFileSync(realpathSync(process.execPath), node, constants.COPYFILE_FICLONE);
        chmodSync(node, 0o500);
        const header =
            [
              ['MI_FIXED_ROOT', root], ['MI_MAIN_EXEC', node], ['MI_MAIN_BUNDLE', node],
              ['MI_LAUNCHER_EXEC', launcher], ['MI_FIXTURE_MAIN_ENTRY', entry],
              ['MI_EXPECTED_MAIN_SHA256', hash(node)]
            ].map(([k, v]) => `#define ${k} ${JSON.stringify(v)}\n`)
                .join('');
        writeFileSync(config, header);
        writeFileSync(
            entry,
            `require(${
                JSON.stringify(
                    join(repo, 'tests/native/fixtures/protected-sqlite-facade.cjs'))}).run(${
                JSON.stringify(root)}, ${JSON.stringify(scenario)});\n`);
        const sdk = spawnSync('/usr/bin/xcrun', ['--show-sdk-path'], {encoding: 'utf8'});
        assert.equal(sdk.status, 0, sdk.stderr);
        const cache = join(homedir(), 'Library/Caches/node-gyp');
        const versions = [
          process.versions.node,
          ...readdirSync(cache)
              .filter(v => /^\d+\.\d+\.\d+$/.test(v))
              .sort((a, b) => b.localeCompare(a, undefined, {numeric: true}))
        ];
        const headerVersion =
            versions.find(v => existsSync(join(cache, v, 'include/node/node_api.h')));
        assert.ok(headerVersion, 'actual cached Node headers required');
        const headers = join(cache, headerVersion, 'include/node');
        const common = [
          '-std=c11',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
          '-isysroot',
          sdk.stdout.trim(),
          '-I',
          native,
          '-I',
          wire,
          '-I',
          facade,
          '-I',
          headers,
          '-DNAPI_VERSION=8',
          '-DMI_FIXTURE_BUILD=1',
          '-DNR_ROOT_IO_COMPONENT=1',
          '-DPS_COMPONENT_BUILD=1',
          '-DMI_CONFIGURATION_HEADER=' + JSON.stringify(config)
        ];
        const sourcePaths=new Set();
      const includeDirs=[native,wire,facade,headers];
      function captureSource(file){
        if(sourcePaths.has(file))return;
        sourcePaths.add(file);
        const text=readFileSync(file,'utf8');
        for(const match of text.matchAll(/^\s*#include\s+"([^"]+)"/gm)){
          const target=[join(dirname(file),match[1]),...includeDirs.map(dir=>join(dir,match[1]))].find(existsSync);
          if(target)captureSource(target);
        }
      }
      for(const file of [join(facade,'protected-sqlite-facade.c'),join(facade,'protected-sqlite-module.c'),join(repo,'tests/native/fixtures/protected-sqlite-facade-addon.c'),join(native,'original-root-io-vfs.c'),join(native,'installed-main-client.c'),join(wire,'wire.c'),join(wire,'main-installation-helper.c'),join(wire,'main-installation-entry.c'),join(facade,'index.cjs'),join(repo,'tests/native/fixtures/protected-sqlite-facade.cjs')])captureSource(file);
      const sourceHashes=Object.fromEntries([...sourcePaths].map(file=>[file,hash(file)]));
      writeFileSync(join(root,'source-hashes.json'),JSON.stringify(sourceHashes,null,2));
      const builds = [];
        function build(files, output, extra = []) {
          const args = [
            ...common, ...files, ...extra, '-framework', 'Security', '-framework', 'CoreFoundation',
            '-framework', 'OpenDirectory', '-lbsm', '-o', output
          ];
          const r = spawnSync('/usr/bin/cc', args, {cwd: repo, encoding: 'utf8'});
          builds.push({
            args,
            pid: r.pid,
            status: r.status,
            signal: r.signal,
            stdout: r.stdout,
            stderr: r.stderr
          });
          writeFileSync(join(root, 'builds.json'), JSON.stringify(builds, null, 2));
          assert.equal(r.error, undefined);
          assert.equal(r.status, 0, r.stderr);
          chmodSync(output, 0o500);
        }
        build(
            [
              join(repo, 'tests/native/fixtures/protected-sqlite-facade-addon.c'),
              join(facade, 'protected-sqlite-facade.c'), join(native, 'original-root-io-vfs.c'),
              join(native, 'installed-main-client.c'), join(wire, 'wire.c')
            ],
            addon, ['-bundle', '-undefined', 'dynamic_lookup', '-lsqlite3']);
        build(
            [
              join(facade, 'protected-sqlite-module.c'), join(facade, 'protected-sqlite-facade.c'),
              join(native, 'original-root-io-vfs.c'), join(native, 'installed-main-client.c'),
              join(wire, 'wire.c')
            ],
            join(root, 'production_sqlite.node'), [
              '-bundle', '-undefined', 'dynamic_lookup', '-lsqlite3', '-UMI_FIXTURE_BUILD',
              '-UNR_ROOT_IO_COMPONENT', '-UPS_COMPONENT_BUILD'
            ]);
        writeFileSync(join(root, 'index.cjs'), readFileSync(join(facade, 'index.cjs')));
        build([join(wire, 'main-installation-entry.c'), join(wire, 'wire.c')], launcher);
        build([join(wire, 'main-installation-helper.c'), join(wire, 'wire.c')], helper);
        const child = spawn(helper, [], {
          cwd: root,
          env: {PATH: '/usr/bin:/bin', XIAOK_CONFIG_DIR: join(root, 'config')},
          stdio: ['pipe', 'pipe', 'pipe']
        });
        const record =
            {pid: child.pid, stdout: '', stderr: '', code: null, signal: null, reaped: false};
        child.stdout.on('data', b => record.stdout += b);
        child.stderr.on('data', b => record.stderr += b);
        const closed = new Promise((yes, no) => {
          child.once('error', no);
          child.once('close', (code, signal) => {
            Object.assign(record, {code, signal, reaped: true});
            yes();
          });
        });
        const deadline = setTimeout(() => child.kill('SIGTERM'), 20000);
        child.stdin.end();
        try {
          await closed;
        } finally {
          clearTimeout(deadline);
          if (!record.reaped) {
            child.kill('SIGTERM');
            await closed;
          }
          writeFileSync(join(root, 'run.json'), JSON.stringify(record, null, 2));
          console.log(JSON.stringify(record));
        }
        assert.equal(record.code, 0, record.stderr);
        assert.equal(record.signal, null);
        const facts = record.stdout.split('\n')
                          .filter(s => s.startsWith('{'))
                          .map(s => JSON.parse(s))
                          .find(r => r.kind === 'protected-sqlite-facade-component');
        assert.deepEqual(Object.fromEntries([...sourcePaths].map(file=>[file,hash(file)])),sourceHashes,'compiled source changed during original component run');
      assert.ok(facts);
        assert.equal(facts.success, true);
        assert.equal(facts.unknown, scenario === 'identity_loss');
        assert.equal(facts.rootFilesClosed, scenario !== 'identity_loss');
        assert.equal(facts.productionQualified, false);
        assert.equal(facts.proxyTraps, 0);
      });
