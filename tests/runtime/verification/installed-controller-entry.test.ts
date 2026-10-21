import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
it('the actual controller entry rejects an ordinary invoking account without installing, enrolling or opening a listener',()=>{
 expect(process.getuid?.()).not.toBe(0);
 const child=spawnSync(process.execPath,['--import','tsx',resolve('src/runtime/verification/controller-entry.ts')],{encoding:'utf8',timeout:15000,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME}});
 expect(child.error).toBeUndefined();expect(child.signal).toBeNull();expect(child.status).toBe(1);
 expect(child.stderr).toContain('verification_controller_start_rejected');
 expect(child.stderr).not.toContain('ERR_MODULE_NOT_FOUND');expect(child.stdout).toBe('');
},20000);
