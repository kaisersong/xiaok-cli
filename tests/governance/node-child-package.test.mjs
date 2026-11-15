import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
test('fixed physical closure maps owned asar entries, preserves external entries and rejects root escapes',()=>{
 const {mapNodeChildPath}=require('../../desktop/electron/node-child-package.cjs');
 const root=mkdtempSync(join(tmpdir(),'xiaok-node-child-test-'));
 try{
  mkdirSync(join(root,'node-child','app','dist'),{recursive:true});
  writeFileSync(join(root,'node-child','app','dist','worker.js'),'');
  const expected=join(root,'node-child','app','dist','worker.js');
  assert.equal(mapNodeChildPath(root,join(root,'app.asar','dist','worker.js')),expected);
  assert.equal(mapNodeChildPath(root,join(root,'app.asar.unpacked','dist','worker.js')),expected);
  mkdirSync(join(root,'outside'));writeFileSync(join(root,'outside','evil.js'),'');
  symlinkSync(join(root,'outside'),join(root,'node-child','app','linked'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>mapNodeChildPath(root,join(root,'app.asar','linked','evil.js')),/node_child_entry_escape/);
  const external=join(root,'services','worker.js');assert.equal(mapNodeChildPath(root,external),external);
  assert.throws(()=>mapNodeChildPath(root,join(root,'app.asar','missing.js')),/node_child/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('Intel macOS has a pinned Node runtime rather than falling back to Electron',()=>{
 const {targetEntry}=require('../../desktop/electron/broker-runtime-package.cjs');
 assert.equal(targetEntry('darwin-x64')?.executableSha256,'1052eb9c7d6c60a79b968e09f75af55a73462b0f6dff0964336d63b5e13eb63c');
});
test('declared Linux desktop targets also have fixed Node hosts',()=>{
 const {targetEntry}=require('../../desktop/electron/broker-runtime-package.cjs');
 for(const target of ['linux-x64','linux-arm64'])assert.equal(targetEntry(target)?.executable,'node');
});
