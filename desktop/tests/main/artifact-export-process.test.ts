// @vitest-environment node
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import * as childProcess from 'node:child_process';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,mkdirSync,statSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {runArtifactExportProcess,runArtifactExportRecovery,type ArtifactExportOutcome,type ArtifactExportProcessHooks} from '../../electron/artifact-export-process.js';
vi.mock('node:child_process',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:child_process')>();
 return {...actual,spawn:vi.fn(actual.spawn)};
});
const root=resolve(import.meta.dirname,'../../..'),work=realpathSync(mkdtempSync(join(tmpdir(),'xiaok-export-main-')));
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
let executable:string;
beforeAll(()=>{
 const folder=join(root,'.artifacts/artifact-export-helper',`${process.platform}-${process.arch}`),pointer=JSON.parse(readFileSync(join(folder,'current.json'),'utf8')),generation=join(folder,pointer.generation),manifestBytes=readFileSync(join(generation,'manifest.json')),manifest=JSON.parse(manifestBytes.toString());
 expect(hash(manifestBytes)).toBe(pointer.manifestSha256);
 for(const [name,digest] of Object.entries(manifest.sourceHashes))expect(hash(readFileSync(join(root,'desktop/native/artifact-export-helper',name)))).toBe(digest);
 executable=join(generation,manifest.filename);expect(hash(readFileSync(executable))).toBe(manifest.sha256);
});
afterAll(()=>rmSync(work,{recursive:true,force:true,maxRetries:3}));
function fixture(size=8){
 const parent=join(work,randomUUID());mkdirSync(parent);const s=statSync(parent,{bigint:true}),bytes=Buffer.alloc(size,97),events:string[]=[],settled:ArtifactExportOutcome[]=[];
 const input={executable,requestSource:'user' as const,parent,parentIdentity:{device:String(s.dev),inode:String(s.ino)},temporaryName:'.xiaok-export-'+randomUUID(),targetName:'result.bin',ownershipToken:randomBytes(32).toString('hex'),bytes,sha256:hash(bytes),signal:new AbortController().signal};
 const hooks:ArtifactExportProcessHooks={async prepare(){events.push('prepare');},async created(){events.push('created');},async staged(){events.push('staged');},async authorizeCommit(){events.push('authorize');return()=>{events.push('fence');};},async settled(outcome){events.push('settled');settled.push(outcome);}};
 return {input,hooks,events,settled};
}
it.each([0,16*1024**2])('uses the actual helper and orders durable callbacks before commands for %i bytes',async size=>{
 const f=fixture(size);const result=await runArtifactExportProcess({...f.input,hooks:f.hooks});
 expect(result).toMatchObject({status:'completed',committed:true,cleanup:'removed'});expect(f.events).toEqual(['prepare','created','staged','authorize','fence','settled']);expect(f.settled).toEqual([result]);expect(hash(readFileSync(join(f.input.parent,f.input.targetName)))).toBe(f.input.sha256);expect(existsSync(join(f.input.parent,f.input.temporaryName))).toBe(false);
},15000);
it.each(['prepare','created','staged','authorizeCommit'] as const)('waits for %s failure and actual cleanup without publishing',async stage=>{
 const f=fixture();f.hooks[stage]=async()=>{f.events.push(stage+'-failed');throw Error('durable_failure');};const result=await runArtifactExportProcess({...f.input,hooks:f.hooks});
 expect(result.status).toBe('failed');expect(result.committed).toBe(false);expect(result.cleanup).toBe(stage==='prepare'?'none':'removed');expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);expect(existsSync(join(f.input.parent,f.input.temporaryName))).toBe(false);expect(f.events.at(-1)).toBe('settled');expect(f.settled).toHaveLength(1);
});
it('checks the synchronous publication fence immediately before commit',async()=>{
 const f=fixture();f.hooks.authorizeCommit=async()=>()=>{throw Error('expired');};const result=await runArtifactExportProcess({...f.input,hooks:f.hooks});expect(result).toMatchObject({status:'failed',committed:false,cleanup:'removed'});expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);
});
it('preserves the actual helper failure when the temporary basename is already occupied',async()=>{
 const f=fixture();f.hooks.prepare=async()=>{writeFileSync(join(f.input.parent,f.input.temporaryName),'foreign');};
 const result=await runArtifactExportProcess({...f.input,hooks:f.hooks});
 expect(result).toMatchObject({status:'failed',committed:false,cleanup:'none',error:'create_failed'});expect(f.settled).toEqual([result]);expect(readFileSync(join(f.input.parent,f.input.temporaryName),'utf8')).toBe('foreign');expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);
});
it('drains an accidentally asynchronous fence before settling or returning, while refusing commit',async()=>{
 const f=fixture();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),released=new Promise<void>(r=>release=r);
 f.hooks.authorizeCommit=async()=>async()=>{enter();await released;f.events.push('invalid-fence-finished');};
 let returned=false;const result=runArtifactExportProcess({...f.input,hooks:f.hooks}).then(value=>{returned=true;return value;});
 await entered;await new Promise(r=>setTimeout(r,30));
 try{expect(f.settled).toHaveLength(0);expect(returned).toBe(false);}finally{release();}
 expect(await result).toMatchObject({status:'failed',committed:false,cleanup:'removed'});expect(f.events.slice(-2)).toEqual(['invalid-fence-finished','settled']);expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);
});
it.each(['prepare','created','staged','authorizeCommit'] as const)('cancellation during %s does not settle before that actual callback drains',async stage=>{
 const f=fixture(),abort=new AbortController();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),released=new Promise<void>(r=>release=r);
 const paused=async()=>{f.events.push('callback-start');enter();await released;f.events.push('callback-end');};
 if(stage==='authorizeCommit')f.hooks.authorizeCommit=async()=>{await paused();return()=>{};};else f.hooks[stage]=paused;
 const result=runArtifactExportProcess({...f.input,signal:abort.signal,hooks:f.hooks});await entered;abort.abort();await new Promise(r=>setTimeout(r,25));expect(f.settled).toHaveLength(0);release();
 expect(await result).toMatchObject({status:'failed',committed:false,cleanup:stage==='prepare'?'none':'removed'});expect(f.events.slice(-2)).toEqual(['callback-end','settled']);expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);
});
it.each(['agent','scheduler'] as const)('rejects %s before starting callbacks or the helper',async requestSource=>{
 const f=fixture();await expect(runArtifactExportProcess({...f.input,requestSource,executable:join(work,'missing'),hooks:f.hooks})).rejects.toThrow('artifact_export_source');expect(f.events).toEqual([]);
});
it('rejects an already cancelled request before spawning or preparing an intent',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();await expect(runArtifactExportProcess({...f.input,signal:abort.signal,executable:join(work,'missing'),hooks:f.hooks})).rejects.toThrow();expect(f.events).toEqual([]);
});
it('propagates a durable settled failure without pretending to remove a committed user file',async()=>{
 const f=fixture();f.hooks.settled=async()=>{throw Error('settlement_failed');};await expect(runArtifactExportProcess({...f.input,hooks:f.hooks})).rejects.toThrow('settlement_failed');expect(hash(readFileSync(join(f.input.parent,f.input.targetName)))).toBe(f.input.sha256);
});
it.runIf(process.platform!=='win32')('does not trust a success receipt emitted before any create or commit',async()=>{
 const f=fixture(),program=join(f.input.parent,'invalid-helper');writeFileSync(program,`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify({stage:'ready',ok:true,committed:false,identity:f.input.parentIdentity})+'\n'+JSON.stringify({stage:'finished',ok:true,committed:true,cleanup:'removed'})+'\n')});\n`);chmodSync(program,0o755);
 const result=await runArtifactExportProcess({...f.input,executable:program,hooks:f.hooks});expect(result).toMatchObject({status:'unknown',committed:null,cleanup:'unknown'});expect(f.events).toEqual(['settled']);
});
it('retains a real killed helper as unknown and does not delete the observable temporary file',async()=>{
 const f=fixture(),spy=vi.mocked(childProcess.spawn),original=spy.getMockImplementation()!;let owned:childProcess.ChildProcess|undefined;
 spy.mockImplementationOnce(((...args:unknown[])=>{owned=Reflect.apply(original,childProcess,args);return owned;}) as typeof childProcess.spawn);
 try{
  f.hooks.staged=async()=>{expect(owned).toBeDefined();owned!.kill('SIGKILL');};
  const result=await runArtifactExportProcess({...f.input,hooks:f.hooks});expect(result).toMatchObject({status:'unknown',committed:null,cleanup:'unknown'});expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);expect(hash(readFileSync(join(f.input.parent,f.input.temporaryName)).subarray(0,f.input.bytes.length))).toBe(f.input.sha256);expect(owned!.exitCode!==null||owned!.signalCode!==null).toBe(true);
 }finally{spy.mockImplementation(original);}
});
it.runIf(process.platform!=='win32')('rejects an error code inconsistent with the commands and confirmed stages',async()=>{
 const f=fixture(),program=join(f.input.parent,'invalid-failure');
 writeFileSync(program,`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify({stage:'ready',ok:true,committed:false,identity:f.input.parentIdentity})+'\n')});process.stdin.once('data',()=>{process.stdout.write(${JSON.stringify(JSON.stringify({stage:'finished',ok:false,committed:false,cleanup:'none',error:'write_failed'})+'\n')});process.exitCode=1;process.stdin.destroy();});\n`);chmodSync(program,0o755);
 const result=await runArtifactExportProcess({...f.input,executable:program,hooks:f.hooks});expect(result).toMatchObject({status:'unknown',committed:null,cleanup:'unknown'});expect(f.events).toEqual(['prepare','settled']);
});

