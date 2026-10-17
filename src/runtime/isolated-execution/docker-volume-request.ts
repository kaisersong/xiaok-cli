import {createHash} from 'node:crypto';
import {canonicalVerificationJson} from '../verification/protocol.js';
import {buildDockerWorkerRequest,buildDockerStdinWorkerRequest,type DockerStdinDescriptor} from './docker-request.js';
function snapshot<T>(input:T):T{return JSON.parse(canonicalVerificationJson(input));}
function keys(input:object,expected:string[]){if(Object.keys(input).sort().join(',')!==expected.sort().join(','))throw Error('docker_volume_fields');}
function volume(name:string){if(typeof name!=='string'||!/^xiaok-[a-f0-9]{32}$/.test(name))throw Error('docker_volume_name');return name;}
export interface VolumeProposal {name:string;creationNonce:string;engineEpoch:string;bytes:number}
/** Fixed tmpfs driver options. Names/nonces are controller generated; labels alone grant no authority. */
export function buildDockerVolumeRequest(raw:VolumeProposal){
 const input=snapshot(raw);keys(input,['name','creationNonce','engineEpoch','bytes']);volume(input.name);
 if(!/^[a-f0-9]{64}$/.test(input.creationNonce)||typeof input.engineEpoch!=='string'||!input.engineEpoch||input.engineEpoch.length>160||!Number.isSafeInteger(input.bytes)||input.bytes<4096||input.bytes>256*1024**2)throw Error('docker_volume_identity');
 return {Name:input.name,Driver:'local',DriverOpts:{type:'tmpfs',device:'tmpfs',o:`size=${input.bytes},uid=10000,gid=10000,mode=0700,nosuid,nodev`},Labels:{'xiaok.creation':input.creationNonce,'xiaok.engine-epoch':input.engineEpoch}};
}
interface Common {imageDigest:string;attemptId:string;scopeDigest:string;inputVolume:string;outputVolume:string}
type MountedProposal=Common&({role:'holder'}|{role:'worker';command:{argv:readonly string[];cwdRelative:string};stdin?:DockerStdinDescriptor});
/** Holder never executes project code. Its input mount is writable only while the private controller populates it.
 * Sealing and exclusion of subsequent archive writes are enforced by the durable runner state machine. */
export function buildDockerMountedRequest(raw:MountedProposal){
 const input=snapshot(raw);keys(input,['imageDigest','attemptId','scopeDigest','inputVolume','outputVolume','role',...(input.role==='worker'?['command',...('stdin' in input?['stdin']:[])]:[])]);
 if(!['holder','worker'].includes(input.role)||volume(input.inputVolume)===volume(input.outputVolume))throw Error('docker_mount_identity');
 let cwd='/tmp';let argv:readonly string[]=['/bin/sleep','2147483647'];
 if(input.role==='worker'){
  keys(input.command,['argv','cwdRelative']);const relative=input.command.cwdRelative;
  if(typeof relative!=='string'||!relative||Buffer.byteLength(relative)>4096||relative.includes('\\')||relative!=='.'&&relative.split('/').some(x=>!x||x==='.'||x==='..'||/[:\x00-\x1f\x7f]/.test(x)))throw Error('docker_mount_cwd');
  cwd=relative==='.'?'/inputs':'/inputs/'+relative;argv=input.command.argv;
 }
 const request={imageDigest:input.imageDigest,attemptId:input.attemptId,scopeDigest:input.scopeDigest,argv};
 const body=input.role==='worker'&&'stdin' in input?buildDockerStdinWorkerRequest({request,stdin:input.stdin!}):buildDockerWorkerRequest(request);
 return {...body,WorkingDir:cwd,Labels:{...body.Labels,'xiaok.role':input.role},HostConfig:{...body.HostConfig,Mounts:[{Type:'volume',Source:input.inputVolume,Target:'/inputs',ReadOnly:input.role==='worker',VolumeOptions:{NoCopy:true}},{Type:'volume',Source:input.outputVolume,Target:'/artifacts',ReadOnly:false,VolumeOptions:{NoCopy:true}}]}};
}
export const MOUNTED_POLICY_SHA256=createHash('sha256').update(canonicalVerificationJson({volume:buildDockerVolumeRequest({name:'xiaok-'+'0'.repeat(32),creationNonce:'0'.repeat(64),engineEpoch:'placeholder',bytes:4096}),holder:buildDockerMountedRequest({role:'holder',imageDigest:'sha256:'+'0'.repeat(64),attemptId:'holder',scopeDigest:'0'.repeat(64),inputVolume:'xiaok-'+'0'.repeat(32),outputVolume:'xiaok-'+'1'.repeat(32)}),worker:buildDockerMountedRequest({role:'worker',imageDigest:'sha256:'+'0'.repeat(64),attemptId:'worker',scopeDigest:'0'.repeat(64),inputVolume:'xiaok-'+'0'.repeat(32),outputVolume:'xiaok-'+'1'.repeat(32),command:{argv:['/placeholder'],cwdRelative:'.'}}),stdinWorker:buildDockerMountedRequest({role:'worker',imageDigest:'sha256:'+'0'.repeat(64),attemptId:'stdin-worker',scopeDigest:'0'.repeat(64),inputVolume:'xiaok-'+'0'.repeat(32),outputVolume:'xiaok-'+'1'.repeat(32),command:{argv:['/placeholder'],cwdRelative:'.'},stdin:{sha256:'0'.repeat(64),bytes:1}})})).digest('hex');
