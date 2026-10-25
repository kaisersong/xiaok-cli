import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DockerEngineTransport} from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
import {buildDockerVolumeRequest,buildDockerMountedRequest} from '../../../src/runtime/isolated-execution/docker-volume-request.js';
describe('actual fixed engine volume HTTP transport',()=>{
 it('sends only fixed volume policy and accepts only matching engine inspection',async()=>{
  const root=mkdtempSync(join(tmpdir(),'volume-http-')),socketPath=join(root,'engine.sock'),calls:any[]=[];
  const proposal={name:'xiaok-'+'a'.repeat(32),creationNonce:'b'.repeat(64),engineEpoch:'epoch',bytes:4096};const expected=buildDockerVolumeRequest(proposal);let corrupt=false;
  const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;calls.push({method:req.method,url:req.url,body:body?JSON.parse(body):undefined});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...expected,Options:corrupt?{...expected.DriverOpts,device:'/'}:expected.DriverOpts,Scope:'local',Mountpoint:'/engine/private'}));});
  await new Promise<void>(resolve=>server.listen(socketPath,resolve));
  try{const engine=new DockerEngineTransport({socketPath});await engine.createVolume(proposal);expect(calls[0]).toMatchObject({method:'POST',url:'/v1.45/volumes/create',body:expected});await engine.inspectVolume(proposal);corrupt=true;await expect(engine.inspectVolume(proposal)).rejects.toThrow('docker_volume_inspection');}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
 });
 it('will not accept mutated mounted container policy before touching the engine',async()=>{
  const engine=new DockerEngineTransport({socketPath:'/nonexistent/engine.sock'});
  const body=buildDockerMountedRequest({role:'worker',imageDigest:'sha256:'+'c'.repeat(64),attemptId:'attempt',scopeDigest:'d'.repeat(64),inputVolume:'xiaok-'+'a'.repeat(32),outputVolume:'xiaok-'+'b'.repeat(32),command:{argv:['/bin/true'],cwdRelative:'.'}});
  body.HostConfig.Mounts[0].ReadOnly=false;await expect(engine.createMounted(body)).rejects.toThrow('docker_engine_unapproved_spec');
 });
});
