import {it,expect} from 'vitest';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {guestInstallationLock,guestArchiveInstall} from '../../../src/runtime/verification/guest-installation-phase.js';
const enabled=process.env.XIAOK_RUN_DOCKER_DEV_TESTS==='1',docker=process.env.XIAOK_TEST_DOCKER??'docker';
it.skipIf(!enabled)('actual Linux: an orphaned phase child retains flock; copy refuses until drain, then safely resumes exact bytes',async()=>{
 const name='xiaok-guest-phase-'+randomUUID(),nonce='a'.repeat(64),image='sha256:2155344e09b47f8ea09459100e050bed74b5202316318fd0ad0f7f6856089efc';
 function run(args:string[],input?:string){return spawnSync(docker,args,{encoding:'utf8',input,timeout:10000,maxBuffer:65536});}
 const create=run(['run','-d','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=64m','--tmpfs','/etc:rw,nosuid,nodev,size=1m','--tmpfs','/var/lock:rw,nosuid,nodev,size=1m','--tmpfs','/home/xiaokvm:rw,nosuid,nodev,size=1m','--tmpfs','/tmp:rw,nosuid,nodev,size=1m',image,'/bin/sleep','30']);expect(create.status).toBe(0);
 try{
  expect(run(['exec',name,'/bin/sh','-c',`printf '%s' '${nonce}' > /etc/xiaok-controller-creation-nonce`]).status).toBe(0);
  const first=spawn(docker,['exec',name,'/bin/sh','-c',guestInstallationLock(nonce)+'\nprintf "%s" $$ > /tmp/parent\nsleep 10 &\nprintf "%s" $! > /tmp/child\nwait\n'],{stdio:'ignore'});const finished=new Promise<void>(resolve=>first.once('close',()=>resolve()));
  const until=Date.now()+5000;while(run(['exec',name,'test','-s','/tmp/child']).status!==0){if(Date.now()>until)throw Error('guest phase never started');await new Promise(r=>setTimeout(r,20));}
  expect(run(['exec',name,'/bin/sh','-c','kill -KILL "$(cat /tmp/parent)"']).status).toBe(0);first.kill('SIGKILL');await finished;
  const body='approved exact archive',sha256=createHash('sha256').update(body).digest('hex'),script=guestArchiveInstall({creationNonce:nonce,file:'docker.tgz',sha256});
  // Parent/helper is gone, but the actual child retains the original lock FD.
  expect(run(['exec','-i',name,'/bin/sh','-c',script],body).status).not.toBe(0);
  expect(run(['exec',name,'test','-e','/home/xiaokvm/docker.tgz']).status).not.toBe(0);
  expect(run(['exec',name,'/bin/sh','-c','kill -KILL "$(cat /tmp/child)"']).status).toBe(0);
  const resumed=run(['exec','-i',name,'/bin/sh','-c',script],body);expect(resumed.status,resumed.stderr).toBe(0);
  expect(run(['exec',name,'cat','/home/xiaokvm/docker.tgz']).stdout).toBe(body);
  const conflict=guestArchiveInstall({creationNonce:nonce,file:'docker.tgz',sha256:'f'.repeat(64)});expect(run(['exec','-i',name,'/bin/sh','-c',conflict],'different').status).not.toBe(0);
  expect(run(['exec',name,'cat','/home/xiaokvm/docker.tgz']).stdout).toBe(body);
 }finally{run(['rm','-f',name]);}
},20000);
