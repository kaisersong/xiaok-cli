import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('build metadata binds source revision, excludes generated dirt and supports reproducible timestamps', () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-build-info-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
  try {
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'dist'));
    copyFileSync(new URL('../../scripts/set-build-info.mjs', import.meta.url), join(root, 'scripts/set-build-info.mjs'));
    writeFileSync(join(root, 'package.json'), '{"version":"9.8.7"}');
    writeFileSync(join(root, 'src', 'feature.ts'), 'export const fixture = 1;');
    writeFileSync(join(root, 'src', 'build-info.ts'), '');
    writeFileSync(join(root, 'src', 'build-flavor.ts'), '');
    writeFileSync(join(root, 'dist', 'generated.js'), '');
    git('init'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const run = (mode, env = {}) => {
      execFileSync(process.execPath, [join(root, 'scripts/set-build-info.mjs'), mode], {env:{...process.env, SOURCE_DATE_EPOCH:'', ...env}});
      const text = readFileSync(join(root, 'src/build-info.ts'), 'utf8');
      return {text, info:JSON.parse(text.match(/BUILD_INFO: BuildMetadata = ([\s\S]*);\n$/)[1])};
    };
    let result = run('normal');
    assert.equal(result.info.commit, sha); assert.equal(result.info.version, '9.8.7');
    assert.equal(result.info.dirty, false); assert.ok(result.info.builtAt); assert.equal(result.info.buildType, 'normal');
    writeFileSync(join(root, 'dist/generated.js'), 'regenerated');
    assert.equal(run('normal').info.dirty, false);
    writeFileSync(join(root, 'src/build-flavor.ts'), 'export const flavor = "rollback";');
    assert.equal(run('rollback').info.dirty, false);
    writeFileSync(join(root, 'src/feature.ts'), 'export const fixture = 2;');
    assert.equal(run('normal').info.dirty, true);
    const a = run('release', {SOURCE_DATE_EPOCH:'1234567890'});
    const b = run('release', {SOURCE_DATE_EPOCH:'1234567890'});
    assert.equal(a.text,b.text); assert.equal(a.info.builtAt,'2009-02-13T23:31:30.000Z');
    assert.equal(run('release').info.builtAt,null);
    assert.throws(() => run('normal', {SOURCE_DATE_EPOCH:'not-a-time'}));
    rmSync(join(root, '.git'), {recursive:true,force:true});
    result = run('normal');
    assert.equal(result.info.commit,null); assert.equal(result.info.dirty,null);
  } finally { rmSync(root,{recursive:true,force:true,maxRetries:3}); }
});
