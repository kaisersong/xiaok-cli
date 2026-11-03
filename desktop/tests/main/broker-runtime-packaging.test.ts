import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {shipBrokerRuntime}=require('../../scripts/pack-broker-runtime.cjs');
it('packager verifies provenance and binary before copying only one target and fails closed on mutation',()=>{
 const root=mkdtempSync(join(tmpdir(),'broker-runtime-pack-'));
 try{
  const target='darwin-arm64',cache=join(root,'cache'),source=join(cache,target),resources=join(root,'resources');mkdirSync(source,{recursive:true});mkdirSync(resources);
  const binary=Buffer.from('synthetic runtime'),sha=createHash('sha256').update(binary).digest('hex');
  writeFileSync(join(source,'node'),binary);writeFileSync(join(source,'LICENSE'),'license');
  writeFileSync(join(source,'manifest.json'),JSON.stringify({schema:'xiaok-broker-runtime/v1',target,node:'24.19.0',sqlite:'3.53.3',executable:'node',executableSha256:sha,archiveSha256:'8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d'}));
  const result=shipBrokerRuntime({cacheRoot:cache,resources,target});expect(result.target).toBe(target);
  expect(readFileSync(join(resources,'services','intent-broker','runtime',target,'node'))).toEqual(binary);
  writeFileSync(join(source,'node'),'tampered');expect(()=>shipBrokerRuntime({cacheRoot:cache,resources,target})).toThrow(/broker_runtime/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
