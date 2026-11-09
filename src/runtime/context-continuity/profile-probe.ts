import {spawnSync} from 'node:child_process';
import {lstatSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export interface ProfileDomainCensus {domains: string[]; migrated: boolean}
let pendingProfileProbe:{directory:string|undefined}|undefined;

// A fixed program, never assembled from paths or caller code. Its process owns
// all raw source FDs: closing them cannot release Main's POSIX SQLite locks.
export const PROFILE_DOMAIN_PROBE_PROGRAM = String.raw`
import fs from 'node:fs';
import {join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const {dataRoot, snapshotRoot}=JSON.parse(process.argv[1]);
const MAX=256n*1024n*1024n;
const fail=()=>{throw Error('profile_identity_unavailable');};
const hash=()=>createHash('sha256');
const owned=s=>process.platform==='win32'||typeof process.getuid==='function'&&s.uid===BigInt(process.getuid())&&(s.mode&0o022n)===0n;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid&&a.nlink===b.nlink;
const pathMatchesFd=(a,b)=>a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid&&a.nlink===b.nlink&&(a.dev===b.dev||(process.platform==='win32'&&a.dev===0n));
const pathStableFd=(a,b)=>pathMatchesFd(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const sameDirectory=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.uid===b.uid;
const stable=(a,b)=>same(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const stat=p=>{try{return fs.lstatSync(p,{bigint:true});}catch(e){if(e?.code==='ENOENT')return null;throw e;}};
const directory=p=>{const s=stat(p);if(!s||!s.isDirectory()||s.isSymbolicLink()||!owned(s))fail();return s;};
const roots=[dataRoot,snapshotRoot],rootStates=roots.map(directory);
const domains=new Set();let migrated=false;
const probes=[
 ['multi-agent/groups.sqlite',[1,2,3,4],[['thread_bindings','profile_id'],['workspace_execution_authorizations','profile_id']]],
 ['codex-native.sqlite',[0],[['codex_native_sessions','owner']]],
 ['conversation-activity.sqlite',[4],[['work_watches','profile_id'],['association_operations',"json_extract(data_json,'$.origin.profileId')"],['conversation_activities','profile_id'],['conversation_reads','profile_id'],['activity_presentations','profile_id'],['thread_tombstones','profile_id']]],
];
function capture(file, required=false){
 const before=stat(file);if(!before){if(required)fail();return null;}
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||!owned(before)||before.size<0n||before.size>MAX)fail();
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
 try{const binding=fs.fstatSync(fd,{bigint:true});if(!pathStableFd(before,binding))fail();if(process.platform==='win32'&&before.dev===0n){const probe=fs.openSync(file,fs.constants.O_RDONLY);try{if(!stable(binding,fs.fstatSync(probe,{bigint:true})))fail();}finally{fs.closeSync(probe);}}return {file,before,binding,fd};}
 catch(e){fs.closeSync(fd);throw e;}
}
function readPass(item,destination){
 const buffer=Buffer.alloc(65536),digest=hash(),size=Number(item.before.size);let output;
 try{
  if(destination)output=fs.openSync(destination,'wx',0o600);
  for(let offset=0;offset<size;){
   const count=fs.readSync(item.fd,buffer,0,Math.min(buffer.length,size-offset),offset);
   if(!Number.isInteger(count)||count<1||count>Math.min(buffer.length,size-offset))fail();
   digest.update(buffer.subarray(0,count));
   if(output!==undefined)for(let n=0;n<count;){const written=fs.writeSync(output,buffer,n,count-n,offset+n);if(!Number.isInteger(written)||written<1||written>count-n)fail();n+=written;}
   offset+=count;
  }
  return digest.digest('hex');
 }finally{if(output!==undefined)fs.closeSync(output);}
}
function exactRead(fd,size,position){const b=Buffer.alloc(size);let n=0;while(n<size){const count=fs.readSync(fd,b,n,size-n,position+n);if(count<1||count>size-n)fail();n+=count;}return b;}
// SQLite fileformat2.html sections4.1/4.2. Refuse a damaged/uncommitted tail
// rather than let recovery silently choose an older commit for an identity.
function validateWal(item){
 if(!item||item.before.size===0n)return;
 const size=Number(item.before.size);if(size<32)fail();const h=exactRead(item.fd,32,0),magic=h.readUInt32BE(0),page=h.readUInt32BE(8);
 if(![0x377f0682,0x377f0683].includes(magic)||h.readUInt32BE(4)!==3007000||page<512||page>65536||(page&(page-1))!==0||(size-32)%(24+page)!==0)fail();
 let s0=0,s1=0;const checksum=b=>{if(b.length%8)fail();for(let n=0;n<b.length;n+=8){s0=(s0+(magic===0x377f0682?b.readUInt32LE(n):b.readUInt32BE(n))+s1)>>>0;s1=(s1+(magic===0x377f0682?b.readUInt32LE(n+4):b.readUInt32BE(n+4))+s0)>>>0;}};
 checksum(h.subarray(0,24));if(s0!==h.readUInt32BE(24)||s1!==h.readUInt32BE(28))fail();
 let commit=false;
 for(let n=32;n<size;n+=24+page){const frame=exactRead(item.fd,24+page,n);if(frame.readUInt32BE(0)===0||frame.readUInt32BE(8)!==h.readUInt32BE(16)||frame.readUInt32BE(12)!==h.readUInt32BE(20))fail();checksum(frame.subarray(0,8));checksum(frame.subarray(24));if(s0!==frame.readUInt32BE(16)||s1!==frame.readUInt32BE(20))fail();commit=frame.readUInt32BE(4)>0;}
 if(!commit)fail();
}
for(let index=0;index<probes.length;index++){
 const [relative,versions,tables]=probes[index],file=join(dataRoot,...relative.split('/')),parent=dirname(file);
 const exists=stat(file);if(!exists)continue;const parentBefore=directory(parent);
 const held=[];let db;
 try{
  const source=capture(file,true);held.push(source);
  if(source.before.size<100n)fail();
  const wal=capture(file+'-wal');if(wal)held.push(wal);
  const shm=capture(file+'-shm');if(shm)held.push(shm);
  if((wal&&!shm)||stat(file+'-journal'))fail();
  const destination=join(snapshotRoot,String(index)+'.sqlite');
  const first=readPass(source,destination),walFirst=wal?readPass(wal,destination+'-wal'):null;
  validateWal(wal);
  if(first!==readPass(source)||first!==readPass(source)||wal&&(walFirst!==readPass(wal)||walFirst!==readPass(wal)))fail();
  for(const item of held){const now=stat(item.file);if(!now||!(item===shm?same(item.before,now):stable(item.before,now))||!(item===shm?same(item.binding,fs.fstatSync(item.fd,{bigint:true})):stable(item.binding,fs.fstatSync(item.fd,{bigint:true}))))fail();if(process.platform==='win32'&&now.dev===0n){const probe=fs.openSync(item.file,fs.constants.O_RDONLY);try{if(!(item===shm?same(item.binding,fs.fstatSync(probe,{bigint:true})):stable(item.binding,fs.fstatSync(probe,{bigint:true}))))fail();}finally{fs.closeSync(probe);}}}
  if(Boolean(stat(file+'-wal'))!==Boolean(wal)||Boolean(stat(file+'-shm'))!==Boolean(shm)||stat(file+'-journal')||!sameDirectory(parentBefore,directory(parent)))fail();
  // Open only the owned copy, with no URI dependency. Private WAL recovery
  // may create private sidecars; original files are never opened by SQLite.
  db=new DatabaseSync(destination);db.exec('BEGIN');
  if(!versions.includes(Number(db.prepare('PRAGMA user_version').get().user_version)))fail();
  const names=new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>String(row.name)));
  if(names.has('profile_identity_migrations'))migrated=true;
  for(const [table,column]of tables)if(names.has(table))for(const row of db.prepare('SELECT DISTINCT '+column+' AS profile FROM '+table+' LIMIT 3').all()){
   if(typeof row.profile!=='string'||row.profile.length>256)fail();domains.add(row.profile.replace(/^desktop-user:/,''));if(domains.size>2)fail();
  }
  if(!tables.some(([table])=>names.has(table))&&!names.has('profile_identity_migrations'))fail();
 }finally{
  let failed=false;try{db?.close();}catch{failed=true;}
  for(const item of held)try{fs.closeSync(item.fd);}catch{failed=true;}
  if(failed)fail();
 }
}
for(let n=0;n<roots.length;n++)if(!sameDirectory(rootStates[n],directory(roots[n])))fail();
process.stdout.write(JSON.stringify({version:1,domains:[...domains],migrated}));
`;

/** Metadata census only, never an execution, source or Native qualification. */
export function readProfileDomainCensus(dataRoot: string): ProfileDomainCensus {
  // Reserve before even mkdtemp can reenter/throw after creating a resource.
  // An unknown fate blocks further allocations for this process lifetime.
  if(pendingProfileProbe)throw Error('profile_identity_unavailable');
  const reservation={directory:undefined as string|undefined};
  pendingProfileProbe=reservation;
  const snapshotRoot=mkdtempSync(join(tmpdir(),'xiaok-profile-census-'));
  reservation.directory=snapshotRoot;
  const before=lstatSync(snapshotRoot,{bigint:true});
  const env:NodeJS.ProcessEnv={ELECTRON_RUN_AS_NODE:'1'};
  for(const key of ['SystemRoot','SYSTEMROOT','windir','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE'])if(process.env[key]!==undefined)env[key]=process.env[key];
  let childReturned=false;
  let failed=false,firstError:unknown;
  let census:ProfileDomainCensus|undefined;
  try {
    const result=spawnSync(process.execPath,['--input-type=module','--eval',PROFILE_DOMAIN_PROBE_PROGRAM,JSON.stringify({dataRoot,snapshotRoot})],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:8192});
    childReturned=true;
    if(result.error||result.status!==0||result.signal)throw Error('profile_identity_unavailable');
    const data:unknown=JSON.parse(result.stdout);
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='domains,migrated,version')throw Error('profile_identity_unavailable');
    const row=data as {version:unknown;domains:unknown;migrated:unknown};
    if(row.version!==1||typeof row.migrated!=='boolean'||!Array.isArray(row.domains)||row.domains.length>2||row.domains.some(value=>typeof value!=='string'||value.length>256)||new Set(row.domains).size!==row.domains.length)throw Error('profile_identity_unavailable');
    census={domains:row.domains as string[],migrated:row.migrated};
  } catch(error) {failed=true;firstError=error;}
  // Cleanup failure cannot replace a present primary error, including an SDK
  // throwing undefined. An SDK throw supplies no child-exit acknowledgement.
  if(childReturned){
    try {
      const current=lstatSync(snapshotRoot,{bigint:true});
      if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino||current.uid!==before.uid||current.mode!==before.mode)throw Error('profile_identity_unavailable');
      rmSync(snapshotRoot,{recursive:true});
      if(pendingProfileProbe!==reservation)throw Error('profile_identity_unavailable');
      pendingProfileProbe=undefined;
    } catch(error) {if(!failed){failed=true;firstError=error;}}
  }
  if(failed)throw firstError;
  if(!census)throw Error('profile_identity_unavailable');
  return census;
}