it('rejects malformed ownership tokens before spawning',async()=>{const f=fixture(),spawn=vi.mocked(childProcess.spawn);spawn.mockClear();await expect(runArtifactExportProcess({...f.input,ownershipToken:'invalid',hooks:f.hooks})).rejects.toThrow();expect(spawn).not.toHaveBeenCalled();});
function recoveryInput(f:ReturnType<typeof fixture>,fileIdentity:{device:string;inode:string}){return {executable:f.input.executable,requestSource:'user' as const,parent:f.input.parent,parentIdentity:f.input.parentIdentity,temporaryName:f.input.temporaryName,fileIdentity,ownershipToken:f.input.ownershipToken,size:f.input.bytes.length,sha256:f.input.sha256,progress:'staged' as const,signal:new AbortController().signal};}
it('recovers the real killed child only after its native lock and ownership token are verified',async()=>{
 const f=fixture(),spy=vi.mocked(childProcess.spawn),original=spy.getMockImplementation()!;let owned:childProcess.ChildProcess|undefined,fileIdentity!:{device:string;inode:string};spy.mockImplementationOnce(((...args:unknown[])=>{owned=Reflect.apply(original,childProcess,args);return owned;}) as typeof childProcess.spawn);
 try{f.hooks.created=async id=>{fileIdentity=id;};f.hooks.staged=async()=>{owned!.kill('SIGKILL');};expect((await runArtifactExportProcess({...f.input,hooks:f.hooks})).status).toBe('unknown');expect(await runArtifactExportRecovery(recoveryInput(f,fileIdentity))).toEqual({cleanup:'removed',error:null});expect(existsSync(join(f.input.parent,f.input.temporaryName))).toBe(false);expect(existsSync(join(f.input.parent,f.input.targetName))).toBe(false);}finally{spy.mockImplementation(original);}
});
it('waits on actual live-lock refusal before the original owner performs its own cleanup',async()=>{
 const f=fixture();let fileIdentity!:{device:string;inode:string};f.hooks.created=async id=>{fileIdentity=id;};f.hooks.staged=async()=>{expect(await runArtifactExportRecovery(recoveryInput(f,fileIdentity))).toEqual({cleanup:'unknown',error:'file_lock'});expect(existsSync(join(f.input.parent,f.input.temporaryName))).toBe(true);throw Error('cancel original copy');};expect((await runArtifactExportProcess({...f.input,hooks:f.hooks})).cleanup).toBe('removed');
});
it.each(['agent','scheduler'] as const)('rejects %s recovery before any spawn',async requestSource=>{const f=fixture(),spawn=vi.mocked(childProcess.spawn);spawn.mockClear();await expect(runArtifactExportRecovery({...recoveryInput(f,{device:'1',inode:'2'}),requestSource})).rejects.toThrow('artifact_export_source');expect(spawn).not.toHaveBeenCalled();});
it.runIf(process.platform!=='win32').each(['double','wrong-token','exit-failure'])('rejects a %s recovery receipt and still drains the actual child',async mode=>{
 const f=fixture(),file={device:'1',inode:'2'},program=join(f.input.parent,'recovery-fixture'),receipt=JSON.stringify({stage:'recovered',ok:true,cleanup:'removed',identity:file,token:mode==='wrong-token'?'0'.repeat(64):f.input.ownershipToken})+'\n';writeFileSync(program,`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(mode==='double'?receipt+receipt:receipt)});process.exitCode=${mode==='exit-failure'?1:0};\n`);chmodSync(program,0o755);expect((await runArtifactExportRecovery({...recoveryInput(f,file),executable:program})).cleanup).toBe('unknown');
});
it.runIf(process.platform!=='win32')('does not accept an emitted recovery receipt until actual close and honors cancellation',async()=>{
 const f=fixture(),file={device:'1',inode:'2'},program=join(f.input.parent,'recovery-linger'),abort=new AbortController(),spy=vi.mocked(childProcess.spawn),original=spy.getMockImplementation()!;let owned:childProcess.ChildProcess|undefined;let receiptSeen!:()=>void;const seen=new Promise<void>(r=>receiptSeen=r);writeFileSync(program,`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify({stage:'recovered',ok:true,cleanup:'removed',identity:file,token:f.input.ownershipToken})+'\n')});setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));\n`);chmodSync(program,0o755);
 spy.mockImplementationOnce(((...args:unknown[])=>{owned=Reflect.apply(original,childProcess,args);owned!.stdout!.once('data',receiptSeen);return owned;}) as typeof childProcess.spawn);
 try{let finished=false;const pending=runArtifactExportRecovery({...recoveryInput(f,file),executable:program,signal:abort.signal}).then(v=>{finished=true;return v;});await seen;expect(finished).toBe(false);abort.abort();expect((await pending).cleanup).toBe('unknown');expect(owned!.exitCode!==null||owned!.signalCode!==null).toBe(true);}finally{spy.mockImplementation(original);}
},10000);

