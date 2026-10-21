import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runInstallationCommand,assertInstallationCommandIdle} from '../../../src/runtime/verification/installation-command.js';
it('keeps admission busy until the actual spawned helper closes after a timeout',async()=>{
 const root=mkdtempSync(join(tmpdir(),'install-command-')),pidfile=join(root,'pid');
 try{const running=runInstallationCommand({scope:root,executable:process.execPath,argv:['-e',`require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`,pidfile],cwd:root,env:{PATH:'/usr/bin:/bin'},timeoutMs:200,assertCurrent(){}});
 expect(()=>assertInstallationCommandIdle(root)).toThrow('installation_command_busy');await expect(running).rejects.toThrow('installation_command_unknown');
 const pid=Number(readFileSync(pidfile,'utf8'));expect(()=>process.kill(pid,0)).toThrow();expect(()=>assertInstallationCommandIdle(root)).not.toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('waits for delayed inherited stdio closure and never labels child exit as tree quiescence',async()=>{
 const root=mkdtempSync(join(tmpdir(),'install-command-stdio-'));
 try{const start=performance.now();const out=await runInstallationCommand({scope:root,executable:process.execPath,argv:['-e',`require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>process.stdout.write("late"),150)'],{stdio:['ignore',1,2]});`],cwd:root,env:{PATH:'/usr/bin:/bin'},timeoutMs:2000,assertCurrent(){}});expect(out.toString()).toBe('late');expect(performance.now()-start).toBeGreaterThanOrEqual(140);expect(typeof out).toBe('object');}finally{rmSync(root,{recursive:true,force:true});}
});
it('does not leave an admission latch when spawn rejects before any process exists',async()=>{
 const scope='invalid-spawn-'+process.pid;
 await expect(runInstallationCommand({scope,executable:'bad\0path',argv:[],cwd:process.cwd(),env:{},timeoutMs:1000,assertCurrent(){}})).rejects.toThrow();
 expect(()=>assertInstallationCommandIdle(scope)).not.toThrow();
});
