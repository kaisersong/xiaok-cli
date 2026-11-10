import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync,linkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {restoreClosedFixture} from './restore-sqlite-fixture.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'fixture-byte-restore-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return{root,source:join(root,'prepared'),target:join(root,'working')};}
test('restores all bytes, truncates extra content, preserves inode and verifies complete post-sync SHA',t=>{
 const {source,target}=fixture(t),data=Buffer.alloc(3*1024*1024+17,7);writeFileSync(source,data);writeFileSync(target,Buffer.alloc(data.length+4096,0));
 const initial=statSync(target,{bigint:true}).ino,r=restoreClosedFixture({source,target,assertQuiescent:()=>{},expectedSha256:hash(data)});
 assert.equal(r.logicalCopyBytes,data.length);assert.equal(r.bytesCompared,data.length);assert.equal(r.bytesWritten,data.length);assert.equal(r.targetSha256,hash(data));assert.equal(r.sourceSha256,hash(data));assert.equal(r.restoreSyncIncluded,true);assert.equal(statSync(target,{bigint:true}).ino,initial);assert.deepEqual(readFileSync(target),data);
});
test('compares unchanged blocks but writes only differing blocks; an unchanged restore still syncs and full-hashes',t=>{
 const {source,target}=fixture(t),data=Buffer.alloc(3*1024*1024,8);writeFileSync(source,data);const changed=Buffer.from(data);changed[1024*1024+9]=4;writeFileSync(target,changed);
 const r=restoreClosedFixture({source,target,assertQuiescent:()=>{},expectedSha256:hash(data)});assert.equal(r.bytesCompared,data.length);assert.equal(r.bytesWritten,1024*1024);assert.equal(r.targetSha256,hash(data));
 const again=restoreClosedFixture({source,target,assertQuiescent:()=>{},expectedSha256:hash(data)});assert.equal(again.bytesCompared,data.length);assert.equal(again.bytesWritten,0);assert.equal(again.restoreSyncIncluded,true);assert.equal(again.targetSha256,hash(data));
});
test('rejects incorrect frozen hash and same inode/multiple links instead of measuring a changed preimage',t=>{
 const {source,target,root}=fixture(t);writeFileSync(source,'private fixture');writeFileSync(target,'old');
 assert.throws(()=>restoreClosedFixture({source,target,assertQuiescent:()=>{},expectedSha256:'0'.repeat(64)}),/fixture_source_hash/);
 assert.throws(()=>restoreClosedFixture({source,target:source,assertQuiescent:()=>{},expectedSha256:hash(readFileSync(source))}),/fixture_alias/);
 const alias=join(root,'alias');linkSync(source,alias);assert.throws(()=>restoreClosedFixture({source,target,assertQuiescent:()=>{},expectedSha256:hash(readFileSync(source))}),/fixture_alias/);
});
test('rejects a pre-existing aliased target',t=>{
 const {source,target,root}=fixture(t);writeFileSync(source,'prepared');const other=join(root,'other');writeFileSync(other,'working');
 if(process.platform==='win32')linkSync(other,target);else symlinkSync(other,target);
 assert.throws(()=>restoreClosedFixture({source,target,assertQuiescent:()=>{},expectedSha256:hash(readFileSync(source))}),/fixture_alias/);
});
test('the caller must prove actual SQLite custody before any file is changed',async t=>{
 const {DatabaseSync}=await import('node:sqlite'),{source,target}=fixture(t),db=new DatabaseSync(source);db.exec('CREATE TABLE proof(value);INSERT INTO proof VALUES(1)');db.close();
 writeFileSync(target,readFileSync(source));const writer=new DatabaseSync(target),before=readFileSync(target),expectedSha256=hash(readFileSync(source));
 try{assert.throws(()=>restoreClosedFixture({source,target,expectedSha256,assertQuiescent:()=>{if(writer.isOpen)throw Error('fixture_writer_not_closed');}}),/fixture_writer_not_closed/);assert.deepEqual(readFileSync(target),before);}
 finally{writer.close();}
 const r=restoreClosedFixture({source,target,expectedSha256,assertQuiescent:()=>assert.equal(writer.isOpen,false)});assert.equal(r.targetSha256,expectedSha256);
});
