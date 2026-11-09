import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
test('actual IPC transfers a private request to independent Native B and original Host observation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));for(const name of ['profile','config'])mkdirSync(join(root,name));const target=join(root,'observation-result.json'),evidence=process.env.XIAOK_NATIVE_OBSERVATION_EVIDENCE;
 let application:Awaited<ReturnType<typeof electron.launch>>|undefined,bodyError:unknown,log='';const errors:unknown[]=[];
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/default-dispatch-native-observation.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_NATIVE_OBSERVATION_RESULT:target}});const child=application.process();console.log(JSON.stringify({fixture:'native-observation-app-born',pid:child.pid,root}));child.stdout?.on('data',chunk=>{log+=String(chunk);});child.stderr?.on('data',chunk=>{log+=String(chunk);});
  await expect.poll(()=>existsSync(target),{timeout:20000}).toBe(true);const result=JSON.parse(readFileSync(target,'utf8'));if(evidence)writeFileSync(evidence,JSON.stringify(result,null,2));expect(result.processPid).toBe(child.pid);expect(result.error).toBeUndefined();expect(result.cleanupErrors).toEqual([]);expect(result.nativeAppReady).toBe(true);expect(Object.keys(result.cases)).toHaveLength(8);expect(Object.values(result.cases).every(value=>value===true)).toBe(true);
  for(const row of result.owned){expect(row.code).toBe(0);expect(row.signal).toBe(null);expect(row.reaped).toBe(true);expect(()=>process.kill(row.pid,0)).toThrow();}expect(result.owned).toHaveLength(2);
 }catch(error){bodyError=error;}finally{
  if(application){const child=application.process();let pids:number[]=[];try{pids=await application.evaluate(({app})=>app.getAppMetrics().map(row=>row.pid));}catch(error){errors.push(error);}try{await application.close();expect(child.exitCode).toBe(0);}catch(error){errors.push(error);}let remaining=pids;try{await expect.poll(()=>{remaining=pids.filter(pid=>{try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code!=='ESRCH';}});return remaining.length;},{timeout:5000}).toBe(0);}catch(error){errors.push(error);}const cleanup={pid:child.pid,exitCode:child.exitCode,reaped:child.exitCode!==null,observedOwnedProcesses:pids.length,remaining:remaining.length};console.log(JSON.stringify({fixture:'native-observation-app-close',...cleanup}));if(evidence)writeFileSync(evidence+'.cleanup.json',JSON.stringify(cleanup,null,2));}
  if(evidence)writeFileSync(evidence+'.log',log);try{rmSync(root,{recursive:true,force:true,maxRetries:5});}catch(error){errors.push(error);}
 }
 if(bodyError||errors.length)throw new AggregateError([...(bodyError?[bodyError]:[]),...errors],'native_observation_body_or_cleanup_failed',{cause:bodyError??errors[0]});
});
