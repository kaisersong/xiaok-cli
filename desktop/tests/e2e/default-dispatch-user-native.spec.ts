import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('original Main A accepts a real Native user IPC and revokes old dispatch proof after reload',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));let application:Awaited<ReturnType<typeof electron.launch>>|undefined;let log='';const evidence=process.env.XIAOK_DISPATCH_USER_NATIVE_EVIDENCE;
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/default-dispatch-user-native.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_DISPATCH_SOURCE_FIXTURE_ROOT:root}});
  const child=application.process();child.stdout?.on('data',chunk=>{log+=String(chunk);});child.stderr?.on('data',chunk=>{log+=String(chunk);});
  await expect.poll(()=>application!.evaluate(()=>Boolean((globalThis as any).dispatchUserNative?.ready)),{timeout:15000}).toBe(true);
  const startup=await application.evaluate(()=>(globalThis as any).dispatchUserNative.error);expect(startup).toBeUndefined();
  const page=await application.firstWindow();await page.locator('#dispatch').click();await expect(page.locator('#result')).toContainText('main-default-dispatch:');const first=JSON.parse(await page.locator('#result').innerText());
  await page.locator('#dispatch').click();await expect(page.locator('#result')).toContainText('"calls":2');const second=JSON.parse(await page.locator('#result').innerText());expect(first.actionId).toBe(second.actionId);expect(second.journalFiles).toBe(1);expect(second.nativeSender).toBe(true);expect(second.nativeMainFrame).toBe(true);expect(second.ready).toBe(true);
  expect(second.originalBootstrap).toBe(true);expect(second.originalABinding).toBe(true);
  const navigation=await application.evaluate(async()=>(globalThis as any).dispatchUserNative.navigate());expect(navigation.revoked).toBe(true);expect(navigation.bootstrapStillSameSession).toBe(true);
  await page.locator('#dispatch').click();await expect(page.locator('#result')).toContainText('"calls":3');const third=JSON.parse(await page.locator('#result').innerText());expect(third.actionId).toBe(first.actionId);expect(third.journalFiles).toBe(1);
  const closing=await application.evaluate(async()=>(globalThis as any).dispatchUserNative.close());expect(closing.allRevoked).toBe(true);expect(closing.bootstrapRevoked).toBe(true);expect(closing.after).toEqual(closing.baseline);
  if(evidence)writeFileSync(evidence,JSON.stringify({browser:'Browser plugin unavailable; repository Playwright/Electron',pid:child.pid,first,second,third,navigation,closing},null,2));
 }finally{if(application){try{const events=await application.evaluate(()=>(globalThis as any).dispatchUserNative?.events);console.log(JSON.stringify({nativeEvents:events}));if(evidence)writeFileSync(evidence+'.events.json',JSON.stringify(events,null,2));}catch{}const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({test:'default-dispatch-user-native',pid:child.pid,exitCode:child.exitCode,reaped:true,ownedBusinessProcesses:0}));}if(evidence)writeFileSync(evidence+'.log',log);rmSync(root,{recursive:true,force:true});}
});

test('original Native Main Source owns SDK wrapper errors and dynamic raw siblings until real settlement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-user-source-sdk-e2e-'));let application:Awaited<ReturnType<typeof electron.launch>>|undefined;const evidence=process.env.XIAOK_DISPATCH_USER_NATIVE_EVIDENCE;
 try{application=await electron.launch({args:[resolve('tests/e2e/fixtures/default-dispatch-user-native.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_DISPATCH_SOURCE_FIXTURE_ROOT:root}});await expect.poll(()=>application!.evaluate(()=>Boolean((globalThis as any).dispatchUserNative?.ready)),{timeout:15000}).toBe(true);expect(await application.evaluate(()=>(globalThis as any).dispatchUserNative.error)).toBeUndefined();
  const facts=[];for(const kind of ['fulfilled','rejected','stack','returned']){const fact=await application.evaluate(async(_electron,kind)=>(globalThis as any).dispatchUserNative.probeSdkFate(kind),kind);expect(fact).toMatchObject({kind,nativeCalls:1,actualNativeCalledBeforeFault:true,heldAfterFirstOutcome:true,heldUntilSecondSettlement:true,sourceRemainsDenied:true});facts.push(fact);}
  if(evidence)writeFileSync(evidence+'.sdk-fates.json',JSON.stringify({pid:application.process().pid,facts,notFullProfile:true},null,2));
 }finally{if(application){const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({test:'default-dispatch-user-sdk-fates',pid:child.pid,exitCode:child.exitCode,reaped:true,notFullProductMain:true}));}rmSync(root,{recursive:true,force:true});}
});
