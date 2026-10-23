import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {buildInputFileArchive} from '../../../src/runtime/isolated-execution/input-tar.js';
it('produces actual tar with fixed safe parent dirs, Unicode path and immutable file bytes',()=>{
 const root=mkdtempSync(join(tmpdir(),'input-tar-'));try{
  const path='目录/嵌套/a.txt',bytes=Buffer.from('frozen');writeFileSync(join(root,'input.tar'),buildInputFileArchive({path,bytes,executable:false}));
  const result=spawnSync('/usr/bin/tar',['-xf',join(root,'input.tar'),'-C',root]);expect(result.status).toBe(0);expect(readFileSync(join(root,path))).toEqual(bytes);
  expect(()=>buildInputFileArchive({path:'../bad',bytes,executable:false})).toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
