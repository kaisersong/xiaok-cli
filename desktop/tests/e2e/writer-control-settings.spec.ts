import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import net from 'node:net';
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
async function freePort(port:number){const server=net.createServer();await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});await new Promise<void>(resolve=>server.close(()=>resolve()));}
function descendants(root:number){
 const rows=execFileSync('ps',['-ax','-o','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
 const owned=new Set([root]);let changed=true;while(changed){changed=false;for(const [pid,parent]of rows)if(owned.has(parent!)&&!owned.has(pid!)){owned.add(pid!);changed=true;}}
 return [...owned];
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}
function birth(pid:number){try{return execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8'}).trim();}catch{return '';}}
test('actual production Main and live settings prepare their owned empty Server without enabling execution',async()=>{
 test.setTimeout(150000);await freePort(4318);await freePort(4400);
 // Reuse the existing narrowly admitted ordinary-UI account fixture namespace.
 // It changes only userInfo.homedir in Main; it is not Native/SDK qualification.
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));
 for(const name of ['config','profile','workspace','home','kswarm'])mkdirSync(join(root,name),{mode:0o700});
 const evidence=process.env.XIAOK_WRITER_E2E_EVIDENCE||join(root,'evidence');mkdirSync(evidence,{recursive:true});
 const facts:Record<string,unknown>[]=[];const record=(value:Record<string,unknown>)=>{facts.push({at:Date.now(),...value});writeFileSync(join(evidence,'facts.json'),JSON.stringify({root,browser:'Browser plugin not available; repository Playwright/Electron',facts},null,2));};
 let application:ElectronApplication|undefined,page:Page|undefined;let pids:number[]=[];let closed=false;
 const log=createWriteStream(join(evidence,'main.log'));
 record({phase:'fixture-created',root});
 try{
  application=await electron.launch({cwd:join(root,'workspace'),args:['-r',join(desktop,'tests/e2e/fixtures/ordinary-ui-account-binding.cjs'),join(desktop,'dist/main/desktop/electron/main.js'),'--user-data-dir='+join(root,'profile')],env:{...process.env,
   NODE_ENV:'test',HOME:join(root,'home'),USERPROFILE:join(root,'home'),XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_NODE_CMD:process.execPath,
   XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE:'1',XIAOK_DISABLE_GLOBAL_PLUGINS:'1',KSWARM_DATA_ROOT:join(root,'kswarm'),
   KSWARM_SERVER_PATH:resolve(desktop,'../../kswarm/src/server/index.js'),BROKER_SERVER_PATH:resolve(desktop,'../../intent-broker/src/cli.js'),INTENT_BROKER_DB:join(root,'broker.sqlite'),
  }});
  const child=application.process();record({phase:'main-launched',pid:child.pid,entry:join(desktop,'dist/main/desktop/electron/main.js')});child.stdout?.pipe(log,{end:false});child.stderr?.pipe(log,{end:false});
  page=await application.firstWindow();const errors:string[]=[];page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');await expect(page.locator('body')).not.toBeEmpty();
  record({phase:'page-identity',url:page.url(),title:await page.title(),body:await page.locator('body').innerText()});expect(page.url()).toContain('/dist/renderer/index.html');
  await page.screenshot({path:join(evidence,'entry.png'),fullPage:false});
  await page.getByRole('button').filter({has:page.locator('svg.lucide-bolt')}).click({timeout:10000});
  const panel=page.getByRole('region',{name:'项目数据准备'});await expect(panel).toBeVisible({timeout:20000});
  await expect.poll(async()=>{try{return (await fetch('http://127.0.0.1:4400/health')).ok;}catch{return false;}},{timeout:20000}).toBe(true);
  await expect.poll(()=>page!.evaluate(async()=>Boolean((await (window as any).xiaokDesktop.kswarmGetStatus()).running)),{timeout:20000}).toBe(true);
  await panel.getByRole('button',{name:'读取准备状态'}).click();await page.screenshot({path:join(evidence,'settings-observed.png'),fullPage:false});record({phase:'settings-observed',status:await panel.innerText(),errors});
  await expect(panel.getByRole('button',{name:'准备新工作区'})).toBeEnabled({timeout:20000});await expect(panel.getByRole('button',{name:'自动执行升级暂不可用'})).toBeDisabled();
  await page.screenshot({path:join(evidence,'before.png'),fullPage:false});
  pids=descendants(child.pid!);record({phase:'before-prepare',ownedPids:pids,status:await panel.innerText(),errors});
  await panel.getByRole('button',{name:'准备新工作区'}).click();await expect(panel.getByRole('button',{name:'准备中',exact:true})).toHaveCount(0,{timeout:15000});
  record({phase:'after-prepare',status:await panel.innerText(),errors});await page.screenshot({path:join(evidence,'after.png'),fullPage:false});
  const db=new DatabaseSync(join(root,'kswarm/state.sqlite'),{readOnly:true});try{record({phase:'physical-floor',rows:db.prepare("SELECT meta_value FROM state_meta WHERE meta_key='writer_floor_v1'").all()});}finally{db.close();}
  await expect(panel.getByText('项目数据存储已准备',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'自动执行升级暂不可用'})).toBeDisabled();
  await panel.getByRole('button',{name:'读取准备状态'}).click();await expect(panel.getByText('项目数据存储已准备',{exact:true})).toBeVisible();
  await page.setViewportSize({width:820,height:900});await page.screenshot({path:join(evidence,'compact.png'),fullPage:false});
  expect(await page.locator('vite-error-overlay').count()).toBe(0);record({phase:'verified',errors,overlay:0});
 }catch(error){record({phase:'body-failed',message:String(error)});if(page&&!page.isClosed())try{record({phase:'failed-dom',body:await page.locator('body').innerText()});await page.screenshot({path:join(evidence,'failed.png'),fullPage:false});}catch{}throw error;}finally{
  if(application){const main=application.process();if(main.pid)pids=[...new Set([...pids,...descendants(main.pid)])];
   const identities=new Map(pids.map(pid=>[pid,birth(pid)]));let closeDeadline:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([application.close(),new Promise<never>((_,reject)=>{closeDeadline=setTimeout(()=>reject(Error('actual_Main_close_unconfirmed')),40000);})]);closed=true;}
   catch(error){record({phase:'close-error',message:String(error),ownedIdentities:Object.fromEntries(identities)});
    for(const pid of pids)if(identities.get(pid)&&birth(pid)===identities.get(pid))try{process.kill(pid,'SIGTERM');}catch{}
    for(let n=0;n<50&&pids.some(alive);n++)await new Promise(resolve=>setTimeout(resolve,50));
    for(const pid of pids)if(identities.get(pid)&&birth(pid)===identities.get(pid))try{process.kill(pid,'SIGKILL');}catch{}
   }finally{if(closeDeadline)clearTimeout(closeDeadline);}
   for(let n=0;n<100&&pids.some(alive);n++)await new Promise(resolve=>setTimeout(resolve,50));
   const remaining=pids.filter(pid=>alive(pid)&&identities.get(pid)&&birth(pid)===identities.get(pid));
   if(remaining.length){record({phase:'isolated-background-cleanup',ownedPids:remaining,productionRealCloseQualified:false});for(const pid of remaining)try{process.kill(pid,'SIGTERM');}catch{}
    for(let n=0;n<100&&remaining.some(alive);n++)await new Promise(resolve=>setTimeout(resolve,50));
    for(const pid of remaining)if(identities.get(pid)&&birth(pid)===identities.get(pid))try{process.kill(pid,'SIGKILL');}catch{}
    for(let n=0;n<100&&remaining.some(alive);n++)await new Promise(resolve=>setTimeout(resolve,50));
   }
   record({phase:'cleanup',mainClosed:closed,ownedCount:pids.length,ownedPids:pids,stillRunning:pids.filter(alive)});
  }log.end();
 }
 expect(pids.filter(alive)).toEqual([]);expect(closed).toBe(true);
});
