import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('Main DSH user provenance uses an actual Native event and original Store, then revokes and drains SDK tails',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-user-native-'));let application:Awaited<ReturnType<typeof electron.launch>>|undefined;
 const compiled=process.env.XIAOK_DSH_USER_NATIVE_COMPILED;if(!compiled)throw Error('isolated_compilation_required');
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/main-dsh-control-native.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_DSH_USER_NATIVE_ROOT:root,XIAOK_DSH_USER_NATIVE_COMPILED:compiled}});
  const child=application.process();console.log(JSON.stringify({test:'main-dsh-control-native',pid:child.pid,phase:'started'}));
  await expect.poll(()=>application!.evaluate(()=>Boolean((globalThis as any).dshUserNative?.ready)),{timeout:15000}).toBe(true);expect(await application.evaluate(()=>(globalThis as any).dshUserNative.error)).toBeUndefined();
  const page=await application.firstWindow();await page.locator('#control').click();await expect(page.locator('#result')).toContainText('originalStoreBinding');const first=JSON.parse(await page.locator('#result').innerText());expect(first).toMatchObject({calls:1,purpose:'mandate_control',nativeSender:true,nativeMainFrame:true,originalStoreBinding:true,noAuthorityEpoch:true});
  const navigation=await application.evaluate(async()=>(globalThis as any).dshUserNative.navigate());expect(navigation.revoked).toBe(true);await page.locator('#control').click();await expect(page.locator('#result')).toContainText('"calls":2');
  const sdk=await application.evaluate(async()=>(globalThis as any).dshUserNative.probe());expect(sdk).toMatchObject({nativeCalls:1,rawIdentity:true,signalRevoked:true,heldUntilBothSettled:true});
  const closing=await application.evaluate(async()=>(globalThis as any).dshUserNative.close());expect(closing.allRevoked).toBe(true);expect(closing.after).toEqual(closing.baseline);
  console.log(JSON.stringify({first,navigation,sdk,closing}));const evidence=process.env.XIAOK_DSH_USER_NATIVE_EVIDENCE;if(evidence)writeFileSync(evidence,JSON.stringify({pid:child.pid,first,navigation,sdk,closing},null,2));
 }finally{if(application){const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({test:'main-dsh-control-native',pid:child.pid,exitCode:child.exitCode,reaped:true}));}rmSync(root,{recursive:true,force:true});}
});
