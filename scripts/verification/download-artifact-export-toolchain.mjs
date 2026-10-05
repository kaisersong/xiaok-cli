import {createHash} from 'node:crypto';
import {constants,openSync,lstatSync,fstatSync,readSync,closeSync,mkdirSync,mkdtempSync,linkSync,rmSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {dirname,join,isAbsolute} from 'node:path';
const MAX_ARCHIVE=256*1024*1024;
function officialUrl(raw){const url=new URL(raw);if(!['https://go.dev','https://dl.google.com'].includes(url.origin)||url.username||url.password)throw Error('artifact_export_sdk_redirect');return url;}
function metadata(entry){if(!entry||Object.keys(entry).sort().join(',')!=='filename,sha256,size'||!/^go1\.27\.1\.(darwin|linux|windows)-(arm64|amd64)\.(tar\.gz|zip)$/.test(entry.filename)||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>MAX_ARCHIVE)throw Error('artifact_export_sdk_metadata');return Object.freeze({...entry});}
function verifyExisting(file,entry){
 let stat;try{stat=lstatSync(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==BigInt(entry.size))throw Error('artifact_export_sdk_existing_size');
 const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const same=s=>s.dev===stat.dev&&s.ino===stat.ino&&s.size===stat.size&&s.mtimeNs===stat.mtimeNs&&s.ctimeNs===stat.ctimeNs;if(!same(fstatSync(fd,{bigint:true})))throw Error('artifact_export_sdk_existing_changed');const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;while(offset<entry.size){const n=readSync(fd,buffer,0,Math.min(buffer.length,entry.size-offset),offset);if(!n)throw Error('artifact_export_sdk_existing_short');offset+=n;digest.update(buffer.subarray(0,n));}if(readSync(fd,buffer,0,1,offset)||!same(fstatSync(fd,{bigint:true}))||!same(lstatSync(file,{bigint:true}))||digest.digest('hex')!==entry.sha256)throw Error('artifact_export_sdk_existing_hash');return true;}finally{closeSync(fd);}
}
/** Build-time download only. The production CLI supplies the fixed official lock
 * and global fetch; injected transport is solely for bounded failure tests. */
export async function downloadArtifactExportToolchain({entry:raw,destination,signal,fetchImpl=globalThis.fetch,timeoutMs=120000}){
 const entry=metadata(raw);if(!isAbsolute(destination)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('artifact_export_sdk_input');
 const deadline=AbortSignal.timeout(timeoutMs),active=signal?AbortSignal.any([signal,deadline]):deadline;active.throwIfAborted();
 if(verifyExisting(destination,entry))return destination;
 mkdirSync(dirname(destination),{recursive:true});const work=mkdtempSync(join(dirname(destination),'.sdk-download-'));let file,reader;
 try{
  const temporary=join(work,'archive');file=await open(temporary,'wx',0o600);active.throwIfAborted();
  let url=officialUrl('https://go.dev/dl/'+entry.filename),response;
  for(let redirects=0;;redirects++){
   active.throwIfAborted();response=await fetchImpl(url,{redirect:'manual',signal:active,headers:{'Accept-Encoding':'identity'}});active.throwIfAborted();
   if(![301,302,303,307,308].includes(response.status))break;
   await response.body?.cancel();if(redirects>=5)throw Error('artifact_export_sdk_redirect_limit');const location=response.headers.get('location');if(!location)throw Error('artifact_export_sdk_redirect');url=officialUrl(new URL(location,url));
  }
  if(response.status!==200||!response.body){await response.body?.cancel();throw Error('artifact_export_sdk_http');}
  reader=response.body.getReader();const hash=createHash('sha256');let size=0;
  for(;;){active.throwIfAborted();const chunk=await reader.read();active.throwIfAborted();if(chunk.done)break;if(!(chunk.value instanceof Uint8Array)||size+chunk.value.byteLength>entry.size)throw Error('artifact_export_sdk_size');size+=chunk.value.byteLength;hash.update(chunk.value);let offset=0;while(offset<chunk.value.byteLength){active.throwIfAborted();const written=await file.write(chunk.value,offset,chunk.value.byteLength-offset);if(written.bytesWritten<1)throw Error('artifact_export_sdk_write');offset+=written.bytesWritten;}}
  if(size!==entry.size||hash.digest('hex')!==entry.sha256)throw Error('artifact_export_sdk_hash');
  await file.sync();await file.close();file=undefined;active.throwIfAborted();
  try{linkSync(temporary,destination);}catch(error){if(error.code!=='EEXIST'||!verifyExisting(destination,entry))throw error;}
  return destination;
 }finally{try{await reader?.cancel();}catch{}try{await file?.close();}finally{rmSync(work,{recursive:true,force:true,maxRetries:3});}}
}
