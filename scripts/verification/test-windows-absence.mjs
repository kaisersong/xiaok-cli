import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Execute the real client-bundled helper. This receipt does not qualify a
// protected controller, grant migration authority, or alter the OS namespace.
assert.equal(process.platform,'win32','Real Windows execution required');
assert.ok(['x64','arm64'].includes(process.arch),'Native Windows architecture required');
assert.equal(process.argv.length,2,'No path or executable overrides accepted');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const directory=join(root,'data','verification','windows','win32-'+process.arch);
const executable=join(directory,'windows-installation-absence.exe');
const manifestPath=join(directory,'windows-installation-absence.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function plainRead(path,limit){
 const info=lstatSync(path);
 assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size<=limit,'Plain bounded build artifact required');
 const bytes=readFileSync(path);assert.ok(bytes.length<=limit);return bytes;
}
const manifestBytes=plainRead(manifestPath,4096);
const manifest=JSON.parse(manifestBytes.toString('utf8'));
assert.deepEqual(Object.keys(manifest).sort(),['coreSha256','sha256','sourceSha256','target','version']);
assert.equal(manifest.version,1);assert.equal(manifest.target,'win32-'+process.arch);
assert.equal(manifest.sourceSha256,hash(readFileSync(join(root,'src/runtime/verification/native/windows-installation-absence.c'))));
assert.equal(manifest.coreSha256,hash(readFileSync(join(root,'src/runtime/verification/native/windows-absence-core.h'))));
const bytes=plainRead(executable,2*1024**2);assert.equal(hash(bytes),manifest.sha256);
assert.equal(bytes.subarray(0,2).toString(),'MZ');
const pe=bytes.readUInt32LE(0x3c);assert.ok(pe+24<=bytes.length);
assert.equal(bytes.subarray(pe,pe+4).toString('hex'),'50450000');
assert.equal(bytes.readUInt16LE(pe+4),process.arch==='x64'?0x8664:0xaa64);
function execute(args){
 const result=spawnSync(executable,args,{cwd:directory,env:{},shell:false,windowsHide:true,timeout:5000,maxBuffer:4096});
 assert.ifError(result.error);assert.equal(result.signal,null);
 assert.equal(result.status,args.length?64:0);
 const answer=JSON.parse(result.stdout.toString('utf8'));
 assert.deepEqual(Object.keys(answer).sort(),['kind','version']);assert.equal(answer.version,1);
 if(args.length)assert.equal(answer.kind,'unavailable');
 else assert.ok(['ordinary','installed'].includes(answer.kind),'Actual namespace observation unavailable');
 return {arguments:args,exitCode:result.status,answer};
}
const observations=[execute([]),execute([]),execute(['unexpected-override'])];
assert.equal(observations[0].answer.kind,observations[1].answer.kind,'Namespace changed between observations');
assert.ok(plainRead(manifestPath,4096).equals(manifestBytes));
assert.equal(hash(plainRead(executable,2*1024**2)),manifest.sha256);
const evidence={version:1,target:manifest.target,sourceSha256:manifest.sourceSha256,coreSha256:manifest.coreSha256,sha256:manifest.sha256,executedOnWindows:true,observations,controllerQualified:false};
const evidenceDirectory=join(root,'.artifacts','p3r','windows-native');mkdirSync(evidenceDirectory,{recursive:true});
writeFileSync(join(evidenceDirectory,'execution-'+process.arch+'.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
