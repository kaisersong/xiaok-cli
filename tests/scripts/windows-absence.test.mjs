import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const core = resolve('src/runtime/verification/native/windows-installation-absence-core.h');
const copyScript = resolve('scripts/verification/copy-windows-absence.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('production C core requires all four observations to be absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-absence-core-'));
  try {
    const source = join(root, 'test.c'), executable = join(root, 'test');
    writeFileSync(source, `#include "${core}"\nint main(void) {\nfor(int a=0;a<3;a++){for(int b=0;b<3;b++){for(int c=0;c<3;c++){for(int d=0;d<3;d++){\nint actual=xiaok_absence_result(a,b,c,d);\nint expected=(a==1||b==1||c==1||d==1)?1:(a==0&&b==0&&c==0&&d==0)?0:2;\nif(actual!=expected)return 1;}}}}\nreturn 0;\n}\n`);
    const compile = spawnSync('clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', source, '-o', executable], {encoding:'utf8'});
    assert.equal(compile.status, 0, compile.stderr);
    assert.equal(spawnSync(executable).status, 0);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('packaging refuses a Windows reader without its native artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-absence-pack-'));
  try {
    const verifier = join(root,'dist/runtime/verification');
    mkdirSync(verifier,{recursive:true});
    writeFileSync(join(verifier,'windows-installation-absence.js'),'// reader fixture');
    const result = spawnSync(process.execPath,[copyScript,'--root',root,'--check','--arch','x64'],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Windows absence artifact missing/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('packaging verifies PE machine, payload SHA and source freshness', async () => {
  const {verifyArtifact} = await import(pathToFileURL(copyScript));
  const root = mkdtempSync(join(tmpdir(), 'xiaok-absence-hash-'));
  try {
    const pe = Buffer.alloc(256);pe.write('MZ');pe.writeUInt32LE(128,60);pe.write('PE\0\0',128);pe.writeUInt16LE(0x8664,132);
    const exe=join(root,'windows-installation-absence.exe');writeFileSync(exe,pe);
    const manifest={version:1,target:'win32-x64',sha256:hash(pe),sourceSha256:hash(readFileSync(resolve('src/runtime/verification/native/windows-installation-absence.c'))),coreSha256:hash(readFileSync(core))};
    const json=join(root,'windows-installation-absence.json');writeFileSync(json,JSON.stringify(manifest));
    assert.doesNotThrow(()=>verifyArtifact(root,'x64'));
    assert.throws(()=>verifyArtifact(root,'arm64'),/target/);
    manifest.sourceSha256='0'.repeat(64);writeFileSync(json,JSON.stringify(manifest));
    assert.throws(()=>verifyArtifact(root,'x64'),/source/);
    manifest.sourceSha256=hash(readFileSync(resolve('src/runtime/verification/native/windows-installation-absence.c')));writeFileSync(json,JSON.stringify(manifest));
    pe[250]=1;writeFileSync(exe,pe);assert.throws(()=>verifyArtifact(root,'x64'),/SHA/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
