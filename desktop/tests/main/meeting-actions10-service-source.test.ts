// UNREVIEWED source-before controls. Copy to desktop/tests/main/meeting-actions10-service-source.test.ts.
// @vitest-environment node
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { createMeetingService } from '../../electron/meeting-service.js';
import { createKbStoreSqlite } from '../../electron/kb-store-sqlite.js';
import { encodePcm16Wav } from '../../electron/meeting-audio-format.js';
it.each((['processRecording','draftRecording','saveTranscript']as const).flatMap(method=>[undefined,'agent','scheduler','unknown','inherited-user','source-getter','proxy-user'].map(source=>[method,source]as const)))('actual service %s default-denies %s before audio/runtime/store work',async(method,source)=>{
 const root=mkdtempSync(join(tmpdir(),'meeting-source-owned-')),store=createKbStoreSqlite(join(root,'knowledge.db'));let runtime=0,getters=0;
 const service=createMeetingService({store,transcriber:{transcribeFile:async()=>{runtime++;throw Error('runtime_must_not_run');}},summaryService:{summarizeMeeting:async()=>{runtime++;throw Error('summary_must_not_run');}}});
 let input:Record<string,unknown>=Object.defineProperty({requestSource:source,audioFilePath:join(root,'absent.wav'),collectionId:'owned',transcript:'owned'},'title',{enumerable:true,get(){getters++;throw Error('field_must_not_be_read');}});
 if(source==='inherited-user')input=Object.assign(Object.create({requestSource:'user'}),{audioFilePath:join(root,'absent.wav')});
 if(source==='source-getter')Object.defineProperty(input,'requestSource',{get(){getters++;return 'user';}});
 if(source==='proxy-user')input=new Proxy({requestSource:'user'},{get(){getters++;return 'user';}});
 try{expect(await service[method](input as never)).toEqual({ok:false,error:'agent_meeting_write_forbidden'});expect(runtime).toBe(0);expect(getters).toBe(0);expect(store.listMeetings()).toEqual([]);}finally{store.close();rmSync(root,{recursive:true,force:true});}
});
it('actual user transcript writer and scheduler-only interrupted-meeting recovery remain separate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'meeting-source-normal-owned-')),store=createKbStoreSqlite(join(root,'knowledge.db'));
 try{const audio=join(root,'owned.wav');writeFileSync(audio,encodePcm16Wav({samples:new Int16Array([0]),sampleRate:16000,channels:1}));const collection=store.createCollection({name:'owned',embeddingModelId:'owned',embeddingDim:1},'user'),service=createMeetingService({store});
 expect((await service.saveTranscript({requestSource:'user',collectionId:collection.id,title:'owned',audioFilePath:audio,transcript:'owned transcript'})).ok).toBe(true);
 const row=store.createMeeting({status:'recording',startedAt:1,audioFilePath:audio},'user');const recovered=await service.recoverMeetings();expect(recovered).toContainEqual({meetingId:row.id,from:'recording',to:'interrupted'});expect(store.getMeeting(row.id)?.status).toBe('interrupted');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
