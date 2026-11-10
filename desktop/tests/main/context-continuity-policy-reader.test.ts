// @vitest-environment node
import {expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readdirSync,rmSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DesktopContextContinuity} from '../../electron/context-continuity/runtime.js';
import {ContinuityPolicyReader} from '../../../src/runtime/context-continuity/policy-reader.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {CliArchiveImporter} from '../../electron/context-continuity/cli-archive.js';
it('reads claimed CLI provenance through the actual readonly connection and rejects deletion without writing policy',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-cli-policy-reader-')),main=new DesktopContextContinuity(root),sessions=join(root,'cli-sessions');
 try{
  const p=main.port(),files=new FileSessionStore(sessions);await files.save({sessionId:'cli',cwd:root,createdAt:1,updatedAt:2,lineage:['cli'],messages:[{role:'user',content:[{type:'text',text:'READONLY_CLI_CANARY'}]}],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  const importer=new CliArchiveImporter(p.service,p.actor,sessions),preview=await importer.preview({sessionId:'cli',operationId:'p'}),archive=await importer.claim({previewId:preview.previewId,manifestHash:preview.manifestHash,operationId:'c'}),source=p.service.listMessages(p.actor,archive.conversationId)[0].sourceId;
  const target=p.service.createConversation(p.actor,{operationId:'target'});p.service.bindTask(p.actor,{conversationId:target.id,taskId:'derived'});const ref=p.service.searchHistory(p.actor,{query:'READONLY_CLI_CANARY'}).hits[0];p.service.attachReference(p.actor,{refId:ref.refId,targetConversationId:target.id,operationId:'grant'});p.service.resolveReference({...p.actor,requestSource:'agent',taskId:'derived'},{refId:ref.refId});
  const reader=new ContinuityPolicyReader({dataRoot:root,profileId:p.actor.profileId,scope:()=>'readable'});expect(()=>reader.assertTasksReadable([source,'derived'])).not.toThrow();
  p.service.tombstoneConversation(p.actor,archive.conversationId);expect(()=>reader.assertTaskReadable(source)).toThrow('not_readable');expect(()=>reader.assertTaskReadable('derived')).toThrow('not_readable');expect(p.service.store.db.prepare('SELECT valid FROM context_dependencies WHERE task_id=?').get('derived')?.valid).toBe(1);
 }finally{await main.close();rmSync(root,{recursive:true,force:true});}
});
it('reads the actual committed main policy and WAL without creating or modifying owner files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-policy-reader-')),main=new DesktopContextContinuity(root);
 try{
  const p=main.port(),source=p.service.createConversation(p.actor,{operationId:'source'}),target=p.service.createConversation(p.actor,{operationId:'target'});
  p.service.bindTask(p.actor,{conversationId:source.id,taskId:'source'});p.service.bindTask(p.actor,{conversationId:target.id,taskId:'derived'});
  p.service.recordMessage(p.actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'source',sourceDataEpoch:'epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'canary',executionState:'settled'});
  const ref=p.service.createReference(p.actor,{conversationId:source.id,expectedRevision:p.service.getConversation(p.actor,source.id)!.revision,operationId:'ref'}),grant=p.service.attachReference(p.actor,{refId:ref.refId,targetConversationId:target.id,operationId:'grant'});
  p.service.resolveReference({...p.actor,requestSource:'agent',taskId:'derived'},{refId:ref.refId});
  const inventory=()=>readdirSync(root).sort().map(name=>{const s=lstatSync(join(root,name));return{name,ino:s.ino,size:s.size,mode:s.mode};});
  const before=inventory(),reader=new ContinuityPolicyReader({dataRoot:root,profileId:p.actor.profileId,scope:()=>'readable'});
  expect(()=>reader.assertTaskReadable('derived')).not.toThrow();expect(inventory()).toEqual(before);
  p.service.revokeGrant(p.actor,grant);expect(()=>reader.assertTaskReadable('derived')).toThrow('not_readable');
  const replacement=p.service.attachReference(p.actor,{refId:ref.refId,targetConversationId:target.id,operationId:'new-grant'});expect(replacement.grantId).not.toBe(grant.grantId);expect(()=>reader.assertTaskReadable('derived')).toThrow('not_readable');
  // A read-only rejection does not write the writer's sticky invalid bit.
  expect(p.service.store.db.prepare('SELECT valid FROM context_dependencies WHERE task_id=?').get('derived')?.valid).toBe(1);
  await main.close();expect(()=>reader.assertTaskReadable('derived')).toThrow('not_readable');
 }finally{await main.close();rmSync(root,{recursive:true,force:true});}
});
it('never initializes missing protected policy and rejects mismatched identity or unknown schema',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-policy-reader-missing-')),reader=new ContinuityPolicyReader({dataRoot:root,profileId:'expected',scope:()=>'readable'});
 try{expect(()=>reader.assertTaskReadable('task')).toThrow('not_readable');expect(readdirSync(root)).toEqual([]);
  const main=new DesktopContextContinuity(root);try{const p=main.port();expect(()=>reader.assertTaskReadable('task')).toThrow('not_readable');
   const matching=new ContinuityPolicyReader({dataRoot:root,profileId:p.actor.profileId,scope:()=>'readable'});p.service.store.db.prepare("UPDATE continuity_meta SET value='future' WHERE key='schemaVersion'").run();expect(()=>matching.assertTaskReadable('task')).toThrow('not_readable');
   p.service.store.db.prepare("UPDATE continuity_meta SET value='1' WHERE key='schemaVersion'").run();const profile=join(root,'continuity-profile.json'),saved=readFileSync(profile,'utf8');writeFileSync(profile,'{}');expect(()=>matching.assertTaskReadable('task')).toThrow('not_readable');writeFileSync(profile,saved);
  }finally{await main.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('rejects suspended or unknown scope decisions and never creates missing WAL sidecars',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-policy-reader-scope-')),main=new DesktopContextContinuity(root);
 try{const p=main.port(),c=p.service.createConversation(p.actor,{operationId:'c'});p.service.bindTask(p.actor,{conversationId:c.id,taskId:'task'});
  for(const value of [Promise.resolve('readable'),undefined,'future','blocked','deleted']){
   const reader=new ContinuityPolicyReader({dataRoot:root,profileId:p.actor.profileId,scope:()=>value as never});expect(()=>reader.assertTaskReadable('task')).toThrow('not_readable');
  }
  await main.close();const wal=join(root,'continuity.sqlite-wal'),shm=join(root,'continuity.sqlite-shm');writeFileSync(wal,'unverified-residue');
  const reader=new ContinuityPolicyReader({dataRoot:root,profileId:p.actor.profileId,scope:()=>'readable'});expect(()=>reader.assertTaskReadable('task')).toThrow('not_readable');expect(readdirSync(root)).not.toContain('continuity.sqlite-shm');
  rmSync(wal);writeFileSync(shm,'unverified-residue');expect(()=>reader.assertTaskReadable('task')).toThrow('not_readable');rmSync(shm);
  writeFileSync(join(root,'continuity.sqlite-journal'),'unverified-residue');expect(()=>reader.assertTaskReadable('task')).toThrow('not_readable');
 }finally{await main.close();rmSync(root,{recursive:true,force:true});}
});

it('does not use an unlocked immutable snapshot while another process commits a new WAL revocation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-policy-reader-writer-')),main=new DesktopContextContinuity(root);let child:ReturnType<typeof spawn>|undefined;
 try{const p=main.port(),a=p.service.createConversation(p.actor,{operationId:'a'}),b=p.service.createConversation(p.actor,{operationId:'b'});
  p.service.bindTask(p.actor,{conversationId:a.id,taskId:'source'});p.service.bindTask(p.actor,{conversationId:b.id,taskId:'derived'});
  p.service.recordMessage(p.actor,{conversationId:a.id,sourceKind:'desktop_task',sourceId:'source',sourceDataEpoch:'epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'canary',executionState:'settled'});
  const ref=p.service.createReference(p.actor,{conversationId:a.id,expectedRevision:p.service.getConversation(p.actor,a.id)!.revision,operationId:'ref'}),grant=p.service.attachReference(p.actor,{refId:ref.refId,targetConversationId:b.id,operationId:'grant'});
  p.service.resolveReference({...p.actor,requestSource:'agent',taskId:'derived'},{refId:ref.refId});await main.close();expect(existsSync(join(root,'continuity.sqlite-wal'))).toBe(false);
  const ready=join(root,'writer-ready'),script=join(root,'writer.mjs');
  writeFileSync(script,`import{DatabaseSync}from'node:sqlite';import{writeFileSync}from'node:fs';const db=new DatabaseSync(process.argv[2]);db.exec('PRAGMA journal_mode=WAL');db.prepare('UPDATE read_grants SET revoked=1,revision=revision+1 WHERE id=?').run(process.argv[3]);writeFileSync(process.argv[4],'committed');setInterval(()=>{},1000);`);
  let once=true;const reader=new ContinuityPolicyReader({dataRoot:root,profileId:p.actor.profileId,scope:()=>{
   if(once){once=false;child=spawn(process.execPath,[script,join(root,'continuity.sqlite'),grant.grantId,ready],{stdio:'ignore'});console.info('owned concurrent policy writer PID',child.pid);
    const deadline=Date.now()+5000,pause=new Int32Array(new SharedArrayBuffer(4));while(!existsSync(ready)&&Date.now()<deadline)Atomics.wait(pause,0,0,10);if(!existsSync(ready))throw new Error('writer_timeout');
   }return 'readable';
  }});
  expect(()=>reader.assertTaskReadable('derived')).toThrow('not_readable');
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;expect(()=>process.kill(child!.pid!,0)).toThrow();}
  await main.close();rmSync(root,{recursive:true,force:true});
 }
},10000);
