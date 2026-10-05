import {afterAll,beforeAll,expect,it} from 'vitest';
import {spawn,spawnSync,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {copyFileSync,realpathSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,statSync,renameSync,symlinkSync,linkSync,rmSync,openSync,writeSync,closeSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
const root=resolve(import.meta.dirname,'../../..'),work=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-export-helper-'))),binary=join(work,process.platform==='win32'?'export.exe':'export'),children=new Set<ChildProcessWithoutNullStreams>();
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
beforeAll(()=>{
 const lock=JSON.parse(readFileSync(join(root,'scripts/verification/artifact-export-toolchain.lock.json'),'utf8'));
 const host=lock.hosts[`${process.platform}-${process.arch}`];
 const archive=process.env.XIAOK_EXPORT_HELPER_TOOLCHAIN_ARCHIVE??join(root,'.artifacts/solpi-build-tools',host.filename);
 const target=`${process.platform}-${process.arch}`;
 const built=spawnSync(process.execPath,[join(root,'scripts/verification/build-artifact-export-helper.mjs'),'--target',target,'--toolchain-archive',archive],{env:{...process.env,TAR_OPTIONS:'--invalid-inherited-tar-option',GOROOT:join(work,'untrusted-sdk'),GOFLAGS:'-overlay=invalid-inherited-overlay.json',GOCACHEPROG:'must-not-execute'},encoding:'utf8',timeout:150000});
 expect(built.error?.message??built.stderr).toBe('');expect(built.status).toBe(0);
 const {output}=JSON.parse(built.stdout.trim()),manifest=JSON.parse(readFileSync(join(output,'manifest.json'),'utf8'));
 expect(manifest.toolchainArchive.sha256).toBe(host.sha256);
 copyFileSync(join(output,manifest.filename),binary);
 expect(hash(readFileSync(binary))).toBe(manifest.sha256);
},180000);
afterAll(()=>{for(const child of children)child.kill('SIGKILL');rmSync(work,{recursive:true,force:true});});
function launch(content:Buffer,options:{parent?:string;target?:string;digest?:string;wrongIdentity?:boolean}={}){
 const ownershipToken=randomBytes(32).toString('hex');const parent=options.parent??join(work,randomUUID());mkdirSync(parent,{recursive:true});const temporary='.xiaok-export-'+randomUUID(),target=options.target??'result.bin',info=statSync(parent,{bigint:true});
 const child=spawn(binary,[parent,temporary,target,String(content.length),options.digest??hash(content),String(info.dev),String(options.wrongIdentity?0n:info.ino),ownershipToken],{stdio:'pipe'});children.add(child);
 const records:any[]=[];let output='',error='',ended=false;const pending:{stage:string;resolve(value:any):void;reject(error:Error):void}[]=[];
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill('SIGKILL');return;}let newline:number;while((newline=output.indexOf('\n'))>=0){const line=output.slice(0,newline);output=output.slice(newline+1);let value:any;try{value=JSON.parse(line);}catch{child.kill('SIGKILL');continue;}records.push(value);for(const waiter of [...pending])if(waiter.stage===value.stage){pending.splice(pending.indexOf(waiter),1);waiter.resolve(value);}}});
 child.stderr.on('data',chunk=>{error+=chunk;});child.stdin.on('error',()=>{});
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null;records:any[];error:string}>((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{ended=true;children.delete(child);for(const waiter of pending)waiter.reject(Error(`helper closed before ${waiter.stage}: ${error} ${JSON.stringify(records)}`));pending.length=0;resolve({code,signal,records,error});});});
 function next(stage:string):Promise<any>{const previous=records.find(r=>r.stage===stage);if(previous)return Promise.resolve(previous);if(ended)return Promise.reject(Error('helper closed'));return new Promise((resolve,reject)=>pending.push({stage,resolve,reject}));}
 async function stage(){await next('ready');child.stdin.write('C');await next('created');child.stdin.write('W');child.stdin.write(content);return next('staged');}
 return {parent,temporary,target,child,done,next,stage,content,ownershipToken,parentIdentity:{device:String(info.dev),inode:String(info.ino)}};
}
it('requires an explicit create command and never writes on startup or EOF',async()=>{const f=launch(Buffer.from('original'));await f.next('ready');expect(existsSync(join(f.parent,f.temporary))).toBe(false);f.child.stdin.end();expect((await f.done).records.at(-1)).toMatchObject({stage:'finished',ok:false,committed:false,cleanup:'none'});});
it.each([0,16*1024**2])('exports exactly %i original bytes only after commit and removes its temporary link',async size=>{const content=Buffer.alloc(size,97),f=launch(content);await f.stage();expect(existsSync(join(f.parent,f.target))).toBe(false);f.child.stdin.end('K');expect((await f.done).records.at(-1)).toMatchObject({ok:true,committed:true,cleanup:'removed'});expect(hash(readFileSync(join(f.parent,f.target)))).toBe(hash(content));expect(existsSync(join(f.parent,f.temporary))).toBe(false);},15000);
it('does not overwrite an existing user destination',async()=>{const f=launch(Buffer.from('new'));writeFileSync(join(f.parent,f.target),'keep');await f.stage();f.child.stdin.end('K');expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false,cleanup:'removed'});expect(readFileSync(join(f.parent,f.target),'utf8')).toBe('keep');});
it.each(['wrong-hash','short-input','no-write'] as const)('rejects and cleans the actual created file for %s',async mode=>{const content=Buffer.from('original'),f=launch(content,{digest:mode==='wrong-hash'?'0'.repeat(64):undefined});await f.next('ready');f.child.stdin.write('C');await f.next('created');if(mode!=='no-write')f.child.stdin.write(Buffer.concat([Buffer.from('W'),mode==='short-input'?content.subarray(0,2):content]));f.child.stdin.end();expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false,cleanup:'removed'});expect(existsSync(join(f.parent,f.temporary))).toBe(false);expect(existsSync(join(f.parent,f.target))).toBe(false);});
it('cleans through the held directory after the directory is renamed',async()=>{const f=launch(Buffer.from('original'));await f.stage();const moved=f.parent+'-moved';renameSync(f.parent,moved);f.child.stdin.end();expect((await f.done).records.at(-1)).toMatchObject({ok:false,cleanup:'removed'});expect(existsSync(join(moved,f.temporary))).toBe(false);});
it('detects a changed temp at the staged checkpoint and does not remove the foreign replacement',async()=>{const f=launch(Buffer.from('original'));await f.stage();renameSync(join(f.parent,f.temporary),join(f.parent,'original-moved'));writeFileSync(join(f.parent,f.temporary),'foreign');f.child.stdin.end('K');expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false,cleanup:'unknown'});expect(readFileSync(join(f.parent,f.temporary),'utf8')).toBe('foreign');expect(existsSync(join(f.parent,f.target))).toBe(false);});
it('SIGKILL leaves observable uncommitted bytes without inventing a cleanup or success receipt',async()=>{const f=launch(Buffer.from('original'));await f.stage();f.child.kill('SIGKILL');const ended=await f.done;expect(ended.records.some(r=>r.stage==='finished')).toBe(false);expect(readFileSync(join(f.parent,f.temporary)).subarray(0,f.content.length).toString()).toBe('original');expect(existsSync(join(f.parent,f.target))).toBe(false);});
it.runIf(process.platform!=='win32')('graceful cancellation drains actual cleanup before the child closes',async()=>{const f=launch(Buffer.from('original'));await f.stage();f.child.kill('SIGTERM');expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false,cleanup:'removed'});expect(existsSync(join(f.parent,f.temporary))).toBe(false);});
it('rejects additional commit commands before publishing a destination',async()=>{const f=launch(Buffer.from('original'));await f.stage();f.child.stdin.end('KK');expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false,cleanup:'removed'});expect(existsSync(join(f.parent,f.target))).toBe(false);});
it('rehashes the held file at commit and rejects in-place changes after staging',async()=>{const f=launch(Buffer.from('original'));await f.stage();writeFileSync(join(f.parent,f.temporary),'modified');f.child.stdin.end('K');expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false});expect(existsSync(join(f.parent,f.target))).toBe(false);});
it('rejects a mismatched captured directory identity before creating any file',async()=>{const f=launch(Buffer.from('original'),{wrongIdentity:true});f.child.stdin.end();expect((await f.done).code).not.toBe(0);expect(existsSync(join(f.parent,f.temporary))).toBe(false);});
it.runIf(process.platform!=='win32').each(['report:final.md','CON','result.','back\\slash'])('preserves the actual POSIX basename %s',async target=>{const f=launch(Buffer.from('original'),{target});await f.stage();f.child.stdin.end('K');expect((await f.done).code).toBe(0);expect(readFileSync(join(f.parent,target),'utf8')).toBe('original');});
it.runIf(process.platform!=='win32')('rejects an initial symlink directory before any create',async()=>{const actual=join(work,randomUUID()),link=actual+'-link';mkdirSync(actual);symlinkSync(actual,link);const f=launch(Buffer.from('original'),{parent:link});f.child.stdin.end();expect((await f.done).code).not.toBe(0);expect(existsSync(join(actual,f.temporary))).toBe(false);});
it.runIf(process.platform==='darwin')('exports on an actual separately mounted APFS volume without requiring ancestor devices to match',async()=>{
 const disk=join(work,'export-test.dmg'),mount=join(work,'export-volume');mkdirSync(mount);
 const created=spawnSync('/usr/bin/hdiutil',['create','-size','64m','-fs','APFS','-volname','XiaokExportTest',disk],{encoding:'utf8',timeout:30000});expect(created.status,created.stderr).toBe(0);
 let mounted=false;
 try{const attached=spawnSync('/usr/bin/hdiutil',['attach','-nobrowse','-noautoopen','-mountpoint',mount,disk],{encoding:'utf8',timeout:30000});expect(attached.status,attached.stderr).toBe(0);mounted=true;expect(statSync(mount).dev).not.toBe(statSync(work).dev);const f=launch(Buffer.from('mounted original'),{parent:mount});await f.stage();f.child.stdin.end('K');expect((await f.done).code).toBe(0);expect(readFileSync(join(mount,f.target),'utf8')).toBe('mounted original');}
 finally{if(mounted){const detached=spawnSync('/usr/bin/hdiutil',['detach',mount],{encoding:'utf8',timeout:30000});expect(detached.status,detached.stderr).toBe(0);}}
},70000);

