import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {publishArtifactExportBuild} from '../../../scripts/verification/publish-artifact-export-build.mjs';

it('publishes complete immutable generations, keeping the previous selected build on pointer failure',()=>{
 const work=mkdtempSync(join(tmpdir(),'xiaok-export-publish-'));
 try{
  const first=publishArtifactExportBuild(work,{'artifact-export-helper':Buffer.from('one'),'GO-LICENSE':Buffer.from('license'),'manifest.json':Buffer.from('first')});
  const old=JSON.parse(readFileSync(join(work,'current.json'),'utf8'));
  expect(old.generation).toBe(first.generation);
  const second=publishArtifactExportBuild(work,{'artifact-export-helper':Buffer.from('two'),'GO-LICENSE':Buffer.from('license'),'manifest.json':Buffer.from('second')});
  expect(second.generation).not.toBe(first.generation);
  expect(readFileSync(join(first.output,'artifact-export-helper'),'utf8')).toBe('one');
  expect(createHash('sha256').update(readFileSync(join(second.output,'manifest.json'))).digest('hex')).toBe(JSON.parse(readFileSync(join(work,'current.json'),'utf8')).manifestSha256);
  // Force the final pointer replacement to fail after the generation is complete.
  rmSync(join(work,'current.json'));mkdirSync(join(work,'current.json'));writeFileSync(join(work,'current.json','keep'),'untouched');
  expect(()=>publishArtifactExportBuild(work,{'artifact-export-helper':Buffer.from('three'),'GO-LICENSE':Buffer.from('license'),'manifest.json':Buffer.from('third')})).toThrow();
  expect(readFileSync(join(work,'current.json','keep'),'utf8')).toBe('untouched');
  expect(readFileSync(join(second.output,'artifact-export-helper'),'utf8')).toBe('two');
  expect(readdirSync(work).some(n=>n.startsWith('.staging-')||n.startsWith('.current-'))).toBe(false);
 }finally{rmSync(work,{recursive:true,force:true});}
});
