import fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tasks } from './baseline-core.mjs';
import { isDeepStrictEqual } from 'node:util';
const runner=fileURLToPath(new URL('./baseline-sandbox.cjs',import.meta.url));
export const visibleVectors=[[],[{id:'a',status:'paid',amount:100,discount:20}],[{id:'b',status:'cancelled',amount:800,discount:0}]];
const hiddenVectors=[...visibleVectors,[{id:'a',status:'paid',amount:100,discount:200}],[{id:'a',status:'paid',amount:20,discount:2},{id:'a',status:'paid',amount:80,discount:0}],[{id:'a',status:'cancelled',amount:10,discount:0},{id:'a',status:'paid',amount:100,discount:0}],[{id:'a',status:'paid',amount:199,discount:1},{id:'b',status:'paid',amount:801,discount:2}],[{id:'p',status:'pending',amount:700,discount:0}],[{id:'p',status:'paid',amount:600,discount:0},{id:'q',status:'pending',amount:999,discount:0}],JSON.parse(tasks.find(t=>t.id==='code').files['orders.json']),Array.from({length:6},(_,i)=>({id:'cancel-'+i,status:'cancelled',amount:100,discount:0})),Array.from({length:6},(_,i)=>({id:'paid-'+i,status:'paid',amount:100,discount:0}))];
const expected=[0,80,0,0,18,0,997,0,600,1600,0,600];
const sb=s=>JSON.stringify(s);
export async function profileFor(source){
 const paths=['/bin','/sbin','/System','/usr','/Library/Apple','/private/var/db/dyld','/dev'];
 return `(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow file-read-metadata)(allow file-read* (literal "/") ${paths.map(p=>`(subpath ${sb(p)})`).join(' ')} (literal ${sb(await fs.realpath(process.execPath))}) (literal ${sb(await fs.realpath(runner))}) (literal ${sb(await fs.realpath(source))}) (literal ${sb(await fs.realpath(dirname(source)))}))`;
}
export async function sandboxEvaluate(source,hidden=true){
 source=resolve(source);
 if(process.platform!=='darwin')return {verified:false,reason:'sandbox-unavailable'};
 const vectors=hidden?hiddenVectors:visibleVectors,nonce=randomUUID(),profile=await profileFor(source);
 const result=await new Promise(resolve=>{
  const child=spawn('/usr/bin/sandbox-exec',['-p',profile,process.execPath,'--max-old-space-size=64','--max-semi-space-size=8',runner,source],{cwd:dirname(source),env:{PATH:'/usr/bin:/bin',LANG:'C'},stdio:['pipe','pipe','pipe'],detached:false});
  let stdout='',overflow=false;const kill=()=>{try{child.kill('SIGKILL');}catch{}};
  const timer=setTimeout(kill,5000);
  child.stdout.on('data',b=>{stdout+=b;if(stdout.length>100000){overflow=true;kill();}});child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);resolve({code:null,stdout:'',spawnFailed:true});});child.on('close',code=>{clearTimeout(timer);kill();resolve({code:overflow?null:code,stdout});});
  child.stdin.end(JSON.stringify({nonce,vectors}));
 });
 if(result.spawnFailed)return {verified:false,reason:'sandbox-unavailable'};
 try{const parsed=JSON.parse(result.stdout);return {verified:result.code===0&&parsed.nonce===nonce&&isDeepStrictEqual(parsed.actual,expected.slice(0,vectors.length)),reason:result.code===0?'vector-comparison':'sandbox-execution-failed',vectorCount:vectors.length,nonce,actual:parsed.actual};}catch{return {verified:false,reason:'missing-completion'};}
}
if(process.argv[2]==='--visible'){
 const result=await sandboxEvaluate(process.argv[3],false);if(result.verified)console.log('VISIBLE_VECTORS_PASSED:3');else{console.log('VISIBLE_VECTORS_FAILED');process.exitCode=1;}
}
