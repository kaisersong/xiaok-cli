import{expect,test,_electron as electron,type ElectronApplication}from'@playwright/test';
import{mkdtempSync,mkdirSync,readFileSync,existsSync,writeFileSync}from'node:fs';
import{join,dirname}from'node:path';import{tmpdir}from'node:os';import{fileURLToPath}from'node:url';
import type{ChildProcess}from'node:child_process';
const desktop=join(dirname(fileURLToPath(import.meta.url)),'..','..');

for(const ownerMode of ['local','attached'] as const)test(`default Main ${ownerMode} Native task exposes two actual approvals and answers each once in the rendered panel`,async()=>{
  test.setTimeout(60000);const root=mkdtempSync(join(tmpdir(),'xiaok-activity-electron-'));
  for(const name of['config','workspace','profile','plugins'])mkdirSync(join(root,name));
  const facts:Array<Record<string,unknown>>=[];const record=(value:Record<string,unknown>)=>{facts.push({at:Date.now(),...value});writeFileSync(join(root,'native-ui-evidence.json'),JSON.stringify(facts,null,2));};
  let application:ElectronApplication|undefined,child:ChildProcess|undefined,closed:Promise<void>|undefined,ownerPid:number|undefined;
  try{
    application=await electron.launch({args:[join(desktop,'tests/e2e/fixtures/multi-agent-electron-main.mjs')],env:{...process.env,NODE_ENV:'test',XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_E2E_USER_DATA:join(root,'profile'),XIAOK_MULTI_AGENT_E2E_ROOT:root,XIAOK_MULTI_AGENT_E2E_PROVIDER:'http://127.0.0.1:1/v1',XIAOK_NATIVE_APPROVAL_E2E:'1',XIAOK_ACTIVITY_E2E_OWNER:ownerMode==='attached'?'daemon':'local',XIAOK_E2E_BACKGROUND:'1',XIAOK_DISABLE_GLOBAL_PLUGINS:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'1'}});
    child=application.process();closed=new Promise(resolve=>child!.once('close',()=>resolve()));record({phase:'main-launched',pid:child.pid});
    const page=await application.firstWindow();await page.waitForLoadState('domcontentloaded');const pageErrors:string[]=[],consoleErrors:string[]=[];
    page.on('pageerror',error=>pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    if(ownerMode==='attached'){const status=JSON.parse(readFileSync(join(root,'data','activity-owner.status.json'),'utf8'));ownerPid=status.pid;expect(ownerPid).not.toBe(child.pid);record({phase:'owner-started',pid:ownerPid,ownerEpoch:status.ownerEpoch});}else record({phase:'local-original-owner',pid:child.pid});
    await page.evaluate(async()=>{
      const request=indexedDB.open('xiaok-desktop',1);const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('threads'))request.result.createObjectStore('threads',{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const tx=db.transaction('threads','readwrite');tx.objectStore('threads').put({id:'native-ui-thread',title:'Native approvals',status:'idle',mode:'chat',createdAt:Date.now(),updatedAt:Date.now(),taskIds:[],currentTaskId:null});await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();location.hash='#/t/native-ui-thread';
    });
    const composer=page.locator('.chat-right-main textarea');await expect(composer).toBeVisible();await composer.fill('Read this temporary workspace.');await composer.press('Enter');
    await expect.poll(()=>existsSync(join(root,'native-client.jsonl'))&&readFileSync(join(root,'native-client.jsonl'),'utf8').includes('turn-started')).toBe(true);
    await composer.fill('保留的中文\n草稿');await application.evaluate(()=>{(globalThis as any).multiAgentE2E.releaseNativeApprovals();});
    const panel=page.getByTestId('conversation-activity');await expect(panel.getByTestId(/^native-question-/)).toHaveCount(2,{timeout:20000});
    await expect(page.getByTestId(/^native-question-/)).toHaveCount(2);await expect(composer).toBeDisabled();
    expect(await page.url()).toContain('#/t/native-ui-thread');record({phase:'page-identity',url:page.url(),title:await page.title(),questionCount:2});
    await page.screenshot({path:join(root,'native-two-questions.png')});
    const views=await page.evaluate(async()=>{const activities=await window.xiaokDesktop.getConversationActivities({threadId:'native-ui-thread',limit:200});const watchId=activities.at(-1)!.watchId;return{view:await window.xiaokDesktop.getWorkActivity(watchId),forms:await window.xiaokDesktop.getNativeActivityQuestions(watchId)};});
    expect(views.view.questionSourceKind).toBe('codex_native_approval');expect(views.forms).toHaveLength(2);record({phase:'actual-main-inventory',watchId:views.view.watch.watchId,taskId:views.view.watch.workId,questionIds:views.forms.map(form=>form.questionId)});
    const first=panel.getByTestId(/^native-question-/).filter({hasText:'native-read-first'});await first.getByRole('button',{name:'拒绝',exact:true}).click();
    await expect(panel.getByTestId(/^native-question-/)).toHaveCount(1);await expect(panel.getByTestId(/^native-question-/)).toContainText('native-read-second');await expect(composer).toBeDisabled();await expect(composer).toHaveValue('保留的中文\n草稿');await page.screenshot({path:join(root,'native-one-question.png')});
    await application.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0]!.setSize(820,940);});await page.screenshot({path:join(root,'native-narrow-question.png')});
    await panel.getByRole('button',{name:'允许一次',exact:true}).click();await expect(panel.getByTestId(/^native-question-/)).toHaveCount(0);await expect(panel).toContainText('已完成');await expect(composer).toHaveValue('保留的中文\n草稿');
    const log=readFileSync(join(root,'native-client.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));expect(log.filter(row=>row.type==='client-created')).toHaveLength(1);expect(log.filter(row=>row.type==='turn-started')).toHaveLength(1);expect(log.filter(row=>row.type==='decision')).toEqual([{type:'decision',command:'native-read-first',result:{decision:'decline'}},{type:'decision',command:'native-read-second',result:{decision:'accept'}}]);
    expect(pageErrors).toEqual([]);record({phase:'passed',nativeClientCount:1,nativeTurnCount:1,decisions:log.filter(row=>row.type==='decision'),pageErrors,consoleErrors,browserPlugin:'absent; repository Playwright/Electron fallback',ownerMode,qualification:'actual compiled Main/Bridge/Native/original local or attached owner/SQLite/IPC/preload/renderer; controlled Native transport, no vendor CLI or installed Windows qualification'});await page.screenshot({path:join(root,'native-completed.png')});
  }finally{
    const cleanupErrors:unknown[]=[];
    try{if(application)await application.close();if(closed)await closed;record({phase:'main-closed',pid:child?.pid,exitCode:child?.exitCode,signalCode:child?.signalCode});}catch(error){cleanupErrors.push(error);}
    const statusPath=join(root,'data','activity-owner.status.json');if(!ownerPid&&existsSync(statusPath))ownerPid=JSON.parse(readFileSync(statusPath,'utf8')).pid;
    if(ownerPid)try{try{process.kill(ownerPid,'SIGTERM');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}await expect.poll(()=>{try{process.kill(ownerPid!,0);return true;}catch{return false;}}).toBe(false);record({phase:'owner-closed',pid:ownerPid,remainingOwnedBackgroundProcesses:0});}catch(error){cleanupErrors.push(error);}
    console.log(`Native UI evidence: ${root}`);if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'native_ui_cleanup_unconfirmed');
  }
});
