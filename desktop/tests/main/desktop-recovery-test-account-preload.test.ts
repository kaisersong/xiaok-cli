// @vitest-environment node
import {afterEach, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const fixture=fileURLToPath(new URL('../fixtures/desktop-post-seal-owner.ts',import.meta.url));
const preload=pathToFileURL(fileURLToPath(new URL('../fixtures/desktop-recovery-test-account-preload.mjs',import.meta.url))).href;
const cleanup:string[]=[];
afterEach(()=>{for(const root of cleanup.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:3});});
function temp(prefix:string,parent=realpathSync(tmpdir())){
  const root=realpathSync(mkdtempSync(join(parent,prefix)));cleanup.push(root);return root;
}
function layout(){
  const accountRoot=temp('xiaok-vitest-accounts-'),home=temp('account-',accountRoot),root=temp('xiaok-post-seal-process-');
  return {args:[fixture,root,'snapshot',accountRoot,home],home,accountRoot,root};
}
function run(args:string[],attack='',realHome=false){
  // Contract inspection only. The original BDD executes the real fixed fixture,
  // SQLite, scoped process, worktrees and physical process death separately.
  return spawnSync(process.execPath,['--input-type=module','-e',`
    import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';
    const before=os.userInfo(),bufferBefore=os.userInfo({encoding:'buffer'});
    ${attack}
    process.argv=[process.execPath,...${JSON.stringify(args)}];
    ${realHome?'process.argv[5]=before.homedir;':''}
    await import(${JSON.stringify(preload)});
    const after=os.userInfo(),bufferAfter=os.userInfo({encoding:'buffer'});
    const remaining=({...info})=>{delete info.homedir;return info;};
    const buffered=info=>Object.fromEntries(Object.entries(remaining(info)).map(([k,v])=>[k,Buffer.isBuffer(v)?v.toString('hex'):v]));
    console.log(JSON.stringify({before:remaining(before),after:remaining(after),bufferBefore:buffered(bufferBefore),bufferAfter:buffered(bufferAfter),home:after.homedir,bufferHome:bufferAfter.homedir.toString(),isBuffer:Buffer.isBuffer(bufferAfter.homedir),pid:process.pid}));
  `],{encoding:'utf8',timeout:4500,windowsHide:true});
}
it('preserves native worker identity when it inherits the parent account preload',()=>{
  const root=temp('xiaok-post-seal-process-'),entry=join(root,'native-worker.mjs');
  writeFileSync(entry,`
    import {parentPort,isMainThread} from 'node:worker_threads';
    import os from 'node:os';
    const before=os.userInfo(),bufferBefore=os.userInfo({encoding:'buffer'});
    await import(${JSON.stringify(preload)});
    const after=os.userInfo(),bufferAfter=os.userInfo({encoding:'buffer'});
    const encode=info=>Object.fromEntries(Object.entries(info).map(([key,value])=>[key,Buffer.isBuffer(value)?value.toString('hex'):value]));
    parentPort.postMessage({isMainThread,before,after,bufferBefore:encode(bufferBefore),bufferAfter:encode(bufferAfter)});
  `);
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import {Worker} from 'node:worker_threads';import os from 'node:os';
    const nativeIdentity=os.userInfo();
    const worker=new Worker(${JSON.stringify(entry)},{execArgv:['--import',${JSON.stringify(preload)}]});
    const messages=[];worker.on('message',value=>messages.push(value));
    worker.on('error',error=>{console.error(error);process.exitCode=1;});
    worker.on('exit',code=>console.log(JSON.stringify({code,messages,nativeIdentity})));
  `],{encoding:'utf8',timeout:4500,windowsHide:true});
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
  const proof=JSON.parse(result.stdout);expect(proof.code).toBe(0);expect(proof.messages).toHaveLength(1);
  expect(proof.messages[0].isMainThread).toBe(false);
  expect(proof.messages[0].before).toEqual(proof.nativeIdentity);
  expect(proof.messages[0].after).toEqual(proof.messages[0].before);
  expect(proof.messages[0].bufferAfter).toEqual(proof.messages[0].bufferBefore);
});
it.each([
 ['desktop-post-seal-owner.ts','xiaok-post-seal-process-'],
 ['desktop-post-seal-owner.ts','xiaok-post-seal-recovery-adversarial-seed-'],
 ['desktop-post-seal-owner.ts','xiaok-post-seal-host-authority-seed-'],
 ['desktop-post-seal-owner.ts','xiaok-post-seal-ready-'],
 ['desktop-post-seal-owner.ts','xiaok-post-seal-goal-seed-'],
 ['desktop-post-seal-goal-recovery-owner.ts','xiaok-post-seal-goal-bdd-'],
 ['desktop-source-recovery-owner.ts','xiaok-ma-recovery-'],
])('forwards native fields and encoding for %s under %s',(entry,prefix)=>{
  const {args,home}=layout();args[0]=fileURLToPath(new URL('../fixtures/'+entry,import.meta.url));args[1]=temp(prefix);const result=run(args);
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
  const proof=JSON.parse(result.stdout);expect(proof.after).toEqual(proof.before);
  expect(proof.bufferAfter).toEqual(proof.bufferBefore);expect(proof.home).toBe(home);
  expect(proof.bufferHome).toBe(home);expect(proof.isBuffer).toBe(true);expect(proof.pid).toBeGreaterThan(0);
});
it.each(['missing-home','real-home','wrong-entry','bad-account-root','nested-account-root','outside-temp-account-root','outside-account-home','bad-home','nested-root','short-root','long-root','invalid-root','symlink-home','symlink-root','unknown-platform','entry-root-mismatch'] as const)('rejects %s before production imports',scenario=>{
  const input=layout(),args=[...input.args];let attack='';
  if(scenario==='missing-home')args.pop();
  if(scenario==='wrong-entry')args[0]=fileURLToPath(import.meta.url);
  if(scenario==='bad-account-root')args[3]=temp('not-test-accounts-');
  if(scenario==='nested-account-root')args[3]=temp('xiaok-vitest-accounts-',temp('nested-'));
  if(scenario==='outside-temp-account-root')args[3]=temp('xiaok-vitest-accounts-',resolve('.'));
  if(scenario==='outside-account-home')args[4]=temp('account-');
  if(scenario==='bad-home')args[4]=temp('not-account-',input.accountRoot);
  if(scenario==='nested-root')args[1]=temp('xiaok-post-seal-process-',temp('nested-'));
  if(['short-root','long-root','invalid-root'].includes(scenario)){
    const suffix=basename(input.root).slice(-6);
    const invalid=scenario==='short-root'?suffix.slice(0,5):scenario==='long-root'?suffix+'A':'_'+suffix.slice(1);
    args[1]=join(dirname(input.root),'xiaok-post-seal-process-'+invalid);mkdirSync(args[1]);cleanup.push(args[1]);
  }
  if(scenario==='symlink-home'||scenario==='symlink-root'){
    const link=join(temp('links-'),'link');symlinkSync(scenario==='symlink-home'?input.home:input.root,link,process.platform==='win32'?'junction':'dir');args[scenario==='symlink-home'?4:1]=link;
  }
  if(scenario==='entry-root-mismatch')args[0]=fileURLToPath(new URL('../fixtures/desktop-post-seal-goal-recovery-owner.ts',import.meta.url));
  if(scenario==='unknown-platform')attack="Object.defineProperty(process,'platform',{value:'test-unsupported'});";
  const result=run(args,attack,scenario==='real-home');
  expect(result.status,result.stderr).not.toBe(0);expect(result.stderr).toMatch(/test_account_.*(?:denied|required)/);
});
it.skipIf(process.platform==='win32')('rejects a POSIX UID mismatch without an OS qualification claim',()=>{
  const {args}=layout();const result=run(args,`const original=os.userInfo;os.userInfo=options=>({...original(options),uid:before.uid+1});syncBuiltinESMExports();`);
  expect(result.status,result.stderr).not.toBe(0);expect(result.stderr).toContain('test_account_owner_denied');
});
