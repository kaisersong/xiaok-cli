import fg from 'fast-glob';
import { readdir, stat, lstat, constants, promises as fs } from 'node:fs';
import { resolve, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';

const SCOPE_DENIED='sandbox denied search path';
let nextId=0;
const pending=new Map();
const authorizationQueue=[];
const AUTH_BATCH=256,MAX_AUTH_INFLIGHT=2;
let queuedPaths=0,queuedBytes=0,pumpScheduled=false;
function pump(){
  pumpScheduled=false;
  while(pending.size<MAX_AUTH_INFLIGHT && authorizationQueue.length){
    const requests=[],paths=[];
    while(authorizationQueue.length && paths.length+authorizationQueue[0].paths.length<=AUTH_BATCH){
      const request=authorizationQueue.shift();requests.push(request);paths.push(...request.paths);
    }
    const id=++nextId;pending.set(id,{requests,length:paths.length});
    parentPort.postMessage({kind:'authorize',id,paths});
  }
}
function schedulePump(){
  if(!pumpScheduled){pumpScheduled=true;setImmediate(pump);}
}
parentPort.on('message',message=>{
  if(message?.kind!=='authorized')return;
  const request=pending.get(message.id);
  if(!request)return;
  pending.delete(message.id);
  const valid=Array.isArray(message.allowed)&&message.allowed.length===request.length
    &&message.allowed.every(value=>typeof value==='boolean');
  let offset=0;
  for(const part of request.requests){
    queuedPaths-=part.paths.length;queuedBytes-=part.bytes;
    if(valid)part.resolve(message.allowed.slice(offset,offset+part.paths.length));
    else part.reject(Error(SCOPE_DENIED));
    offset+=part.paths.length;
  }
  schedulePump();
});
async function authorize(paths){
  if(!workerData.scoped)return paths.map(()=>true);
  const allowed=[];
  for(let offset=0;offset<paths.length;offset+=AUTH_BATCH){
    const batch=paths.slice(offset,offset+AUTH_BATCH),bytes=Buffer.byteLength(batch.join(''));
    if(queuedPaths+batch.length>workerData.limits.maxEntries||queuedBytes+bytes>workerData.limits.maxPathBytes)throw Error('glob_scan_limit');
    queuedPaths+=batch.length;queuedBytes+=bytes;
    allowed.push(...await new Promise((resolve,reject)=>{
      authorizationQueue.push({paths:batch,bytes,resolve,reject});schedulePump();
    }));
  }
  return allowed;
}
async function assertPath(path){
  if(!(await authorize([String(path)]))[0])throw Error(SCOPE_DENIED);
}

async function search(input, limits) {
  let scannedEntries = 0;
  let directories = 0;
  let metadataCalls = 0;
  let pathBytes = 0;
  let stopped = false;
  const files = [];
  // Static/brace tasks bypass readdir and perform metadata lookups directly.
  const boundedMetadata = operation => (path, ...args) => {
    const callback = args.at(-1);
    if (stopped || ++metadataCalls > limits.maxEntries) {
      stopped = true; callback(new Error('glob_scan_limit')); return;
    }
    void assertPath(path).then(()=>{
      if(stopped)callback(Error('glob_scan_limit'));
      else operation(path,...args);
    },callback);
  };
  // Count before fs.scandir allocates per-entry stat jobs and traversal queues.
  const boundedReaddir = (path, callback) => {
    if (stopped || ++directories > limits.maxDirectories) {
      callback(new Error('glob_scan_limit')); return;
    }
    void assertPath(path).then(()=>readdir(path, (error, names) => {
      if (error) {
        if (input.skipInaccessible && ['EACCES', 'EPERM', 'ENOENT'].includes(error.code ?? '')) callback(null, []);
        else callback(error);
        return;
      }
      scannedEntries += names.length;
      if (stopped || scannedEntries > limits.maxEntries) {
        stopped = true; callback(new Error('glob_scan_limit')); return;
      }
      // A permitted directory may contain denied subtrees or symlinks. Filter
      // before fast-glob schedules metadata or traversal for any child.
      void authorize(names.map(name=>join(String(path),name))).then(allowed=>{
        callback(null,names.filter((_,index)=>allowed[index]));
      },callback);
    }),callback);
  };
  await new Promise((resolve, reject) => {
    const stream = fg.stream(input.patterns, {
      cwd: input.cwd, absolute: true, stats: true,
      concurrency: 2, followSymbolicLinks: false,
      onlyFiles: (input.type ?? 'file') === 'file', onlyDirectories: input.type === 'directory',
      dot: input.dot ?? false, ignore: input.ignore ?? [],
      fs: { readdir: boundedReaddir, stat: boundedMetadata(stat), lstat: boundedMetadata(lstat) },
    });
    const fail = (error) => { stopped = true; stream.destroy(); reject(error); };
    stream.on('data', (entry) => {
      if (stopped) return;
      pathBytes += Buffer.byteLength(entry.path);
      if (files.length >= limits.maxResults || pathBytes > limits.maxPathBytes) {
        fail(new Error('glob_result_limit')); return;
      }
      files.push({ path: entry.path, mtimeMs: entry.stats?.mtimeMs ?? 0 });
    });
    stream.once('error', fail);
    stream.once('end', resolve);
  });
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

const MAX_FILE_BYTES=8*1024*1024,MAX_READ_BYTES=16*1024*1024,MAX_TEXT_BYTES=1024*1024;
async function grep(input,limits){
  const {pattern,context=0,outputMode='lines'}=input.grep??{};
  if(typeof pattern!=='string'||pattern.length>16_384||!Number.isSafeInteger(context)||context<0||context>1000
    ||!['lines','files','count'].includes(outputMode))throw Error('grep_invalid_input');
  let matcher;
  try{matcher=new RegExp(pattern);}catch{throw Error('grep_invalid_regex');}
  const root=resolve(input.cwd);
  await assertPath(root);
  let rootStat;
  try{rootStat=await fs.lstat(root);}catch{throw Error('grep_read_failed');}
  const files=rootStat.isFile()?[{path:root}]:rootStat.isDirectory()
    ? await search({...input,type:'file'},limits):null;
  if(!files)throw Error('grep_read_failed');
  let readBytes=0,textBytes=0,pathBytes=0;
  const results=[];
  // Match master's fallback: limits truncate the result (with a reason the
  // host turns into a notice) instead of discarding everything found so far.
  const truncated=new Set();
  const append=entry=>{
    const nextText=textBytes+Buffer.byteLength(entry.text),nextPath=pathBytes+Buffer.byteLength(entry.path);
    if(results.length>=limits.maxResults||nextText>MAX_TEXT_BYTES||nextPath>limits.maxPathBytes){
      truncated.add('result_limit');return false;
    }
    textBytes=nextText;pathBytes=nextPath;results.push(entry);return true;
  };
  const single=files.length===1&&rootStat.isFile();
  for(const file of files){
    await assertPath(file.path);
    let handle,body;
    try{
      const before=await fs.lstat(file.path,{bigint:true});
      if(!before.isFile()||before.isSymbolicLink())throw Error('grep_read_failed');
      if(before.size>BigInt(MAX_FILE_BYTES)){truncated.add('file_too_large');continue;}
      if(readBytes+Number(before.size)>MAX_READ_BYTES){truncated.add('read_budget');break;}
      handle=await fs.open(file.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      const opened=await handle.stat({bigint:true});
      const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
      if(!opened.isFile()||!same(before,opened))throw Error('grep_read_failed');
      await assertPath(file.path);
      // Bounded even if another local process grows the file while it is open.
      const buffer=Buffer.alloc(Number(before.size)+1);let bytes=0;
      while(bytes<buffer.length){
        const part=await handle.read(buffer,bytes,buffer.length-bytes,bytes);
        if(!part.bytesRead)break;
        bytes+=part.bytesRead;
      }
      if(BigInt(bytes)!==before.size||!same(opened,await handle.stat({bigint:true}))
        ||!same(opened,await fs.lstat(file.path,{bigint:true})))throw Error('grep_read_failed');
      await assertPath(file.path);
      body=buffer.subarray(0,bytes).toString('utf8');readBytes+=bytes;
    }catch(error){
      if(error?.message===SCOPE_DENIED)throw error;
      // An explicitly requested single file keeps its read error; inside a
      // directory walk an unreadable or changing file is skipped like master.
      if(single)throw Error('grep_read_failed');
      continue;
    }finally{await handle?.close();}
    const lines=body.split(/\r?\n/),matches=[];
    for(let i=0;i<lines.length;i++)if(matcher.test(lines[i]))matches.push(i);
    if(!matches.length)continue;
    if(outputMode==='files'){if(!append({path:file.path,lineNo:0,text:''}))break;continue;}
    if(outputMode==='count'){if(!append({path:file.path,lineNo:0,text:'',count:matches.length}))break;continue;}
    const included=new Set(),room=limits.maxResults-results.length;
    outer:for(const index of matches){
      for(let i=Math.max(0,index-context);i<=Math.min(lines.length-1,index+context);i++){
        if(!included.has(i)&&included.size>=room){truncated.add('result_limit');break outer;}
        included.add(i);
      }
    }
    let full=false;
    for(const index of [...included].sort((a,b)=>a-b))if(!append({path:file.path,lineNo:index+1,text:lines[index]})){full=true;break;}
    if(full||truncated.has('result_limit'))break;
  }
  return {entries:results,truncated:[...truncated]};
}

try {
  // Node's process-level V8 flags can override resourceLimits. Fail closed if
  // the effective heap exceeds 96 MiB old + 8 MiB young and V8 internal space.
  if (getHeapStatistics().heap_size_limit > 128 * 1024 * 1024) throw new Error('glob_worker_heap_config');
  const { input, limits } = workerData;
  const output = workerData.kind==='grep' ? await grep(input,limits) : { entries: await search(input, limits), truncated: [] };
  parentPort.postMessage({ ok: true, entries: output.entries, truncated: output.truncated });
} catch (error) {
  const code = error instanceof Error && ['glob_scan_limit', 'glob_result_limit', 'glob_worker_heap_config',SCOPE_DENIED,
    'grep_invalid_input','grep_invalid_regex','grep_read_failed','grep_read_limit','grep_result_limit'].includes(error.message)
    ? error.message : 'glob_search_failed';
  parentPort.postMessage({ ok: false, code });
} finally { parentPort.close(); }
