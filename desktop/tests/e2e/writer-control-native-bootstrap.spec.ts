import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
test('actual Electron native bootstrap rejects copies and keeps only the original source/service/session launch',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));for(const name of ['home','profile','config'])mkdirSync(join(root,name));
 const resultFile=join(root,'bootstrap-result.json'),evidence=process.env.XIAOK_WRITER_BOOTSTRAP_EVIDENCE;let application:Awaited<ReturnType<typeof electron.launch>>|undefined;let log='';
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/writer-control-native-bootstrap.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,HOME:join(root,'home'),USERPROFILE:join(root,'home'),XIAOK_CONFIG_DIR:join(root,'config'),NODE_ENV:'test',XIAOK_WRITER_BOOTSTRAP_RESULT_FILE:resultFile}});
  application.process().stdout?.on('data',chunk=>{log+=String(chunk);});application.process().stderr?.on('data',chunk=>{log+=String(chunk);});
  await expect.poll(()=>existsSync(resultFile),{timeout:15000}).toBe(true);
  const result=JSON.parse(readFileSync(resultFile,'utf8'));expect(result.processPid).toBe(application.process().pid);if(evidence)writeFileSync(evidence,JSON.stringify({browser:'Browser plugin unavailable; repository Playwright/Electron',root,result},null,2));
  expect(result.error).toBeUndefined();expect(result.getterCalls).toBe(0);expect(result.nativeAppReady).toBe(true);expect(Object.keys(result.cases)).toHaveLength(23);expect(Object.values(result.cases).every(value=>value===true)).toBe(true);
 }finally{
  if(application){const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({test:'native-bootstrap-owned-electron',pid:child.pid,exitCode:child.exitCode,reaped:true}));}
  if(evidence)writeFileSync(evidence+'.log',log);rmSync(root,{recursive:true,force:true});
 }
});
