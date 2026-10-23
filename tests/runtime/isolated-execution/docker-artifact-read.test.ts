import {it,expect} from 'vitest';import {createServer} from 'node:http';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DockerEngineTransport} from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
it.skipIf(process.platform==='win32')('HEAD checks every ancestor and refuses symlinks before fixed artifact GET',async()=>{
 const root=mkdtempSync(join(tmpdir(),'docker-artifact-')),socketPath=join(root,'engine.sock');const paths:string[]=[];let symlink=false;
 const server=createServer((req,res)=>{const path=new URL(req.url!,'http://local').searchParams.get('path')!;paths.push(req.method+' '+path);
 if(req.method==='HEAD'){const directory=path!=='/artifacts/sub/file';res.setHeader('X-Docker-Container-Path-Stat',Buffer.from(JSON.stringify({name:path.split('/').pop(),size:directory?0:3,mode:symlink&&path==='/artifacts/sub'?134217728:directory?2147483648:420,mtime:'2026-01-01T00:00:00Z',linkTarget:symlink&&path==='/artifacts/sub'?'/inputs':''})).toString('base64'));res.end();}else res.end('tar');});
 await new Promise<void>(r=>server.listen(socketPath,r));const transport=new DockerEngineTransport({socketPath});
 try {await expect(transport.readArtifactArchive('a'.repeat(64),'sub/file')).resolves.toEqual(Buffer.from('tar'));
 expect(paths).toEqual(['HEAD /artifacts','HEAD /artifacts/sub','HEAD /artifacts/sub/file','GET /artifacts/sub/file']);paths.length=0;symlink=true;
 await expect(transport.readArtifactArchive('a'.repeat(64),'sub/file')).rejects.toThrow('docker_artifact_type');expect(paths).toEqual(['HEAD /artifacts','HEAD /artifacts/sub']);
 await expect(transport.readArtifactArchive('a'.repeat(64),'../inputs/key')).rejects.toThrow('docker_artifact_path');
 }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}
});
