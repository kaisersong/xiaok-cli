import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
it('actual copy script rejects an incomplete universal package and verifies both architecture hashes',()=>{
 const root=mkdtempSync(join(tmpdir(),'windows-native-copy-'));
 try{
  mkdirSync(join(root,'src/runtime/verification/native'),{recursive:true});for(const name of ['windows-installation-absence.c','windows-absence-core.h'])writeFileSync(join(root,'src/runtime/verification/native',name),'source copy fixture');
  mkdirSync(join(root,'scripts/verification'),{recursive:true});const script=join(root,'scripts/verification/copy-windows-absence.mjs');copyFileSync('scripts/verification/copy-windows-absence.mjs',script);
  const run=()=>spawnSync(process.execPath,[script,'cli','--require-all'],{encoding:'utf8'});
  expect(run().status).not.toBe(0);
  for(const arch of ['x64','arm64']){const directory=join(root,'data/verification/windows','win32-'+arch);mkdirSync(directory,{recursive:true});const bytes=Buffer.from('synthetic copy fixture, not a Windows executable: '+arch);writeFileSync(join(directory,'windows-installation-absence.exe'),bytes);writeFileSync(join(directory,'windows-installation-absence.json'),JSON.stringify({version:1,target:'win32-'+arch,sourceSha256:createHash('sha256').update('source copy fixture').digest('hex'),coreSha256:createHash('sha256').update('source copy fixture').digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex')}));}
  const result=run();expect(result.status,result.stderr).toBe(0);
  for(const arch of ['x64','arm64'])expect(existsSync(join(root,'dist/runtime/verification/native','win32-'+arch,'windows-installation-absence.exe'))).toBe(true);
  writeFileSync(join(root,'data/verification/windows/win32-x64/windows-installation-absence.exe'),'changed');expect(run().status).not.toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('CLI release and Desktop build include the fixed helper packaging step and unpacked executable subtree',()=>{
 const cli=JSON.parse(readFileSync('package.json','utf8')),desktop=JSON.parse(readFileSync('desktop/package.json','utf8')),builder=JSON.parse(readFileSync('desktop/electron-builder.json','utf8'));
 expect(cli.scripts['build:release']).toContain('copy-windows-absence.mjs cli --require-all');
 expect(desktop.scripts['build:main']).toContain('copy-windows-absence.mjs desktop');
 expect(builder.asarUnpack).toContain('dist/main/src/runtime/verification/native/**');
});