it.runIf(process.platform==='win32')('rejects a directory junction even though it shares the mounted-volume reparse tag',async()=>{
 const actual=join(work,randomUUID()),junction=actual+'-junction';mkdirSync(actual);symlinkSync(actual,junction,'junction');
 const f=launch(Buffer.from('original'),{parent:junction});f.child.stdin.end();expect((await f.done).code).not.toBe(0);expect(existsSync(join(actual,f.temporary))).toBe(false);
});
it.runIf(process.platform==='win32').each(['COM¹.txt','LPT².log','COM³','CONIN$','CONOUT$','con .txt'])('rejects Windows device basename %s before create',async target=>{
 const f=launch(Buffer.from('original'),{target});f.child.stdin.end('CWoriginalK');const ended=await f.done;
 expect(ended.code).not.toBe(0);expect(ended.records.some(r=>r.stage==='ready'||r.stage==='created')).toBe(false);expect(existsSync(join(f.parent,f.temporary))).toBe(false);
});

function recover(f:ReturnType<typeof launch>,file:{device:string;inode:string},progress:'created'|'staged'|'committing',token=f.ownershipToken){
 const result=spawnSync(binary,['--recover',f.parent,f.temporary,String(f.content.length),hash(f.content),f.parentIdentity.device,f.parentIdentity.inode,file.device,file.inode,token,progress],{encoding:'utf8',timeout:10000,input:''});
 expect(result.error).toBeUndefined();const lines=result.stdout.trim().split('\n');expect(lines).toHaveLength(1);return {code:result.status,receipt:JSON.parse(lines[0])};
}
it.each(['created','staged'] as const)('recovery cannot remove a live helper temporary object at %s',async progress=>{
 const f=launch(Buffer.from('original'));let file:{device:string;inode:string};if(progress==='staged')file=(await f.stage()).identity;else{await f.next('ready');f.child.stdin.write('C');file=(await f.next('created')).identity;}
 const result=recover(f,file,progress);expect(result.receipt).toMatchObject({stage:'recovered',ok:false,cleanup:'unknown',error:'file_lock'});expect(existsSync(join(f.parent,f.temporary))).toBe(true);f.child.stdin.end();await f.done;
});
it.each([0,16*1024**2])('recovers actual killed staged helper with exact %i byte payload',async size=>{
 const f=launch(Buffer.alloc(size,97)),staged=await f.stage();f.child.kill('SIGKILL');await f.done;const result=recover(f,staged.identity,'staged');expect(result).toMatchObject({code:0,receipt:{stage:'recovered',ok:true,cleanup:'removed',identity:staged.identity,token:f.ownershipToken}});expect(existsSync(join(f.parent,f.temporary))).toBe(false);expect(existsSync(join(f.parent,f.target))).toBe(false);
},15000);
it('recovers known created file without inventing fully written payload progress',async()=>{
 const f=launch(Buffer.from('original'));await f.next('ready');f.child.stdin.write('C');const created=await f.next('created');f.child.stdin.write('Wor');const deadline=Date.now()+3000;while(readFileSync(join(f.parent,f.temporary)).subarray(0,2).toString()!=='or'){if(Date.now()>deadline)throw Error('actual partial write missing');await new Promise(r=>setTimeout(r,5));}f.child.kill('SIGKILL');await f.done;
 expect(recover(f,created.identity,'created')).toMatchObject({code:0,receipt:{cleanup:'removed'}});
});
it('retains unknown after a parent move and cleans only after the original directory returns',async()=>{
 const f=launch(Buffer.from('original')),staged=await f.stage();f.child.kill('SIGKILL');await f.done;const moved=f.parent+'-moved';renameSync(f.parent,moved);expect(recover(f,staged.identity,'staged').receipt).toMatchObject({stage:'recovered',ok:false,cleanup:'unknown'});expect(existsSync(join(moved,f.temporary))).toBe(true);renameSync(moved,f.parent);expect(recover(f,staged.identity,'staged').receipt.cleanup).toBe('removed');
});
it('refuses a wrong durable token and a stable foreign replacement without deleting either',async()=>{
 const f=launch(Buffer.from('original')),staged=await f.stage();f.child.kill('SIGKILL');await f.done;expect(recover(f,staged.identity,'staged','0'.repeat(64)).receipt).toMatchObject({ok:false,cleanup:'unknown'});renameSync(join(f.parent,f.temporary),join(f.parent,'owned-moved'));writeFileSync(join(f.parent,f.temporary),'foreign');expect(recover(f,staged.identity,'staged').receipt).toMatchObject({ok:false,cleanup:'unknown'});expect(readFileSync(join(f.parent,f.temporary),'utf8')).toBe('foreign');
});
it('does not infer cleanup when the known temporary entry is missing',async()=>{
 const f=launch(Buffer.from('original')),staged=await f.stage();f.child.kill('SIGKILL');await f.done;rmSync(join(f.parent,f.temporary));expect(recover(f,staged.identity,'staged').receipt).toMatchObject({ok:false,cleanup:'unknown'});
});
it('refuses to truncate a staged temporary inode that is already hardlinked to an existing target',async()=>{
 const f=launch(Buffer.from('original'));await f.stage();linkSync(join(f.parent,f.temporary),join(f.parent,f.target));const before=readFileSync(join(f.parent,f.target));f.child.stdin.end('K');expect((await f.done).records.at(-1)).toMatchObject({ok:false,committed:false});expect(readFileSync(join(f.parent,f.target))).toEqual(before);
});
it('recovery removes only its temporary link while preserving a previously existing hardlink target',async()=>{
 const f=launch(Buffer.from('original')),staged=await f.stage();linkSync(join(f.parent,f.temporary),join(f.parent,f.target));f.child.kill('SIGKILL');await f.done;const before=readFileSync(join(f.parent,f.target));expect(recover(f,staged.identity,'staged').receipt.cleanup).toBe('removed');expect(readFileSync(join(f.parent,f.target))).toEqual(before);
});

