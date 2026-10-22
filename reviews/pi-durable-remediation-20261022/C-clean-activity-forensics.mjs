import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
const metaPath=path.resolve(process.argv[2]);
const meta=JSON.parse(fs.readFileSync(metaPath,'utf8'));
const logPath=metaPath.replace(/\.json$/,'.log');
const prefix='XIAOK_ACTIVITY_RETAINED_ROOT ';
const records=fs.readFileSync(logPath,'utf8').split('\n').filter(x=>x.startsWith(prefix)).map(x=>JSON.parse(x.slice(prefix.length)));
const processRows=cp.execFileSync('ps',['-eo','pid=,pgid=,args='],{encoding:'utf8'}).split('\n').map(x=>x.trim().split(/\s+/,3));
const groupMembers=processRows.filter(x=>x[1]===String(meta.pgid));
const positiveInteger=x=>Number.isSafeInteger(x)&&x>0;
const nonnegativeInteger=x=>Number.isSafeInteger(x)&&x>=0;
const finiteNonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const globalErrors=[];
const started=typeof meta.startedAt==='string'?Date.parse(meta.startedAt):NaN;
const finished=typeof meta.finishedAt==='string'?Date.parse(meta.finishedAt):NaN;
if(meta.activityForensicsSchemaVersion!==1||!positiveInteger(meta.pid)||!positiveInteger(meta.pgid)||!positiveInteger(meta.runnerPid))globalErrors.push('invalid_runner_schema');
if(!Number.isFinite(started)||!Number.isFinite(finished)||finished<started)globalErrors.push('invalid_runner_timestamps');
if(typeof meta.activityForensicsRunToken!=='string'||!/^[a-f0-9]{32}$/.test(meta.activityForensicsRunToken))globalErrors.push('invalid_run_token');
if(meta.reaped!==true||!Number.isInteger(meta.exitCode)||groupMembers.length||processRows.some(x=>x[0]===String(meta.pid)))globalErrors.push('runner_or_group_not_reaped');
const results=[];
for(const record of records){
 const result={record,deleted:false};results.push(result);
 try{
  if(globalErrors.length)throw Error('global_validation_failed:'+globalErrors.join(','));
  if(record.version!==1||!positiveInteger(record.workerPid)||!positiveInteger(record.workerPpid)||!nonnegativeInteger(record.uid)||!record.stat||!nonnegativeInteger(record.stat.uid)||!positiveInteger(record.stat.dev)||!positiveInteger(record.stat.ino)||!finiteNonnegative(record.stat.birthtimeMs))throw Error('invalid_record_schema');
  if(!meta.activityForensicsRunToken||record.runToken!==meta.activityForensicsRunToken)throw Error('run_token_unconfirmed');
  if(record.workerPid!==meta.pid&&record.workerPpid!==meta.pid)throw Error('worker_parent_unconfirmed');
  if(processRows.some(x=>x[0]===String(record.workerPid)))throw Error('worker_pid_still_exists');
  if(typeof record.root!=='string'||!path.isAbsolute(record.root)||path.dirname(record.root)!==fs.realpathSync(os.tmpdir())||!/^xiaok-activity-bdd-[A-Za-z0-9]+$/.test(path.basename(record.root)))throw Error('not_exact_temp_fixture_root');
  if(fs.realpathSync(record.root)!==record.root)throw Error('root_realpath_changed');
  const current=fs.lstatSync(record.root);if(!current.isDirectory()||current.isSymbolicLink())throw Error('root_type_changed');
  if(typeof process.getuid!=='function'||record.uid!==process.getuid())throw Error('owner_uid_unknown_or_changed');
  for(const key of ['dev','ino','uid','birthtimeMs'])if(current[key]!==record.stat[key])throw Error('root_stat_changed:'+key);
  if(record.stat.birthtimeMs<started-1||record.stat.birthtimeMs>finished+1)throw Error('root_not_created_during_owned_run');
  result.verifiedStat={dev:current.dev,ino:current.ino,uid:current.uid,birthtimeMs:current.birthtimeMs};
  fs.rmSync(record.root,{recursive:true,force:false});result.deleted=!fs.existsSync(record.root);
 }catch(error){result.error=String(error);}
}
const output={metaPath,ownedPid:meta.pid,ownedPgid:meta.pgid,reaped:meta.reaped,globalErrors,groupMembers,records:results,onlyExactRoots:true,signalsSent:[]};
fs.writeFileSync(metaPath.replace(/\.json$/,'.forensics-cleanup.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
if(globalErrors.length||results.some(x=>!x.deleted))process.exitCode=1;
