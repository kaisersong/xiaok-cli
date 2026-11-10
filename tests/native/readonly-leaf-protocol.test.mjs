import {getNativeTestElectronExecutable} from './helpers/electron-executable.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn, spawnSync} from 'node:child_process';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cases = ['warm', 'cancel-ready', 'corrupt-binding-nonce', 'corrupt-binding-pid-type', 'corrupt-closed-binding', 'corrupt-closed-go-vs-fence'];
for (const kind of ['binding', 'fence', 'closed'])
  for (const column of ['hash', 'json'])
    for (const storage of ['blob', 'nul'])
      cases.push(`corrupt-${kind}-${column}-${storage}`);
for (const mode of cases)
  test('original Native readonly leaf same-P intent/binding/GO/cold: ' + mode,
    {skip:process.platform !== 'darwin', timeout:30000}, async () => {
      const root = mkdtempSync(join(tmpdir(), 'xiaok-native-readonly-leaf-'));
      const domain = join(root, 'domain');
      mkdirSync(domain);
      const facts = join(root, 'facts.json'), addon = join(root, 'main.node');
      const finite = join(root, 'finite.h');
      writeFileSync(finite, 'static const char *nr_fixture_metadata[]={NULL};\nstatic const char *nr_fixture_execution_keys[]={NULL};\nstatic const int nr_fixture_priorities[]={0};\n#define NR_FIXTURE_FACT_COUNT 0\n');
      const compiled = spawnSync(process.execPath, [join(repo, 'native/root-resource-authority/build-main-session.mjs'),
        process.env.XIAOK_MAIN_BOOTSTRAP_TEST_HEADERS, addon, domain, 'embedded', finite], {encoding:'utf8'});
      assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
      const electron = await getNativeTestElectronExecutable(repo);
      const env = {...process.env};
      delete env.NODE_OPTIONS;
      delete env.ELECTRON_RUN_AS_NODE;
      async function phase(stage) {
        const args = [join(repo, 'tests/native/fixtures/readonly-leaf-protocol.cjs'), addon, domain, facts, join(root, 'userData'), mode, stage];
        const child = spawn(electron, args, {env, stdio:['ignore','pipe','pipe']});
        const row = {pid:child.pid, argv:[electron,...args], stdout:'', stderr:'', signals:[]};
        writeFileSync(join(root, stage + '-birth.json'), JSON.stringify(row));
        child.stdout.on('data', bytes => {row.stdout += bytes;});
        child.stderr.on('data', bytes => {row.stderr += bytes;});
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {row.signals.push('SIGTERM'); child.kill('SIGTERM');}
        }, 15000);
        try {
          await new Promise((yes,no) => {child.once('error',no);child.once('close',(code,signal) => {Object.assign(row,{code,signal,reaped:true});yes();});});
        } finally {clearTimeout(timer);writeFileSync(join(root, stage + '-run.json'), JSON.stringify(row,null,2));}
        console.log(JSON.stringify({root, mode, stage, ...row}));
        assert.equal(row.code, 0, row.stderr);
        assert.deepEqual(row.signals, []);
        const value = JSON.parse(readFileSync(facts, 'utf8'));
        assert.equal(value.pid, child.pid);
        assert.equal(value.ok, true, JSON.stringify(value));
        return value;
      }
      assert.equal((await phase('warm')).actualLeafProtocol, true);
      assert.equal((await phase('cold'))[mode.startsWith('corrupt-') ? 'corruptHistoryRefused' : 'noColdGrant'], true);
    });
