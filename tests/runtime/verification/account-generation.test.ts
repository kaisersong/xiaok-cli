import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
it.skipIf(process.platform!=='darwin')('reads the actual local account generation by numeric UID and rejects alternate caller identifiers',()=>{
 const root=mkdtempSync(join(tmpdir(),'account-generation-')),binary=join(root,'account');
 try{const c=spawnSync('/usr/bin/cc',['-fobjc-arc','-O2','-Wall','-Wextra','-Werror',resolve('src/runtime/verification/native/account-generation.m'),'-framework','Foundation','-framework','OpenDirectory','-o',binary],{encoding:'utf8'});expect(c.status,c.stderr).toBe(0);
 const result=spawnSync(binary,[String(process.getuid!())],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);const facts=JSON.parse(result.stdout);expect(facts.uid).toBe(process.getuid!());expect(facts.accountGeneration).toMatch(/^[A-F0-9-]{36}$/);expect(facts.source).toBe('macos-local-generateduid');
 expect(spawnSync(binary,['user-name']).status).not.toBe(0);expect(spawnSync(binary,['0']).status).not.toBe(0);if(process.getuid!()!==0)expect(spawnSync(binary,['1']).status).not.toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
