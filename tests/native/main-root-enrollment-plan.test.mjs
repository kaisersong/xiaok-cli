import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync,renameSync,readdirSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const mac={skip:process.platform!=='darwin'}, digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'enrollment-plan-')),metadata=join(root,'metadata'),binary=join(root,'component');mkdirSync(metadata,{mode:0o700});process.env.XIAOK_CONFIG_DIR=join(root,'config');mkdirSync(process.env.XIAOK_CONFIG_DIR,{mode:0o700});
 const records=[],inputs=['native/main-installation/enrollment-consume-file.h','native/main-installation/enrollment-codec.h','tests/native/fixtures/main-enrollment-plan.c','tests/native/fixtures/main-enrollment-codec.c','tests/native/main-root-enrollment-plan.test.mjs'];
 if(existsSync('native/main-installation/enrollment-consume-plan.h'))inputs.push('native/main-installation/enrollment-consume-plan.h');
 const sourceHashes=Object.fromEntries(inputs.map(file=>[file,digest(file)]));
 const run=(exe,args)=>{const value=spawnSync(exe,args,{encoding:'utf8'});records.push({pid:value.pid,status:value.status,signal:value.signal,argv:[exe,...args],stdout:value.stdout,stderr:value.stderr});writeFileSync(join(root,'records.json'),JSON.stringify({node:process.version,parentPid:process.pid,root,sourceHashes,records},null,2));console.log(JSON.stringify({kind:'own-enrollment-plan-process',root,pid:value.pid,status:value.status,signal:value.signal}));return value;};
 const compiled=run('/usr/bin/clang',['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-DMI_ENROLLMENT_COMPONENT_BUILD=1','-I',resolve('native/main-installation'),resolve('tests/native/fixtures/main-enrollment-plan.c'),'-framework','Security','-o',binary]);assert.equal(compiled.status,0,compiled.stderr);
 for(const [file,sha]of Object.entries(sourceHashes))assert.equal(digest(file),sha,'source changed during compile');
 return {root,metadata,sourceHashes,run(mode,fault='none'){for(const [file,sha]of Object.entries(sourceHashes))assert.equal(digest(file),sha,'source changed before original entry');const value=run(binary,[metadata,mode,fault]);for(const [file,sha]of Object.entries(sourceHashes))assert.equal(digest(file),sha,'source changed after original entry');assert.equal(value.status,0,value.stderr);assert.equal(value.signal,null);return value.stdout.trim()?JSON.parse(value.stdout):undefined;}};
}
function consumePath(f){const name=readdirSync(f.metadata).find(name=>name.startsWith('enrollment-consume-'));return name?join(f.metadata,name):undefined;}
test('prepare keeps an actual accepted FD but creates no nonce or consumption',mac,()=>{
 const f=fixture();f.run('seed');const accepted=join(f.metadata,'main-root-family.enrollment'),before=digest(accepted),inode=lstatSync(accepted,{bigint:true}).ino;
 const result=f.run('prepare');assert.equal(result.good,true);assert.equal(result.prepared,true);assert.equal(result.planned,false);assert.equal(result.nonceCalls,0);assert.equal(result.writes,0);assert.equal(result.closeKnown,true);assert.equal(consumePath(f),undefined);assert.equal(digest(accepted),before);assert.equal(lstatSync(accepted,{bigint:true}).ino,inode);
});
test('a persisted plan survives interruption and restored commit writes exactly those 320 bytes without entropy',mac,()=>{
 const f=fixture();f.run('seed');const created=f.run('create');assert.equal(created.good,true);assert.equal(created.nonceCalls,1);assert.equal(consumePath(f),undefined);
 const planned=readFileSync(join(f.metadata,'component-consume-plan.bin'));assert.equal(planned.length,320);
 const existing=f.run('create');assert.equal(existing.good,true);assert.equal(existing.nonceCalls,0);assert.deepEqual(readFileSync(join(f.metadata,'component-consume-plan.bin')),planned);
 const committed=f.run('commit');assert.equal(committed.good,true);assert.equal(committed.nonceCalls,0);assert.equal(committed.status,1);assert.deepEqual(readFileSync(consumePath(f)),planned);
 const replay=f.run('commit');assert.equal(replay.good,true);assert.equal(replay.nonceCalls,0);assert.equal(replay.status,2);assert.deepEqual(readFileSync(consumePath(f)),planned);assert.ok(replay.fsyncs>=2);
});
test('missing and symlink accepted files are refused without entropy or plan creation',mac,()=>{
 const f=fixture(),missing=f.run('prepare');assert.equal(missing.good,false);assert.equal(missing.nonceCalls,0);assert.equal(missing.closeKnown,true);assert.deepEqual(readdirSync(f.metadata),[]);
 const g=fixture();g.run('seed');const file=join(g.metadata,'main-root-family.enrollment');renameSync(file,file+'.held');symlinkSync(file+'.held',file);const linked=g.run('prepare');assert.equal(linked.good,false);assert.equal(linked.nonceCalls,0);assert.equal(linked.closeKnown,true);assert.equal(consumePath(g),undefined);assert.equal(existsSync(join(g.metadata,'component-consume-plan.bin')),false);
});
test('foreign plan bindings and checksum never create consumption or sample entropy',mac,()=>{
 for(const mode of ['foreign-pool','bad-checksum']){const f=fixture();f.run('seed');f.run('create');const plan=readFileSync(join(f.metadata,'component-consume-plan.bin')),result=f.run(mode);assert.equal(result.good,false);assert.equal(result.unknown,true);assert.equal(result.nonceCalls,0);assert.equal(consumePath(f),undefined);assert.deepEqual(readFileSync(join(f.metadata,'component-consume-plan.bin')),plan);}
});
test('an existing consumption with another nonce is not accepted as this original plan',mac,()=>{
 const f=fixture();f.run('seed');f.run('create');f.run('commit');const file=consumePath(f),before=readFileSync(file),result=f.run('different-nonce');assert.equal(result.good,false);assert.equal(result.unknown,true);assert.equal(result.reason,'MI_CONSUME_PLAN_MISMATCH');assert.equal(result.nonceCalls,0);assert.deepEqual(readFileSync(file),before);
});
test('same-inode accepted byte changes between prepare and commit are refused before consumption writes',mac,()=>{
 const f=fixture();f.run('seed');f.run('create');const file=join(f.metadata,'main-root-family.enrollment'),inode=lstatSync(file,{bigint:true}).ino,result=f.run('change-accepted');assert.equal(result.good,false);assert.equal(result.unknown,true);assert.equal(result.reason,'MI_ACCEPTED_SOURCE_CHANGED');assert.equal(result.writes,0);assert.equal(result.nonceCalls,0);assert.equal(consumePath(f),undefined);assert.equal(lstatSync(file,{bigint:true}).ino,inode);
});
test('same accepted bytes at a replacement inode cannot restore the original plan',mac,()=>{
 const f=fixture();f.run('seed');f.run('create');const file=join(f.metadata,'main-root-family.enrollment');writeFileSync(file+'.next',readFileSync(file),{flag:'wx',mode:0o600});renameSync(file+'.next',file);const result=f.run('commit');assert.equal(result.good,false);assert.equal(result.unknown,true);assert.equal(result.nonceCalls,0);assert.equal(consumePath(f),undefined);
});
test('one row cannot create two plans and a close errno of zero retains its exact failed descriptor',mac,()=>{
 const f=fixture();f.run('seed');const duplicate=f.run('duplicate');assert.equal(duplicate.good,false);assert.equal(duplicate.nonceCalls,1);assert.equal(consumePath(f),undefined);
 const g=fixture();g.run('seed');const failed=g.run('create','close-zero');assert.equal(failed.good,true);assert.equal(failed.closeKnown,false);assert.equal(failed.unknown,true);assert.equal(failed.errorPresent,true);assert.equal(failed.firstErrno,0);assert.ok(failed.failedAcceptedFd>=0);assert.equal(consumePath(g),undefined);
});
test('write and fsync uncertainty retains the original planned bytes and never repairs partial consumption',mac,()=>{
 for(const fault of ['write','fsync','close-zero']){const f=fixture();f.run('seed');f.run('create');const planned=readFileSync(join(f.metadata,'component-consume-plan.bin')),failed=f.run('commit',fault);assert.equal(failed.good,false);assert.equal(failed.unknown,true);assert.equal(failed.nonceCalls,0);assert.equal(failed.closeKnown,false);const file=consumePath(f),before=readFileSync(file),next=f.run('commit');assert.equal(next.nonceCalls,0);assert.deepEqual(readFileSync(join(f.metadata,'component-consume-plan.bin')),planned);assert.deepEqual(readFileSync(file),before);if(fault==='write'){assert.equal(next.good,false);assert.equal(next.unknown,true);}else assert.equal(next.good,true);}
});
test('missing preparation and a failed entropy source cannot be retried into another plan',mac,()=>{
 const f=fixture(),unprepared=f.run('unprepared');assert.equal(unprepared.good,false);assert.equal(unprepared.nonceCalls,0);assert.deepEqual(readdirSync(f.metadata),[]);
 const g=fixture();g.run('seed');const result=g.run('retry-random','random');assert.equal(result.good,false);assert.equal(result.nonceCalls,1);assert.equal(result.reason,'MI_CONSUME_NONCE_UNKNOWN');assert.equal(result.errorPresent,true);assert.equal(result.planned,false);assert.equal(consumePath(g),undefined);assert.equal(readFileSync(join(g.metadata,'component-consume-plan.bin')).length,0);
});
test('a symlink consume path cannot redirect a planned commit to another file',mac,()=>{
 const f=fixture();f.run('seed');const plan=f.run('create'),other=join(f.metadata,'other.bin');writeFileSync(other,readFileSync(join(f.metadata,'component-consume-plan.bin')),{flag:'wx',mode:0o600});const before=readFileSync(other);symlinkSync(other,join(f.metadata,plan.name));const result=f.run('commit');assert.equal(result.good,false);assert.equal(result.unknown,true);assert.equal(result.nonceCalls,0);assert.deepEqual(readFileSync(other),before);
});
