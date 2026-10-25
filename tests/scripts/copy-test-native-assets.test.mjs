import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const repo=resolve(import.meta.dirname,'../..');
const names=['go.mod','main.go','identity_unix.go','identity_windows.go'];
function fixture(missing){
 const root=mkdtempSync(join(tmpdir(),'xiaok-copy-native-assets-'));
 for(const name of ['tests','src','scripts','desktop/native/artifact-export-helper'])mkdirSync(join(root,name),{recursive:true});
 writeFileSync(join(root,'scripts/copy-test-assets.mjs'),readFileSync(join(repo,'scripts/copy-test-assets.mjs')));
 const native=join(root,'desktop/native/artifact-export-helper');
 for(const name of names)if(name!==missing)writeFileSync(join(native,name),readFileSync(join(repo,'desktop/native/artifact-export-helper',name)));
 writeFileSync(join(native,'foreign.bin'),'foreign fixture');
 return {root,native,run:()=>spawnSync(process.execPath,[join(root,'scripts/copy-test-assets.mjs')],{cwd:root,encoding:'utf8',timeout:10000})};
}
test('actual asset-copy script copies all four real builder inputs exactly and excludes foreign assets',()=>{
 const f=fixture();
 try{
  const result=f.run();assert.equal(result.status,0,result.stderr);
  for(const name of names)assert.deepEqual(readFileSync(join(f.root,'.test-dist/desktop/native/artifact-export-helper',name)),readFileSync(join(f.native,name)));
  assert.equal(existsSync(join(f.root,'.test-dist/desktop/native/artifact-export-helper/foreign.bin')),false);
 }finally{rmSync(f.root,{recursive:true,force:true,maxRetries:3});}
});
test('actual asset-copy script fails when an original builder input is absent',()=>{
 const f=fixture('identity_windows.go');
 try{const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/ENOENT/);assert.match(result.stderr,/identity_windows\.go/);}
 finally{rmSync(f.root,{recursive:true,force:true,maxRetries:3});}
});
