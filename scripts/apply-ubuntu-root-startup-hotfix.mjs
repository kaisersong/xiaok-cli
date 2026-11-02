import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const entry=fs.realpathSync(process.argv[2]),root=path.dirname(path.dirname(entry));
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,'1.6.1','仅适用于 xiaokcode 1.6.1');
const file=path.join(root,'dist','runtime','verification','known-directory-writer-fence.js');
const original=fs.readFileSync(file),hash=crypto.createHash('sha256').update(original).digest('hex');
const before='if (!uid || uid !== process.geteuid?.() || account.uid !== uid)';
const after='if (uid === undefined || !Number.isSafeInteger(uid) || uid < 0 || uid !== process.geteuid?.() || account.uid !== uid)';
if(original.toString().includes(after)){console.log('UID 0 补丁已存在。');process.exit(0);}
assert.equal(hash,'7ab0018375ee217bf9bddd5143cf5445a2110136d15c6448b1b9b8d7d1070766','原文件校验不符，未修改');
const text=original.toString();assert.equal(text.split(before).length,2);
const next=text.replace(before,after),syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:next,encoding:'utf8'});
assert.equal(syntax.status,0,'补丁语法检查失败，未修改');
const backup=file+'.uid0.bak',mode=fs.statSync(file).mode&0o777;
if(fs.existsSync(backup))assert.deepEqual(fs.readFileSync(backup),original);else fs.writeFileSync(backup,original,{flag:'wx',mode});
const temporary=file+'.uid0-'+process.pid+'.tmp';
try{fs.writeFileSync(temporary,next,{flag:'wx',mode});assert.deepEqual(fs.readFileSync(file),original,'原文件已变化，停止替换');fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
console.log('UID 0 启动补丁已应用；原文件备份：'+backup);
