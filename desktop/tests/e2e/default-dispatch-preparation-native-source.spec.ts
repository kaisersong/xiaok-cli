import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
test('independent preparation source uses actual Native membership without borrowing user bootstrap authority',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));for(const name of ['profile','config'])mkdirSync(join(root,name));
 const resultFile=join(root,'preparation-result.json'),evidence=process.env.XIAOK_PREPARATION_NATIVE_EVIDENCE;
 let application:Awaited<ReturnType<typeof electron.launch>>|undefined,log='',bodyError:unknown;
 const cleanupErrors:unknown[]=[];
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/default-dispatch-preparation-native-source.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,XIAOK_CONFIG_DIR:join(root,'config'),NODE_ENV:'test',XIAOK_PREPARATION_NATIVE_RESULT_FILE:resultFile}});
  const child=application.process();console.log(JSON.stringify({test:'preparation-native-owned-start',pid:child.pid,fixtureRoot:root}));
  child.stdout?.on('data',chunk=>{log+=String(chunk);});child.stderr?.on('data',chunk=>{log+=String(chunk);});
  await expect.poll(()=>existsSync(resultFile),{timeout:15000}).toBe(true);
  const result=JSON.parse(readFileSync(resultFile,'utf8'));expect(result.processPid).toBe(child.pid);if(evidence)writeFileSync(evidence,JSON.stringify({root,result},null,2));
  expect(result.error).toBeUndefined();expect(result.cleanupErrors).toEqual([]);expect(result.nativeAppReady).toBe(true);expect(result.ownedBusinessProcesses).toBe(0);
  expect(Object.keys(result.cases)).toHaveLength(31);expect(Object.values(result.cases).every(value=>value===true)).toBe(true);
 }catch(error){bodyError=error;}finally{
  if(application){
   const child=application.process();let ownedPids:number[]=[];
   try{ownedPids=await application.evaluate(({app})=>app.getAppMetrics().map(row=>row.pid));expect(ownedPids).toContain(child.pid);}catch(error){cleanupErrors.push(error);}
   try{await application.close();expect(child.exitCode).toBe(0);}catch(error){cleanupErrors.push(error);}
   let remaining=ownedPids;
   try{await expect.poll(()=>{remaining=ownedPids.filter(pid=>{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}});return remaining.length;},{timeout:5000}).toBe(0);}catch(error){cleanupErrors.push(error);}
   const cleanup={test:'preparation-native-owned-close',pid:child.pid,exitCode:child.exitCode,reaped:child.exitCode!==null,observedOwnedProcesses:ownedPids.length,remaining:remaining.length};console.log(JSON.stringify(cleanup));
   if(evidence)writeFileSync(evidence+'.cleanup.json',JSON.stringify(cleanup,null,2));
  }
  if(evidence)writeFileSync(evidence+'.log',log);
  try{rmSync(root,{recursive:true,force:true,maxRetries:5});}catch(error){cleanupErrors.push(error);}
 }
 if(bodyError||cleanupErrors.length)throw new AggregateError([...(bodyError?[bodyError]:[]),...cleanupErrors],'preparation_native_body_or_cleanup_failed',{cause:bodyError??cleanupErrors[0]});
});