it('two actual helpers competing for one target publish exactly one complete immutable copy',async()=>{
 const first=fixture(1024*1024),second=fixture(1024*1024);
 second.input.parent=first.input.parent;second.input.parentIdentity=first.input.parentIdentity;
 second.input.bytes.fill(98);second.input.sha256=hash(second.input.bytes);
 let arrivals=0,release!:()=>void;const bothStaged=new Promise<void>(resolve=>{release=resolve;});
 for(const f of [first,second])f.hooks.authorizeCommit=async()=>{
  f.events.push('authorize');if(++arrivals===2)release();await bothStaged;
  return()=>{f.events.push('fence');};
 };
 const outcomes=await Promise.all([first,second].map(f=>runArtifactExportProcess({...f.input,hooks:f.hooks})));
 expect(arrivals).toBe(2);
 const winner=outcomes.findIndex(outcome=>outcome.status==='completed');expect(winner).toBeGreaterThanOrEqual(0);
 expect(outcomes.filter(outcome=>outcome.status==='completed')).toHaveLength(1);
 expect(outcomes[1-winner]).toMatchObject({status:'failed',committed:false,cleanup:'removed',error:'link_failed'});
 const published=readFileSync(join(first.input.parent,first.input.targetName));
 expect(published.equals([first,second][winner].input.bytes)).toBe(true);
 for(const [index,f] of [first,second].entries()){
  expect(existsSync(join(f.input.parent,f.input.temporaryName))).toBe(false);
  expect(f.settled).toEqual([outcomes[index]]);expect(f.events.at(-1)).toBe('settled');
 }
},15000);

it('pins the original bytes before awaiting the first durable callback',async()=>{
 const f=fixture(1024*1024),originalHash=f.input.sha256;
 f.hooks.prepare=async()=>{f.events.push('prepare');f.input.bytes.fill(99);};
 const result=await runArtifactExportProcess({...f.input,hooks:f.hooks});
 expect(result).toMatchObject({status:'completed',committed:true,cleanup:'removed'});
 expect(hash(f.input.bytes)).not.toBe(originalHash);
 expect(hash(readFileSync(join(f.input.parent,f.input.targetName)))).toBe(originalHash);
 expect(f.settled).toEqual([result]);
},15000);
