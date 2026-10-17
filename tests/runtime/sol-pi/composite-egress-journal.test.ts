import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompositeEgressJournal} from '../../../src/runtime/sol-pi/composite-egress-journal.js';
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const cleanup of cleanups.reverse())cleanup();cleanups.length=0;});
function fixture(){const root=mkdtempSync(join(tmpdir(),'composite-journal-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const journal=createCompositeEgressJournal({root,egressId:'host-egress',generation:1});cleanups.push(()=>journal.close());return {root,journal};}
const attempt={attemptId:'attempt-1',invocationId:'invocation-1',bodySha256:'a'.repeat(64),destination:'https://example.test/v1/chat/completions',model:'fixture',protocol:'generic-openai',participants:[{authorityId:'authority-a',leaseId:'lease-a',evidenceSha256:'b'.repeat(64)}],reservationSha256:'c'.repeat(64)};
it('persists immutable exact attempt facts and never downgrades a committed dispatch to a no-dispatch abort',()=>{const {journal}=fixture();journal.prepare(attempt);expect(journal.query('attempt-1')?.state).toBe('PREPARING');journal.markPrepared('attempt-1');journal.commitDispatch('attempt-1');expect(()=>journal.abortBeforeDispatch('attempt-1')).toThrow();journal.settle('attempt-1','UNKNOWN');expect(()=>journal.settle('attempt-1','SUCCEEDED')).toThrow();expect(()=>journal.commitDispatch('attempt-1')).toThrow();expect(journal.query('attempt-1')?.state).toBe('UNKNOWN');});
it('rejects a changed body, missing participant, duplicate authority and second dispatch using real SQLite state',()=>{const {journal}=fixture();journal.prepare(attempt);expect(()=>journal.prepare({...attempt,bodySha256:'d'.repeat(64)})).toThrow();expect(()=>journal.prepare({...attempt,attemptId:'empty',participants:[]})).toThrow();expect(()=>journal.prepare({...attempt,attemptId:'duplicate',participants:[...attempt.participants,...attempt.participants]})).toThrow();journal.markPrepared('attempt-1');journal.commitDispatch('attempt-1');expect(()=>journal.commitDispatch('attempt-1')).toThrow();});
it('retains the irreversible dispatch record on reopen without inventing a physical fence or replay permission',()=>{const {root,journal}=fixture();journal.prepare(attempt);journal.markPrepared('attempt-1');journal.commitDispatch('attempt-1');journal.close();const reopened=createCompositeEgressJournal({root,egressId:'host-egress',generation:1});cleanups.push(()=>reopened.close());expect(reopened.query('attempt-1')?.state).toBe('DISPATCH_COMMITTED');expect(()=>reopened.commitDispatch('attempt-1')).toThrow();reopened.close();expect(()=>createCompositeEgressJournal({root,egressId:'host-egress',generation:2})).toThrow();});
it('keeps a pre-dispatch abort terminal and rejects another live journal owner',()=>{const {root,journal}=fixture();expect(()=>createCompositeEgressJournal({root,egressId:'host-egress',generation:1})).toThrow();journal.prepare(attempt);journal.abortBeforeDispatch('attempt-1');expect(()=>journal.markPrepared('attempt-1')).toThrow();expect(journal.query('attempt-1')?.state).toBe('ABORTED_NO_DISPATCH');});

it('rejects an existing unversioned SQLite database instead of silently treating it as a fresh egress owner',async()=>{const {default:Database}=await import('better-sqlite3');const root=mkdtempSync(join(tmpdir(),'composite-existing-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));const db=new Database(join(root,'attempts.sqlite'));db.exec('CREATE TABLE unrelated(value TEXT)');db.close();expect(()=>createCompositeEgressJournal({root,egressId:'new',generation:1})).toThrow();});
it('survives a real issuer SIGKILL after durable dispatch commit and does not recreate replay permission',async()=>{
 const {spawn}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'composite-crash-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const moduleUrl=new URL('../../../src/runtime/sol-pi/composite-egress-journal.ts',import.meta.url).href;
 const code=`import(${JSON.stringify(moduleUrl)}).then(({createCompositeEgressJournal})=>{const j=createCompositeEgressJournal({root:process.argv[1],egressId:'crash-egress',generation:1});j.prepare(JSON.parse(process.argv[2]));j.markPrepared('attempt-1');j.commitDispatch('attempt-1');process.send('committed');setInterval(()=>{},1000);});`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code,root,JSON.stringify(attempt)],{stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr!.on('data',data=>{stderr+=data;});
 const exit=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
 try{await new Promise<void>((resolve,reject)=>{child.once('message',value=>value==='committed'?resolve():reject(Error('unexpected issuer message')));child.once('error',reject);child.once('exit',()=>reject(Error(`issuer exited before commit: ${stderr}`)));});child.kill('SIGKILL');await exit;
 const recovered=createCompositeEgressJournal({root,egressId:'crash-egress',generation:1});cleanups.push(()=>recovered.close());expect(recovered.query('attempt-1')?.state).toBe('DISPATCH_COMMITTED');expect(()=>recovered.commitDispatch('attempt-1')).toThrow();expect(()=>recovered.abortBeforeDispatch('attempt-1')).toThrow();
 }finally{child.kill('SIGKILL');await exit;}
},15000);

it('rejects dispatch after its root pathname is replaced even when the replacement has a valid independent journal',()=>{
 const {root,journal}=fixture();journal.prepare(attempt);journal.markPrepared(attempt.attemptId);
 const moved=root+'-moved';renameSync(root,moved);cleanups.unshift(()=>rmSync(moved,{recursive:true,force:true}));mkdirSync(root,{mode:0o700});
 const other=createCompositeEgressJournal({root,egressId:'host-egress',generation:1});cleanups.push(()=>other.close());
 expect(()=>journal.commitDispatch(attempt.attemptId)).toThrow();
});
it('rejects a replaced owner lock inode instead of keeping admission through its unlinked SQLite lock',()=>{
 const {root,journal}=fixture();journal.prepare(attempt);journal.markPrepared(attempt.attemptId);
 const moved=root+'-owner';renameSync(join(root,'owner.sqlite'),moved);cleanups.unshift(()=>rmSync(moved,{force:true}));
 const other=createCompositeEgressJournal({root,egressId:'host-egress',generation:1});cleanups.push(()=>other.close());
 expect(()=>journal.commitDispatch(attempt.attemptId)).toThrow();
});
it('preserves the exact authorized provider URL query and rejects altered reuse',()=>{
 const {journal}=fixture(),bound={...attempt,destination:attempt.destination+'?api-version=2026-01-01'};
 expect(journal.prepare(bound).destination).toBe(bound.destination);
 expect(()=>journal.prepare({...bound,destination:attempt.destination+'?api-version=2026-02-01'})).toThrow();
});
