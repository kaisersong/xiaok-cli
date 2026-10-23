import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createServer,createConnection,type Socket} from 'node:net';
import {once} from 'node:events';
import {fstatSync} from 'node:fs';
import {NETDEVICE_CHECK_FUNCTIONS,buildNetdeviceTransmitDisabledCheck,assertDockerNoneNetworkAttachment} from '../../../src/runtime/verification/netdevice-transmit-disabled.js';
import {WORKER_SECCOMP_JSON} from '../../../src/runtime/isolated-execution/docker-request.js';

// These controls call the same shell functions used by the fixed Linux worker.
// They do not issue an installed qualification or run Docker/host OS helpers.
const linux=process.platform==='linux';
// Node's "pipe" endpoints need not be Unix FIFOs. The inspected inner shell
// receives a real anonymous pipeline, with stderr duplicated to its write end.
// pipefail propagates the inspected child's status instead of cat's success.
// Construct only the standard descriptors this fixture promises. Actual CI
// showed additional inherited pipes of unknown origin; production rejects those.
// The socket control preserves fd3 only until the existing dup-to-stdout step.
function fixtureFds(keepSocket=false){return `for fixture_path in /proc/$$/fd/*; do
 fixture_fd=\${fixture_path##*/}
 case "$fixture_fd" in 0|1|2${keepSocket?'|3':''}) ;; ''|*[!0-9]*) exit 93 ;; *) eval "exec $fixture_fd>&-" || exit 94 ;; esac
done
`;}
function check(call:string,args:string[]=[]){return spawnSync('/bin/bash',['-o','pipefail','-c',fixtureFds()+'script=$1; shift; /bin/sh -c "$script" netdevice-control "$@" </dev/null 2>&1 | cat','fifo-control',NETDEVICE_CHECK_FUNCTIONS+'\n'+call,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
const proc='renamed_loop\nrenamed_link';
const rows='N renamed_loop 1 772 0x9\nN renamed_link 2 1 0x0\nC control_attribute regular';
it.runIf(linux)('accepts renamed administratively disabled netdevices and structural management entries, without an IPC claim',()=>{
 const result=check('netdevice_rows_valid "$1" "$2"',[proc,rows]);expect(result.status).toBe(0);expect(result.stdout).toBe('');
 expect(check('netdevice_rows_valid "$1" "$2"',[proc.replace('renamed_link','bonding_masters'),rows.replace('renamed_link','bonding_masters')]).status).toBe(0);
});
it.runIf(linux).each([
 ['IFF_UP despite an operationally-down link',proc,rows.replace('2 1 0x0','2 1 0x1')],
 ['a newly enabled unnamed link',proc+'\nextra',rows+'\nN extra 3 1 0x1'],
 ['an omitted proc device',proc+'\nextra',rows],
 ['a sysfs device omitted from proc',proc,rows+'\nN extra 3 1 0x0'],
 ['duplicate proc names',proc+'\nrenamed_link',rows],
 ['duplicate ifindex',proc,rows.replace('2 1 0x0','1 1 0x0')],
 ['a loopback flag with a non-loopback type',proc,rows.replace('1 772 0x9','1 1 0x9')],
 ['a loopback type without IFF_LOOPBACK',proc,rows.replace('1 772 0x9','1 772 0x1')],
 ['two loopback devices',proc,rows.replace('2 1 0x0','2 772 0x8')],
 ['a management entry pretending to satisfy a proc device',proc,'N renamed_loop 1 772 0x9\nC renamed_link regular'],
 ['unknown sysfs entry kind',proc,rows+'\nC unknown socket'],
 ['missing flags',proc,rows.replace('2 1 0x0','2 1')],
 ['invalid numeric flags',proc,rows.replace('0x0','0xZZ')],
])('rejects %s in the production netdevice parser',(_reason,names,facts)=>{expect(check('netdevice_rows_valid "$1" "$2"',[names,facts]).status).toBe(1);});
it.runIf(linux)('parses complete proc counters and rejects malformed or duplicate device rows',()=>{
 const header='Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n';
 const counters='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0';
 const result=check('netdevice_proc_names',[]);
 // No input is supplied above: a missing inventory must fail, never become empty success.
 expect(result.status).toBe(1);
 const parse=(input:string)=>spawnSync('/bin/sh',['-c',NETDEVICE_CHECK_FUNCTIONS+'\nnetdevice_proc_names'],{encoding:'utf8',input});
 expect(parse(header+'renamed_loop: '+counters+'\n').stdout).toBe('renamed_loop\n');
 expect(parse(header+'renamed_loop: '+counters+'\nrenamed_loop: '+counters+'\n').status).toBe(1);
 expect(parse(header+'renamed_loop: 0\n').status).toBe(1);
});
it.runIf(linux)('checks actual inherited descriptors and rejects an inherited namespace or bidirectional pipe descriptor',()=>{
 const positive=check('for fd in 1 2; do stat -L -c "%F" /proc/$$/fd/$fd || exit 91; done\nnetdevice_inherited_fds_valid || { nd_status=$?; for nd_diag in /proc/$$/fd/*; do printf "descriptor=%s " "$nd_diag"; readlink "$nd_diag" || :; done; printf "BASH_ENV=%s\\n" "${BASH_ENV:+set}"; set -x; netdevice_inherited_fds_valid; exit "$nd_status"; }');
 expect(positive.error).toBeUndefined();expect(positive.status,positive.stdout+positive.stderr).toBe(0);expect(positive.stdout).toBe('fifo\nfifo\n');
 const negative=(open:string)=>check('netdevice_inherited_fds_valid || exit 91\n'+open+' || exit 92\nif netdevice_inherited_fds_valid; then exit 90; else code=$?; fi\nexec 3<&-\nexit "$code"');
 expect(negative('exec 3</proc/self/ns/net').status).toBe(1);
 expect(negative('exec 3<>/proc/self/fd/1').status).toBe(1);
});
it.runIf(linux)('rejects an actual connected INET socket inherited as stdout without replacing the production FD inspector',async()=>{
 expect(check('netdevice_inherited_fds_valid').status).toBe(0);
 const accepted=new Set<Socket>(),errors:unknown[]=[];let closing=false;
 const server=createServer(socket=>{accepted.add(socket);socket.on('error',error=>errors.push(error));if(closing)socket.destroy();});
 let socket:Socket|undefined;
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw Error('owned_listener_address');
  socket=createConnection({host:'127.0.0.1',port:address.port});
  await once(socket,'connect');
  // spawnSync needs the connected socket's numeric descriptor, not a Stream wrapper.
  const handle:unknown=Reflect.get(socket,'_handle');
  if(!handle||typeof handle!=='object')throw Error('owned_socket_handle_required');
  const socketFd:unknown=Reflect.get(handle,'fd');
  if(typeof socketFd!=='number'||!Number.isSafeInteger(socketFd)||socketFd<3||!fstatSync(socketFd).isSocket())throw Error('owned_socket_fd_required');
  // fd2 is the real pipeline write end; only fd1 is the inherited data socket.
  // Close the temporary fd3 after dup, so another rejected FD cannot mask fd1.
  const result=spawnSync('/bin/bash',['-o','pipefail','-c',fixtureFds(true)+'/bin/sh -c "$1" netdevice-control </dev/null 2>&1 1>&3 3>&- | cat','socket-fd-control',NETDEVICE_CHECK_FUNCTIONS+'\nnetdevice_inherited_fds_valid'],{stdio:['ignore','pipe','pipe',socketFd]});
  expect(result.error).toBeUndefined();expect(result.status).toBe(1);
 }catch(error){errors.push(error);}finally{
  closing=true;
  const closed=socket?once(socket,'close'):Promise.resolve();socket?.destroy();for(const peer of accepted)peer.destroy();
  try{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}catch(error){errors.push(error);}
  try{await closed;}catch(error){errors.push(error);}
 }
 if(errors.length)throw new AggregateError(errors,'owned_socket_fd_control_failed');
});
it.runIf(linux).each([
 ['INET/packet/VSOCK socket','1','socket:[42]','c180','0','0','01'],
 ['namespace descriptor','0','net:[42]','8124','0','0','00'],
 ['tun/tap descriptor','0','/dev/net/tun','21b6','a','c8','00'],
 ['anonymous proxy descriptor','1','anon_inode:[eventpoll]','1180','0','0','01'],
 ['bidirectional standard pipe','1','pipe:[42]','1180','0','0','02'],
 ['unrecognized inherited file','3','/tmp/file','8180','0','0','00'],
])('rejects %s with the production descriptor classifier',(_reason,...facts)=>{expect(check('netdevice_fd_fact_valid "$@"',facts).status).toBe(1);});
it.runIf(linux)('requires every capability set, namespace consistency and a stable full snapshot',()=>{
 const status=['CapEff','CapPrm','CapInh','CapAmb','CapBnd'].map(k=>k+':\t0000000000000000').join('\n')+'\nNoNewPrivs:\t1\nSeccomp:\t2\n';
 const parse=(input:string)=>spawnSync('/bin/sh',['-c',NETDEVICE_CHECK_FUNCTIONS+'\nnetdevice_capabilities_valid'],{encoding:'utf8',input});
 expect(parse(status).status).toBe(0);
 for(const key of ['CapEff','CapPrm','CapInh','CapAmb','CapBnd'])expect(parse(status.replace(key+':\t0000000000000000',key+':\t0000000000000001')).status).toBe(1);
 expect(parse(status.replace('CapAmb:\t0000000000000000\n','')).status).toBe(1);
 expect(check('netdevice_snapshots_equal "$1" "$2"',['net:[1]\n'+rows,'net:[2]\n'+rows]).status).toBe(1);
 expect(check('netdevice_snapshots_equal "$1" "$2"',['net:[1]\n'+rows,'net:[1]\n'+rows.replace('0x0','0x1')]).status).toBe(1);
});
it.runIf(linux)('rejects a writable effective mount or a writable nested network-control mount',()=>{
 const verify=(input:string)=>spawnSync('/bin/sh',['-c',NETDEVICE_CHECK_FUNCTIONS+'\nnetdevice_path_readonly /sys/class/net'],{encoding:'utf8',input});
 expect(verify('sysfs /sys sysfs ro,nosuid,nodev 0 0\n').status).toBe(0);
 expect(verify('sysfs /sys sysfs rw,nosuid,nodev 0 0\n').status).toBe(1);
 expect(verify('sysfs /sys sysfs ro 0 0\ntmpfs /sys/class/net/x tmpfs rw 0 0\n').status).toBe(1);
});

function none(){return {SandboxID:'',SandboxKey:'',Ports:{},Networks:{none:{IPAMConfig:null,Links:null,Aliases:null,DriverOpts:null,GwPriority:0,NetworkID:'a'.repeat(64),EndpointID:'',Gateway:'',IPAddress:'',MacAddress:'',IPPrefixLen:0,IPv6Gateway:'',GlobalIPv6Address:'',GlobalIPv6PrefixLen:0,DNSNames:null}}};}
it('accepts only complete actual Docker none-attachment facts, separately from the netdevice proof',()=>{
 expect(()=>assertDockerNoneNetworkAttachment(none())).not.toThrow();
 for(const field of ['EndpointID','Gateway','IPAddress','MacAddress','IPv6Gateway','GlobalIPv6Address']){
  const value=none();Reflect.set(value.Networks.none,field,'external');expect(()=>assertDockerNoneNetworkAttachment(value)).toThrow('qualification_network_attachment');
 }
 for(const field of ['SandboxID','SandboxKey']){
  const running=none();Reflect.set(running,field,'running-lifecycle-identity');
  // This is terminal qualification evidence only, never pre-kill ownership.
  expect(()=>assertDockerNoneNetworkAttachment(running)).toThrow('qualification_network_attachment');
 }
 for(const field of ['Links','Aliases','DNSNames','DriverOpts','IPAMConfig']){
  const value=none();Reflect.set(value.Networks.none,field,[]);expect(()=>assertDockerNoneNetworkAttachment(value)).toThrow('qualification_network_attachment');
 }
 const attached=none();Reflect.set(attached.Networks,'bridge',attached.Networks.none);expect(()=>assertDockerNoneNetworkAttachment(attached)).toThrow();
 const port=none();Reflect.set(port.Ports,'80/tcp',[{HostPort:'8080'}]);expect(()=>assertDockerNoneNetworkAttachment(port)).toThrow();
 const unknown=none();Reflect.set(unknown.Networks.none,'FutureAttachment',undefined);expect(()=>assertDockerNoneNetworkAttachment(unknown)).toThrow();
 expect(()=>assertDockerNoneNetworkAttachment({Networks:{none:{}}})).toThrow();
 expect(()=>assertDockerNoneNetworkAttachment(undefined)).toThrow();
});
it('keeps the generated evidence limited to netdevice-mediated IPv4/IPv6/L2 and the original privilege-changing syscall deny',()=>{
 const script=buildNetdeviceTransmitDisabledCheck();expect(script).toContain('netdevice_transmit_disabled');expect(script).toContain('netdevice_inherited_fds_valid');expect(script).toContain('netdevice-mediated IPv4/IPv6/L2 transmit-disabled only');
 const policy=JSON.parse(WORKER_SECCOMP_JSON);expect(policy.defaultAction).toBe('SCMP_ACT_ERRNO');
 for(const syscall of ['setns','unshare','capset','setuid','setresuid','bpf'])expect(policy.syscalls.some((r:{action:string;names:string[]})=>r.action==='SCMP_ACT_ALLOW'&&r.names.includes(syscall))).toBe(false);
});
