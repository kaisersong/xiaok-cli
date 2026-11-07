import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,readFileSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const desktop=resolve('.');
async function free(port:number){const s=createServer();await new Promise<void>((yes,no)=>{s.once('error',no);s.listen(port,'127.0.0.1',yes);});await new Promise<void>(yes=>s.close(()=>yes()));}
function birth(pid:number){try{return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim();}catch{return '';}}
function descendants(pid:number){const rows=execFileSync('/bin/ps',['-ax','-o','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),owned=new Set([pid]);let changed=true;while(changed){changed=false;for(const [child,parent]of rows)if(owned.has(parent!)&&!owned.has(child!)){owned.add(child!);changed=true;}}return [...owned];}
test('production Main original A and actual preload semantic API capture one stable B operation',async()=>{
 test.skip(process.platform==='win32','macOS PID identity fixture; Windows installed gate stays open.');test.setTimeout(100000);for(const p of [4318,4400,47891])await free(p);
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));for(const name of ['config','profile','workspace','home','kswarm'])mkdirSync(join(root,name),{mode:0o700});
 const evidence=process.env.XIAOK_DISPATCH_PRODUCT_EVIDENCE||join(root,'evidence');mkdirSync(evidence,{recursive:true});const facts:unknown[]=[],record=(value:unknown)=>{facts.push(value);writeFileSync(join(evidence,'facts.json'),JSON.stringify({root,facts},null,2));};
 const scope={profileId:createHash('sha256').update(resolve(root,'config','desktop')).digest('hex'),workspaceId:createHash('sha256').update(realpathSync(join(root,'workspace'))).digest('hex')};
 const seed=execFileSync(process.execPath,[join(desktop,'tests/e2e/fixtures/default-dispatch-product-seed.mjs')],{env:{...process.env,DISPATCH_PRODUCT_SEED_ROOT:join(root,'kswarm'),DISPATCH_PRODUCT_SEED_SCOPE:JSON.stringify(scope)},encoding:'utf8'});record({phase:'controlled-storage-seed',output:seed,notNativeMainProof:true});
 let application:Awaited<ReturnType<typeof electron.launch>>|undefined;const owned=new Map<number,string>();const snapshot=()=>{if(!application?.process().pid)return;for(const pid of descendants(application.process().pid!))if(!owned.has(pid)){const b=birth(pid);if(b)owned.set(pid,b);}record({phase:'owned-identities',identities:Object.fromEntries(owned)});};const log=createWriteStream(join(evidence,'main.log'));
 try{
  application=await electron.launch({cwd:join(root,'workspace'),args:['-r',join(desktop,'tests/e2e/fixtures/ordinary-ui-account-binding.cjs'),join(desktop,'dist/main/desktop/electron/main.js'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',HOME:join(root,'home'),USERPROFILE:join(root,'home'),XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_NODE_CMD:process.execPath,XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE:'1',XIAOK_DISABLE_GLOBAL_PLUGINS:'1',KSWARM_DATA_ROOT:join(root,'kswarm'),KSWARM_SERVER_PATH:resolve(desktop,'../../kswarm/src/server/index.js'),BROKER_SERVER_PATH:resolve(desktop,'../../intent-broker/src/cli.js'),INTENT_BROKER_DB:join(root,'broker.sqlite')}});
  const child=application.process();snapshot();child.stdout?.pipe(log,{end:false});child.stderr?.pipe(log,{end:false});const page=await application.firstWindow();page.on('pageerror',error=>record({phase:'renderer-error',error:String(error)}));page.on('console',message=>{if(message.type()==='error')record({phase:'renderer-console-error',message:message.text()});});await page.waitForLoadState('domcontentloaded');await expect.poll(()=>page.evaluate(async()=>Boolean((await (window as any).xiaokDesktop.kswarmGetStatus()).running)),{timeout:25000}).toBe(true);
  const first=await page.evaluate(async()=>(window as any).xiaokDesktop.captureDefaultDispatchOperation({projectId:'p'}));record({phase:'first-original-main-receipt',first});expect(first.ok).toBe(true);expect(first.operation.parentId).toMatch(/^default-dispatch-parent:/);
  const second=await page.evaluate(async()=>(window as any).xiaokDesktop.captureDefaultDispatchOperation({projectId:'p'}));record({phase:'second-original-main-receipt',second});expect(second).toEqual(first);
  await page.goto(page.url().split('#')[0]+'#/projects/p');record({phase:'actual-project-detail',url:page.url(),title:await page.title(),body:await page.locator('body').innerText(),detail:await page.evaluate(async()=>(window as any).xiaokDesktop.kswarmProxyGet('/projects/p'))});await page.screenshot({path:join(evidence,'project-before.png'),fullPage:false});
  await page.getByRole('button',{name:'分发任务',exact:true}).click({timeout:6000});await expect(page.getByText('已记录 1 个任务的执行请求，尚未开始执行。',{exact:true})).toBeVisible();await page.screenshot({path:join(evidence,'project-after.png'),fullPage:false});record({phase:'actual-dispatch-button',body:await page.locator('body').innerText()});
  const denied=await page.evaluate(async()=>(window as any).xiaokDesktop.kswarmProxyPost('/projects/p/dispatch',{fromAgent:'po'}));record({phase:'old-generic-dispatch',denied});expect(denied).toMatchObject({ok:false,code:'default_dispatch_requires_user_action'});

 }finally{
  if(application){snapshot();const child=application.process();try{await Promise.race([application.close(),delay(15000).then(()=>{throw Error('product Main close unconfirmed');})]);}catch(error){record({phase:'Main-close-unconfirmed',error:String(error)});}for(const [pid,b]of [...owned])if(birth(pid)===b)for(const p of descendants(pid))if(!owned.has(p)){const now=birth(p);if(now)owned.set(p,now);}let signals=0;for(const [pid,b]of owned)if(birth(pid)===b){process.kill(pid,'SIGTERM');signals++;}for(let n=0;n<200&&[...owned].some(([pid,b])=>birth(pid)===b);n++)await delay(10);record({phase:'fixture-cleanup',mainPid:child.pid,mainExit:child.exitCode,signals,remaining:[...owned].filter(([pid,b])=>birth(pid)===b),notProductionPhysicalClose:true});}log.end();
 }
});
