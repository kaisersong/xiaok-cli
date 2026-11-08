import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

for (const drift of ['head', 'test-bytes']) {
 test(`original CI runner rejects ${drift} drift after collection`, { timeout: 60000 }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-ci-epoch-')));
  const commands = [];
  mkdirSync(join(root, 'config'), { mode: 0o700 });
  const env = { ...process.env, XIAOK_CONFIG_DIR: join(root, 'config') };
  const run = (file, args) => {
   const result = spawnSync(file, args, { cwd: root, env, encoding: 'utf8', timeout: 30000 });
   commands.push({ file, args, pid: result.pid, status: result.status, signal: result.signal });
   if (result.error) throw result.error;
   return result;
  };
  const git = (...args) => { const result=run('git',args);assert.equal(result.status,0,result.stderr);return result.stdout.trim(); };
  try {
   const copied=run('/bin/cp',['-cR',join(repository,'node_modules'),join(root,'node_modules')]);
   assert.equal(copied.status,0,copied.stderr);
   mkdirSync(join(root,'.github/scripts'),{recursive:true});
   mkdirSync(join(root,'.github/ci/fixtures'),{recursive:true});
   for (const file of ['.github/scripts/ci-plan.mjs','.github/ci/fixture.config.mjs','.github/ci/fixtures/cases.fixture.mjs','package-lock.json']) {
    copyFileSync(join(repository,file),join(root,file));
    assert.equal(sha(readFileSync(join(root,file))),sha(readFileSync(join(repository,file))));
   }
   writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
   writeFileSync(join(root,'.gitignore'),'node_modules/\nreport/\nconfig/\n');
   git('init','-q');git('config','user.name','CI epoch fixture');git('config','user.email','fixture@example.invalid');
   git('add','.');git('commit','-qm','original fixed fixture');
   const script=join(root,'.github/scripts/ci-plan.mjs');
   const collected=run(process.execPath,[script,'collect','.github/ci/fixture.config.mjs','.github/ci/fixtures/cases.fixture.mjs','report','fixture','1','1']);
   assert.equal(collected.status,0,collected.stdout+collected.stderr);
   const manifest=JSON.parse(readFileSync(join(root,'report/manifest.json'),'utf8'));
   assert.equal(manifest.inventory.length,4,'the actual production collector must run');
   if (drift==='head') { writeFileSync(join(root,'README.md'),'new actual commit\n');git('add','README.md');git('commit','-qm','actual head changed'); }
   else { const file=join(root,'.github/ci/fixtures/cases.fixture.mjs');writeFileSync(file,readFileSync(file,'utf8')+'\n// bytes changed after collection\n'); }
   const result=run(process.execPath,[script,'run','report']);
   assert.notEqual(result.status,0,'stale epoch must not execute and succeed');
   assert.match(result.stderr,/Shard input epoch changed/);
   assert.equal(existsSync(join(root,'report/run-receipt.json')),false,'must reject before child runner/receipt');
  } finally {
   console.log(JSON.stringify({fixture:'ci-input-epoch',drift,commands}));
   rmSync(root,{recursive:true,force:true});
  }
 });
}
