import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('original DSH Source and Store serve actual Native user IPC after original application window replacement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-window-native-'));let application:Awaited<ReturnType<typeof electron.launch>>|undefined;
 const compiled=process.env.XIAOK_DSH_USER_NATIVE_COMPILED;if(!compiled)throw Error('isolated_compilation_required');
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/main-dsh-control-window-owner.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_DSH_USER_NATIVE_ROOT:root,XIAOK_DSH_USER_NATIVE_COMPILED:compiled}});
  const child=application.process();console.log(JSON.stringify({test:'dsh-window-owner-native',pid:child.pid,phase:'started'}));
  child.stderr?.on('data',value=>console.log('window-owner-native-stderr: '+String(value)));
  await expect.poll(async()=>{try{return await application!.evaluate(()=>Boolean((globalThis as any).dshWindowOwnerNative?.ready));}catch(error){if(child.exitCode!==null)throw error;return false;}},{timeout:15000}).toBe(true);expect(await application.evaluate(()=>(globalThis as any).dshWindowOwnerNative.error)).toBeUndefined();
  const first=await application.firstWindow();await first.locator('#control').click();await expect(first.locator('#result')).toContainText('"calls":1');const original=JSON.parse(await first.locator('#result').innerText());expect(original).toMatchObject({nativeSender:true,nativeFrame:true,originalStore:true});
  const nextPage=application.waitForEvent('window');const replacement=await application.evaluate(async()=>(globalThis as any).dshWindowOwnerNative.replace());expect(replacement).toMatchObject({oldRevoked:true,boots:1,views:1});
  const second=await nextPage;await second.locator('#control').click();await expect(second.locator('#result')).toContainText('"calls":2');const next=JSON.parse(await second.locator('#result').innerText());expect(next).toMatchObject({nativeSender:true,nativeFrame:true,originalStore:true,principalId:original.principalId});expect(next.windowId).not.toBe(original.windowId);
  const closing=await application.evaluate(async()=>(globalThis as any).dshWindowOwnerNative.close());expect(closing).toMatchObject({boots:1,views:1,calls:2,oldStillRevoked:true,newRevokedOnClose:true,sameSourceAndStore:true});
  console.log(JSON.stringify({original,replacement,next,closing}));const evidence=process.env.XIAOK_DSH_USER_NATIVE_EVIDENCE;if(evidence)writeFileSync(evidence,JSON.stringify({pid:child.pid,original,replacement,next,closing},null,2));
 }finally{if(application){const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({test:'dsh-window-owner-native',pid:child.pid,exitCode:child.exitCode,reaped:true}));}rmSync(root,{recursive:true,force:true});}
});
