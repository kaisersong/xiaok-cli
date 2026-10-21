import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir, machine} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const compiler=process.env.XIAOK_TEST_NATIVE_COMPILER;
const eligible=process.platform==='win32' && process.arch==='x64' && ['amd64','x86_64'].includes(machine().toLowerCase());
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFile=path.join(repository,'src/runtime/verification/native/windows-installation-absence.c');
const coreFile=path.join(repository,'src/runtime/verification/native/windows-installation-absence-core.h');
const fixtureFile=path.join(repository,'tests/fixtures/windows-absence-sdk-boundaries.c');

for(const variant of ['original','registry-result','directory-result','registry-omission','final-check-order']) {
  test(`actual Windows production SDK boundaries: ${variant}`,{skip:!eligible||!compiler},()=>{
    const source=fs.readFileSync(sourceFile,'utf8'),core=fs.readFileSync(coreFile),fixture=fs.readFileSync(fixtureFile,'utf8');
    const before=[sourceFile,coreFile,fixtureFile].map(file=>sha(fs.readFileSync(file)));
    const root=fs.mkdtempSync(path.join(tmpdir(),'xiaok-native-sdk-boundaries-'));
    try {
      let candidate=source;
      if(variant==='registry-result') candidate=source.replace('xiaok_absence_result(db, rb, da, ra)','xiaok_absence_result(db, rb, da, ((void)ra, rb))');
      if(variant==='directory-result') candidate=source.replace('xiaok_absence_result(db, rb, da, ra)','xiaok_absence_result(db, rb, ((void)da, db), ra)');
      if(variant==='registry-omission') candidate=source.replace('int da = probe_directory(buffer), ra = probe_registry();','int da = probe_directory(buffer), ra = rb;');
      if(variant==='final-check-order') {
        const first=source.indexOf('    /* Final checks occur'),last=source.indexOf('    result = xiaok_absence_result',first),target=source.indexOf('    wcscat(buffer, length == 3');
        assert.ok(first>target && last>first,'Actual final-check mutation boundaries required');
        candidate=source.slice(0,target)+source.slice(first,last)+source.slice(target,first)+source.slice(last);
      }
      if(variant!=='original') assert.notEqual(candidate,source,'Mutation must change the actual source');
      fs.writeFileSync(path.join(root,'production.c'),candidate);
      fs.writeFileSync(path.join(root,'windows-installation-absence-core.h'),core);
      const driver=path.join(root,'driver.c'),executable=path.join(root,'driver.exe');
      fs.writeFileSync(driver,fixture.replace('#include XIAOK_ABSENCE_TEST_SOURCE','#include "production.c"'));
      const compile=spawnSync(compiler,['-std=c11','-Wall','-Wextra','-Werror','-O2','-fstack-protector-all','-mguard=cf','-static','-Wl,--dynamicbase','-Wl,--nxcompat',driver,'-o',executable,'-lshell32','-lole32','-ladvapi32','-luuid'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024**2,shell:false});
      assert.ifError(compile.error);assert.equal(compile.signal,null);assert.equal(compile.status,0,compile.stderr);
      const result=spawnSync(executable,[],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:256*1024,shell:false});
      assert.ifError(result.error);assert.equal(result.signal,null);
      const cases=result.stdout.trim().split(/\r?\n/).map(row=>JSON.parse(row));assert.equal(cases.length,54);
      if(variant==='original') {assert.equal(result.status,0,result.stdout);assert.ok(cases.every(row=>row.passed));}
      else {
        assert.equal(result.status,1,'Compiled mutant must execute and fail the population');
        assert.ok(cases.some(row=>!row.passed));
        if(variant==='registry-result') assert.equal(cases.find(row=>row.case==='registry-absent-then-present').passed,false);
        if(variant==='directory-result') assert.equal(cases.find(row=>row.case==='directory-absent-then-present').passed,false);
        if(variant==='registry-omission'||variant==='final-check-order') assert.ok(cases.find(row=>row.case==='plain-absent').boundaryViolations>0);
      }
      assert.deepEqual([sourceFile,coreFile,fixtureFile].map(file=>sha(fs.readFileSync(file))),before);
    } finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:3});}
  });
}
