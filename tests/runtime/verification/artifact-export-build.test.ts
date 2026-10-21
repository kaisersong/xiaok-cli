import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../../..');
it('the actual build entry rejects a modified official SDK archive before executing any compiler',()=>{
 const work=mkdtempSync(join(tmpdir(),'xiaok-export-build-'));
 try{
  const lock=JSON.parse(readFileSync(join(root,'scripts/verification/artifact-export-toolchain.lock.json'),'utf8'));
  const host=lock.hosts[`${process.platform}-${process.arch}`];
  const archive=join(work,host.filename);
  // Correct official size is insufficient: the entire archived SDK must match.
  writeFileSync(archive,Buffer.alloc(host.size));
  const result=spawnSync(process.execPath,[join(root,'scripts/verification/build-artifact-export-helper.mjs'),'--target',`${process.platform}-${process.arch}`,'--toolchain-archive',archive],{encoding:'utf8',timeout:15000});
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('artifact_export_toolchain_archive_hash');
 }finally{rmSync(work,{recursive:true,force:true});}
});
