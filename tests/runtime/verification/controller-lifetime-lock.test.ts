import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,symlinkSync,renameSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {acquireControllerLifetimeLock} from '../../../src/runtime/verification/controller-lifetime-lock.js';
const roots:string[]=[];const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function dir(){const root=mkdtempSync(join(tmpdir(),'controller-lifetime-'));roots.push(root);return root;}
it('keeps the actual OS lock until close and refuses a concurrent owner',()=>{
 const root=dir(),a=acquireControllerLifetimeLock(root);cleanup.push(a.close);a.assertCurrent();expect(()=>acquireControllerLifetimeLock(root)).toThrow();a.close();expect(()=>a.assertCurrent()).toThrow();const b=acquireControllerLifetimeLock(root);cleanup.push(b.close);b.assertCurrent();
});
it('refuses a lock symlink without touching its target',()=>{const root=dir();symlinkSync(join(root,'target'),join(root,'controller-owner.sqlite'));expect(()=>acquireControllerLifetimeLock(root)).toThrow(/path/);});

it('releases only the actual OS owner lock after a real child SIGKILL',async()=>{
 const root=dir(),moduleUrl=pathToFileURL(resolve('src/runtime/verification/controller-lifetime-lock.ts')).href;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {acquireControllerLifetimeLock} from ${JSON.stringify(moduleUrl)}; const lock=acquireControllerLifetimeLock(process.argv[1]);process.stdout.write('ready');setInterval(()=>lock.assertCurrent(),1000);`,root],{stdio:['ignore','pipe','pipe']});
 try{await new Promise<void>((accept,reject)=>{const timeout=setTimeout(()=>reject(Error('child start timeout')),5000);child.once('error',reject);child.stdout.once('data',data=>{clearTimeout(timeout);data.toString()==='ready'?accept():reject(Error('bad ready'));});child.once('exit',()=>{clearTimeout(timeout);reject(Error('child exited before ready'));});});expect(()=>acquireControllerLifetimeLock(root)).toThrow();const closed=once(child,'close');child.kill('SIGKILL');await closed;const next=acquireControllerLifetimeLock(root);cleanup.push(next.close);next.assertCurrent();}finally{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'close');child.kill('SIGKILL');await done;}}
},10000);

it('permanently denies the current lifetime after its inode is replaced even if the old file is restored',()=>{const root=dir(),lock=acquireControllerLifetimeLock(root);cleanup.push(lock.close);const path=join(root,'controller-owner.sqlite'),old=join(root,'old');renameSync(path,old);writeFileSync(path,'',{mode:0o600});expect(()=>lock.assertCurrent()).toThrow('controller_lifetime_changed');unlinkSync(path);renameSync(old,path);expect(()=>lock.assertCurrent()).toThrow();});
