import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

it.skipIf(process.platform==='win32')('preserves Enter through a real PTY delayed reader handoff',()=>{
 const module=fileURLToPath(new URL('../../src/ui/input-mode.js',import.meta.url));
 const script=fileURLToPath(new URL('../e2e/input-handoff.py',import.meta.url));
 const result=spawnSync('python3',[script,module],{encoding:'utf8',timeout:10000});
 expect(result.status,result.stderr||result.stdout).toBe(0);
 expect(result.stdout).toContain('real PTY delayed raw input handoff: passed');
});
