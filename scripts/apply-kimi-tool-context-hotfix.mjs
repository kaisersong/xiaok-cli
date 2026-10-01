import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const destination=path.resolve(process.argv[2]??'.');
const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json'),'utf8'));
if(pkg.name!=='xiaokcode'||!['1.5.5','1.5.6'].includes(pkg.version))throw Error('This patch supports xiaokcode 1.5.5/1.5.6 only');
const target=path.join(destination,'dist/ai/tools/bash.js');
const original=fs.readFileSync(target,'utf8');
const getter='get description() {';
let patched;
if(original.split(getter).length===2){
 const start=original.indexOf(getter);
 const endMarker='},\n        inputSchema:';
 const end=original.indexOf(endMarker,start);
 if(end<0||!original.slice(start,end).includes("process.platform === 'win32'"))throw Error('Unsupported bash description boundary');
 patched=original.slice(0,start)+'description: (() => {'+original.slice(start+getter.length,end)+'})(),\n        inputSchema:'+original.slice(end+endMarker.length);
}else if(!original.includes(getter)&&original.includes('description: (() => {')){
 console.log(JSON.stringify({version:pkg.version,alreadyPatched:true}));process.exit(0);
}else throw Error('Unsupported bash definition');
const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:patched,encoding:'utf8'});
if(check.status!==0)throw Error('Patched module syntax check failed');
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({version:pkg.version,file:'dist/ai/tools/bash.js',dryRun:true}));process.exit(0);
}
const backup=path.join(destination,`.kimi-tool-context-backup-${Date.now()}`);
fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(target,path.join(backup,'bash.js'));
if(fs.readFileSync(target,'utf8')!==original)throw Error('Target changed during preparation');
const temporary=target+'.kimi-tool-context.tmp';
fs.writeFileSync(temporary,patched,{mode:fs.statSync(target).mode});fs.renameSync(temporary,target);
const sha=value=>createHash('sha256').update(value).digest('hex');
if(sha(fs.readFileSync(target))!==sha(patched))throw Error('Installed module verification failed');
console.log(JSON.stringify({version:pkg.version,file:'dist/ai/tools/bash.js',backup}));
