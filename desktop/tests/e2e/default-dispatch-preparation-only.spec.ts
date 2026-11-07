import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
for(const mode of ['preparation-only','preparation-held','configuration-only','preparation-invalid'])test(`actual Native composition ${mode} preserves the original activity lane without a user capsule`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-artifact-runtime-e2e-'));for(const name of ['profile','config'])mkdirSync(join(root,name));
 const target=join(root,'preparation-only.json'),evidence=process.env.XIAOK_PREPARATION_ONLY_EVIDENCE;let application:Awaited<ReturnType<typeof electron.launch>>|undefined,mainChild:ReturnType<Awaited<ReturnType<typeof electron.launch>>['process']>|undefined,log='';const pids:number[]=[];
 try{
  application=await electron.launch({args:[resolve('tests/e2e/fixtures/default-dispatch-preparation-only.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,NODE_ENV:'test',XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_PREPARATION_ONLY_RESULT:target,XIAOK_PREPARATION_ONLY_MODE:mode}});
  const child=application.process();mainChild=child;child.stdout?.on('data',value=>{log+=String(value);});child.stderr?.on('data',value=>{log+=String(value);});console.log(JSON.stringify({phase:'preparation-only-start',pid:child.pid,root}));
  await expect.poll(()=>existsSync(target),{timeout:20000}).toBe(true);const facts=JSON.parse(readFileSync(target,'utf8'));if(facts.childPid)pids.push(facts.childPid);if(evidence)writeFileSync(evidence+'.'+mode,JSON.stringify({root,facts},null,2));
  expect(facts.error).toBeUndefined();expect(facts.activityReady).toBe(true);expect(facts.configFrames).toBeGreaterThan(0);
  if(mode==='preparation-only'||mode==='preparation-held')expect(facts).toMatchObject({clientBirths:1,businessRequests:0,facetAvailable:true,emptyWorkDenied:true,nativeBirthDenied:true,userCallsDenied:3});else expect(facts).toMatchObject({clientBirths:0,businessRequests:0,preparationDenied:true});
  if(mode==='preparation-held')expect(facts).toMatchObject({retirementWaitedForActualCallback:true,retirementWaitedForOriginalSdkRaw:true});
  // This fixture deliberately has no managed KSwarm target. The unchanged
  // configuration-only case has the same original unconfirmed retirement.
  expect(facts.cleanupErrors).toEqual(['AggregateError: kswarm_service_close_unconfirmed','AggregateError: DESKTOP_OWNER_RETIREMENT_UNCONFIRMED']);
 }finally{
  if(application){try{await application.close();}finally{console.log(JSON.stringify({phase:'preparation-only-main-close',pid:mainChild?.pid,exitCode:mainChild?.exitCode}));}}
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}};let signals=0;for(const pid of pids)try{process.kill(pid,'SIGTERM');signals++;}catch{}for(let n=0;n<100&&pids.some(alive);n++)await delay(20);for(const pid of pids.filter(alive))try{process.kill(pid,'SIGKILL');signals++;}catch{}for(let n=0;n<100&&pids.some(alive);n++)await delay(20);const remaining=pids.filter(alive);console.log(JSON.stringify({phase:'preparation-only-owned-child-fixture-cleanup',pids,signals,remaining,notProductDrain:true}));
  if(evidence)writeFileSync(evidence+'.'+mode+'.log',log);rmSync(root,{recursive:true,force:true,maxRetries:5});expect(remaining).toEqual([]);
 }
});
