import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,statSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
it.skipIf(!['darwin','linux'].includes(process.platform))('emits executable metadata from the same nofollow file descriptor as the actual bytes',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'reader-metadata-'))),binary=join(root,'reader'),file=join(root,'script');
 try{const build=spawnSync('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror','-DXIAOK_EMIT_READ_METADATA',resolve('src/runtime/verification/native/secure-read.c'),'-o',binary],{encoding:'utf8'});expect(build.status,build.stderr).toBe(0);writeFileSync(file,'native');const stat=statSync(root,{bigint:true});
  for(const mode of [0o600,0o700]){chmodSync(file,mode);const result=spawnSync(binary,[root,'script','10',String(stat.dev),String(stat.ino)]);expect(result.status).toBe(0);expect(result.stdout).toEqual(Buffer.from((mode===0o700?'1':'0')+'\nnative'));}
 }finally{rmSync(root,{recursive:true,force:true});}
});
