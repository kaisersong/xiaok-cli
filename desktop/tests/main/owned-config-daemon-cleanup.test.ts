// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ownedConfigDaemonFixture} from '../support/owned-config-daemon-fixture.js';

it('records both original sidecars independently before cleanup, including a seeded fixture',async()=>{
 const cleanups:Array<()=>Promise<void>>=[];let records:Array<{pid:number;birth:string;root:string;name:string}>=[];
 const fixture=await ownedConfigDaemonFixture(close=>cleanups.push(close),{seedDispatch:true});
 try{
  const files=readdirSync(fixture.root).filter(name=>/^sidecar-(broker|kswarm)-[0-9]+\.json$/.test(name));
  records=files.map(name=>JSON.parse(readFileSync(join(fixture.root,name),'utf8')));
  console.log(JSON.stringify({test:'independent-sidecar-fixture-inventory',names:records.map(row=>row.name),count:records.length,notProductionDrain:true}));
  expect(records.map(row=>row.name).sort()).toEqual(['broker','kswarm']);
  for(const row of records){expect(row.root).toBe(fixture.root);expect(row.pid).toBeGreaterThan(0);expect(row.birth).toBeTruthy();}
 }finally{for(const close of cleanups.splice(0).reverse())await close();}
 const birth=(pid:number)=>{try{return execFileSync(process.platform==='win32'?'powershell.exe':'/bin/ps',process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]:['-p',String(pid),'-o','lstart='],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:3000}).trim();}catch{return '';}};
 const remaining=records.filter(row=>birth(row.pid)===row.birth);expect(remaining).toEqual([]);expect(existsSync(fixture.root)).toBe(false);
 console.log(JSON.stringify({test:'independent-sidecar-fixture-cleanup-verified',ownedSidecars:records.length,remainingSameIdentity:remaining.length,notProductionDrain:true}));
},20000);
