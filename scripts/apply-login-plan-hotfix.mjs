import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Run from the extracted hotfix folder: node apply.mjs <xiaokcode-package-directory>
const payloadRoot=path.dirname(fileURLToPath(import.meta.url));
const destinationRoot=path.resolve(process.argv[2]??'.');
const pkg=JSON.parse(fs.readFileSync(path.join(destinationRoot,'package.json'),'utf8'));
if(pkg.name!=='xiaokcode'||!['1.5.5','1.5.6'].includes(pkg.version))throw Error('This patch supports xiaokcode 1.5.5/1.5.6 only');
const manifest=JSON.parse(fs.readFileSync(path.join(payloadRoot,'manifest.json'),'utf8'));
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const writes=[];
for(const item of manifest){
 const content=fs.readFileSync(path.join(payloadRoot,'payload',item.file));
 if(sha(content)!==item.sha256)throw Error('Payload verification failed: '+item.file);
 if(item.file.endsWith('.js')){
  const check=spawnSync(process.execPath,['--check',path.join(payloadRoot,'payload',item.file)],{encoding:'utf8'});
  if(check.status!==0)throw Error('Syntax verification failed: '+item.file);
 }
 writes.push({file:item.file,content});
}
const chatFile=path.join('dist','commands','chat.js');
let chat=fs.readFileSync(path.join(destinationRoot,chatFile),'utf8');
for(const [phase,marker] of [
 ['adapter','const bootstrap ='],['memory','const memoryStore = await createMemoryStoreAsync'],
 ['credentials','const creds = await loadCredentials()'],['platform','const platform = await createPlatformRuntimeContext'],
 ['transcript','const transcriptLogger = await FileTranscriptLogger.open'],['agent','agent = new Agent(adapter, registry, initialPromptSnapshot.rendered,'],
]){
 if(chat.includes(`startupPhase: '${phase}'`))continue;
 if(chat.split(marker).length!==2)throw Error('Unsupported chat startup boundary: '+phase);
 chat=chat.replace(marker,`setCrashContext({ startupPhase: '${phase}' });\n        ${marker}`);
}
writes.push({file:chatFile,content:Buffer.from(chat)});
if(process.argv.includes('--dry-run')){
 console.log(JSON.stringify({version:pkg.version,files:writes.length,dryRun:true}));
 process.exit(0);
}
const backupRoot=path.join(destinationRoot,`.login-plan-backup-${Date.now()}`);
fs.mkdirSync(backupRoot,{recursive:true});
for(const item of writes){
 const destination=path.join(destinationRoot,item.file);
 if(fs.existsSync(destination)){
  const backup=path.join(backupRoot,item.file);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(destination,backup);
 }
}
for(const item of writes){
 const destination=path.join(destinationRoot,item.file);
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 const temporary=destination+'.login-plan.tmp';fs.writeFileSync(temporary,item.content);fs.renameSync(temporary,destination);
 if(sha(fs.readFileSync(destination))!==sha(item.content))throw Error('Installation verification failed: '+item.file);
}
console.log(JSON.stringify({version:pkg.version,files:writes.length,backupRoot}));
