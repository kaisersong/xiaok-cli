import {describe,it,expect} from 'vitest';
import {buildDockerVolumeRequest,buildDockerMountedRequest} from '../../../src/runtime/isolated-execution/docker-volume-request.js';
const identity={name:'xiaok-'+ 'a'.repeat(32),creationNonce:'b'.repeat(64),engineEpoch:'engine-1',bytes:1024*1024};
const common={imageDigest:'sha256:'+'c'.repeat(64),attemptId:'attempt',scopeDigest:'d'.repeat(64),inputVolume:identity.name,outputVolume:'xiaok-'+'e'.repeat(32)};
describe('fixed isolated volume and holder policy',()=>{
 it('bounds tmpfs storage and never accepts a host path/driver option',()=>{
  const request=buildDockerVolumeRequest(identity);expect(request.Driver).toBe('local');expect(request.DriverOpts).toEqual({type:'tmpfs',device:'tmpfs',o:'size=1048576,uid=10000,gid=10000,mode=0700,nosuid,nodev'});
  expect(()=>buildDockerVolumeRequest({...identity,name:'/var/run/docker.sock'})).toThrow();
  expect(()=>buildDockerVolumeRequest({...identity,driver:'bind'} as any)).toThrow();
  expect(()=>buildDockerVolumeRequest({...identity,bytes:256*1024**2+1})).toThrow();
 });
 it('holder never runs caller code and worker only sees read-only input plus bounded output',()=>{
  const holder=buildDockerMountedRequest({...common,role:'holder'});expect(holder.Cmd).toEqual(['/bin/sleep','2147483647']);expect(holder.User).toBe('10000:10000');
  const worker=buildDockerMountedRequest({...common,role:'worker',command:{argv:['/bin/sh','-c','cat x'],cwdRelative:'nested'}});
  expect(worker.WorkingDir).toBe('/inputs/nested');expect(worker.HostConfig.Mounts).toEqual([{Type:'volume',Source:common.inputVolume,Target:'/inputs',ReadOnly:true,VolumeOptions:{NoCopy:true}},{Type:'volume',Source:common.outputVolume,Target:'/artifacts',ReadOnly:false,VolumeOptions:{NoCopy:true}}]);
  expect(worker.HostConfig.NetworkMode).toBe('none');expect(worker.HostConfig.Binds).toEqual([]);
  expect(()=>buildDockerMountedRequest({...common,role:'holder',command:{argv:['/bin/sh'],cwdRelative:'.'}} as any)).toThrow();
  expect(()=>buildDockerMountedRequest({...common,role:'worker',command:{argv:['/bin/true'],cwdRelative:'../etc'}})).toThrow();
 });
});
