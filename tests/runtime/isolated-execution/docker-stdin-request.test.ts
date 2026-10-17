import {it,expect} from 'vitest';
import {buildDockerStdinWorkerRequest,buildDockerWorkerRequest} from '../../../src/runtime/isolated-execution/docker-request.js';
it('changes only fixed stdin controls and its exact descriptor, preserving argv and all isolation policy',()=>{const request={imageDigest:'sha256:'+'a'.repeat(64),attemptId:'stdin-test',scopeDigest:'b'.repeat(64),argv:['/bin/cat','literal;value']},stdin={sha256:'c'.repeat(64),bytes:2*1024**2};const base=buildDockerWorkerRequest(request),body=buildDockerStdinWorkerRequest({request,stdin});expect(body.Cmd).toEqual(request.argv);expect(body.HostConfig).toEqual(base.HostConfig);expect(body).toMatchObject({AttachStdin:true,OpenStdin:true,StdinOnce:true,Tty:false});expect(body.Labels['xiaok.stdin-sha256']).toBe(stdin.sha256);expect(()=>buildDockerStdinWorkerRequest({request,stdin:{...stdin,bytes:2*1024**2+1}})).toThrow();});
it('binds stdin only to the mounted worker and rejects it on the trusted holder',async()=>{
 const {buildDockerMountedRequest}=await import('../../../src/runtime/isolated-execution/docker-volume-request.js');
 const common={imageDigest:'sha256:'+'a'.repeat(64),attemptId:'case',scopeDigest:'b'.repeat(64),inputVolume:'xiaok-'+'1'.repeat(32),outputVolume:'xiaok-'+'2'.repeat(32)},command={argv:['/bin/cat'],cwdRelative:'.'},stdin={sha256:'c'.repeat(64),bytes:12};
 const base=buildDockerMountedRequest({...common,role:'worker',command});
 const body=buildDockerMountedRequest({...common,role:'worker',command,stdin} as any);
 expect(body.OpenStdin).toBe(true);expect(body.Cmd).toEqual(command.argv);expect(body.HostConfig).toEqual(base.HostConfig);
 expect(()=>buildDockerMountedRequest({...common,role:'holder',stdin} as any)).toThrow();
});
