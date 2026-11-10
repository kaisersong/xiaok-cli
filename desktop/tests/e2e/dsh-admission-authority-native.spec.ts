import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('A6 Native user configuration cannot bypass global mode and current Source authority',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-a6-native-'));const compiled=process.env.XIAOK_DSH_A6_NATIVE_COMPILED;if(!compiled)throw Error('isolated_compilation_required');let application:Awaited<ReturnType<typeof electron.launch>>|undefined;
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/dsh-admission-authority-native.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_DSH_A6_NATIVE_ROOT:root,XIAOK_DSH_A6_NATIVE_COMPILED:compiled}});
  const child=application.process();console.log(JSON.stringify({pid:child.pid,test:'a6-native-source-config',phase:'started'}));
  let startupObservationMisses=0;
  await expect.poll(async()=>{try{return await application!.evaluate(()=>Boolean((globalThis as any).dshA6Native?.ready));}catch(error){if(!String(error).includes('Execution context was destroyed'))throw error;startupObservationMisses++;return false;}},{timeout:15000}).toBe(true);console.log(JSON.stringify({startupObservationMisses}));expect(await application.evaluate(()=>(globalThis as any).dshA6Native.error)).toBeUndefined();
  const page=await application.firstWindow();let count=0;async function click(id:string){await page.locator('#result').evaluate(e=>e.textContent='');await page.locator('#'+id).click();await expect(page.locator('#result')).not.toBeEmpty();const value=JSON.parse(await page.locator('#result').innerText());console.log(JSON.stringify({step:++count,id,value}));return value;}
  expect(await click('enroll')).toMatchObject({ok:true,qualified:false,enrollment:{state:'pending_baseline',authorityEpoch:1,budget:null}});
  expect(await click('setup')).toMatchObject({ok:true,configuration:{revision:1}});
  expect(await click('read')).toMatchObject({failure:'DSH_A_SOURCE_BASELINE_UNCONFIRMED',noHttpIssued:true});
  expect(await click('observe')).toEqual({explicitModePrefixes:3});
  const admitted=await click('read');expect(admitted).toMatchObject({kind:'source_setup',prefixes:3,mode:'observe',noFakeBinding:true,current:true,noHttpIssued:true});
  expect(await click('pure')).toEqual({filesystemCalls:0});
  expect(await click('off')).toMatchObject({ok:true,control:{value:{mode:'off'},epoch:2}});
  expect(await click('probe')).toEqual({oldLocalRejected:true,oldCurrentRejected:true});
  const closing=await application.evaluate(async()=>(globalThis as any).dshA6Native.close());expect(closing).toMatchObject({sourceKnown:true,storeClosed:true});
  if(process.env.XIAOK_DSH_A6_NATIVE_EVIDENCE)writeFileSync(process.env.XIAOK_DSH_A6_NATIVE_EVIDENCE,JSON.stringify({pid:child.pid,admitted,closing},null,2));
 }finally{if(application){const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({pid:child.pid,exitCode:child.exitCode,reaped:true,test:'a6-native-source-config'}));}rmSync(root,{recursive:true,force:true});}
});