it('checks staged payload content even when the original ownership trailer remains intact',async()=>{const f=launch(Buffer.from('original')),staged=await f.stage();f.child.kill('SIGKILL');await f.done;const fd=openSync(join(f.parent,f.temporary),'r+');try{writeSync(fd,Buffer.from('X'),0,1,0);}finally{closeSync(fd);}expect(recover(f,staged.identity,'staged').receipt).toMatchObject({ok:false,cleanup:'unknown',error:'content_changed'});expect(existsSync(join(f.parent,f.temporary))).toBe(true);});
it('retains an unknown object after its ownership trailer is removed',async()=>{const f=launch(Buffer.from('original')),staged=await f.stage();f.child.kill('SIGKILL');await f.done;truncateSync(join(f.parent,f.temporary),f.content.length);expect(recover(f,staged.identity,'committing').receipt).toMatchObject({ok:false,cleanup:'unknown',error:'file_token'});expect(readFileSync(join(f.parent,f.temporary),'utf8')).toBe('original');});
it.runIf(process.platform!=='win32')('refuses a stable symlink replacement and leaves its foreign referent untouched',async()=>{const f=launch(Buffer.from('original')),staged=await f.stage();f.child.kill('SIGKILL');await f.done;renameSync(join(f.parent,f.temporary),join(f.parent,'original-moved'));writeFileSync(join(f.parent,'foreign'),'foreign');symlinkSync('foreign',join(f.parent,f.temporary));expect(recover(f,staged.identity,'staged').receipt).toMatchObject({ok:false,cleanup:'unknown',error:'file_open'});expect(readFileSync(join(f.parent,'foreign'),'utf8')).toBe('foreign');});
