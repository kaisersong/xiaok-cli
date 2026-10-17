import type {Command} from 'commander';
import {openSync,writeFileSync,fsyncSync,closeSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import type {UserArchiveReadRequest,UserArchiveListRequest} from '../runtime/verification/user-archive-client.js';
/** Explicit user command; source bodies are never printed to terminal/model logs. */
export async function exportProtectedArchive(input:UserArchiveReadRequest&{output:string},signal:AbortSignal):Promise<{path:string;kind:string;bytes:number}>{
 if(input.requestSource!=='user')throw Error('archive_request_source');
 if(typeof input.output!=='string'||!input.output)throw Error('archive_output_required');
 const destination=resolve(input.output);try{lstatSync(destination);throw Error('archive_output_exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const [{createInstalledVerificationClient},{readUserArchive}]=await Promise.all([import('../runtime/verification/controller-client.js'),import('../runtime/verification/user-archive-client.js')]);const client=createInstalledVerificationClient();
 try{
  const result=await readUserArchive(client.archiveTransport,{requestSource:input.requestSource,ownerKind:input.ownerKind,ownerId:input.ownerId,resource:input.resource},signal);signal.throwIfAborted();
  const bytes=result.resource.kind==='protected-run'?result.streams.archive:Buffer.from(JSON.stringify({version:1,scope:'isolated-execution',resource:result.resource,stdoutBase64:result.streams.stdout.toString('base64'),stderrBase64:result.streams.stderr.toString('base64')})+'\n');
  const fd=openSync(destination,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  return {path:destination,kind:result.resource.kind,bytes:bytes.length};
 }finally{client.dispose();}
}
export function registerProtectedArchiveCommands(program:Command):void{
 const group=program.command('protected-archive').description('先 list 查找归档 ID，再经系统原生授权 read 导出正文');
 group.command('list').description('仅列出当前 owner 的归档 ID 和状态，不读取正文')
  .requiredOption('--kind <kind>','transcript 或 protected-run')
  .requiredOption('--owner-kind <kind>','task、goal、intent、project 或 loop')
  .requiredOption('--owner-id <id>','已登记业务 owner ID')
  .option('--cursor <cursor>','上一页的原始 nextCursor')
  .option('--limit <count>','每页 1 至 64 项','64')
  .action(async(options:{kind:string;ownerKind:string;ownerId:string;cursor?:string;limit:string})=>{if(!['transcript','protected-run'].includes(options.kind)||!['task','goal','intent','project','loop'].includes(options.ownerKind)||!/^\d+$/.test(options.limit))throw Error('archive_command_scope');console.log(JSON.stringify(await discoverProtectedArchives({requestSource:'user',ownerKind:options.ownerKind as UserArchiveListRequest['ownerKind'],ownerId:options.ownerId,kind:options.kind as UserArchiveListRequest['kind'],cursor:options.cursor??null,limit:Number(options.limit)},AbortSignal.timeout(30000))));});
 group.command('delete').description('经独立系统原生授权删除无验证引用的归档；不取消运行或解除义务')
  .requiredOption('--kind <kind>','transcript 或 protected-run').requiredOption('--id <id>','list 返回的归档 ID')
  .requiredOption('--owner-kind <kind>','task、goal、intent、project 或 loop').requiredOption('--owner-id <id>','已登记业务 owner ID')
  .action(async(options:{kind:string;id:string;ownerKind:string;ownerId:string})=>{
   if(!['transcript','protected-run'].includes(options.kind)||!['task','goal','intent','project','loop'].includes(options.ownerKind))throw Error('archive_command_scope');
   await removeProtectedArchive({requestSource:'user',ownerKind:options.ownerKind as UserArchiveReadRequest['ownerKind'],ownerId:options.ownerId,resource:{kind:options.kind as UserArchiveReadRequest['resource']['kind'],id:options.id}},AbortSignal.timeout(300000));console.log('归档正文已删除，原身份与审计记录保留');
  });
 group.command('read').description('导出归档到新的私有文件；transcript 为 JSON，protected-run 为 NDJSON')
  .requiredOption('--kind <kind>','transcript 或 protected-run')
  .requiredOption('--id <id>','归档资源 ID 或原 run ID')
  .requiredOption('--owner-kind <kind>','task、goal、intent、project 或 loop')
  .requiredOption('--owner-id <id>','已登记的业务 owner ID')
  .requiredOption('--output <file>','新的输出文件，禁止覆盖现有文件')
  .action(async(options:{kind:string;id:string;ownerKind:string;ownerId:string;output:string})=>{
   if(!['transcript','protected-run'].includes(options.kind)||!['task','goal','intent','project','loop'].includes(options.ownerKind))throw Error('archive_command_scope');
   const result=await exportProtectedArchive({requestSource:'user',ownerKind:options.ownerKind as UserArchiveReadRequest['ownerKind'],ownerId:options.ownerId,resource:{kind:options.kind as UserArchiveReadRequest['resource']['kind'],id:options.id},output:options.output},AbortSignal.timeout(300000));
   console.log(`归档已写入 ${result.path}（${result.bytes} 字节）`);
  });
}

export async function discoverProtectedArchives(input:UserArchiveListRequest,signal:AbortSignal){if(input.requestSource!=='user')throw Error('archive_request_source');if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>64)throw Error('archive_list_limit');const [{createInstalledVerificationClient},{listUserArchives}]=await Promise.all([import('../runtime/verification/controller-client.js'),import('../runtime/verification/user-archive-client.js')]);const client=createInstalledVerificationClient();try{return await listUserArchives(client.archiveTransport,input,signal);}finally{client.dispose();}}

export async function removeProtectedArchive(input:UserArchiveReadRequest,signal:AbortSignal){if(input.requestSource!=='user')throw Error('archive_request_source');const [{createInstalledVerificationClient},{deleteUserArchive}]=await Promise.all([import('../runtime/verification/controller-client.js'),import('../runtime/verification/user-archive-client.js')]);const client=createInstalledVerificationClient();try{return await deleteUserArchive(client.archiveTransport,input,signal);}finally{client.dispose();}}
