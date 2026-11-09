// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readFileSync,readdirSync,promises as fsPromises} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import * as os from 'node:os';
import {task7FactoryFixture} from './task7-factory-fixture.js';
import {createPreloadApi} from '../../electron/preload-api.js';
function context(f:Awaited<ReturnType<typeof task7FactoryFixture>>){return {ok:true,protocol:'ordinary_project_followup_context_v1',classification:'ordinary',projectId:'project',projectRevision:3,projectStatus:'active',primaryRoomId:'room',scope:{profileId:createHash('sha256').update(f.dataRoot).digest('hex'),workspaceId:createHash('sha256').update(f.root).digest('hex')},bindingDigest:'a'.repeat(64),canonicalCreateDigest:'b'.repeat(64),conversionActions:{add_task:{eligible:false,reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'},add_revision:{eligible:false,reasonCode:'REVISION_BASE_NOT_READY'}}};}
const wire={action:'add_task' as const,roomId:'room',messageId:'message',projectId:'project',expectedProjectRevision:3,title:'Report'};
it.each(['ts','cjs'])('actual %s preload + actual Main native predicates + original source owner capture once, with no native Host/model/B mutation',async kind=>{
 const f=await task7FactoryFixture();f.sdk.request.mockImplementation(async()=>Response.json(context(f)));
 const reader=vi.fn(async()=>({ok:true,protocol:'room_conversion_source_v1',realmId:'11111111-1111-4111-8111-111111111111',actorUserId:'user.local',roomId:'room',roomRevision:1,membershipRevision:1,messageId:'message',messageSequence:1,text:'Actual referenced body',contextScope:{kind:'room_only'}}));
 f.service.bindRoomConversionBroker({getRoomConversionSource:reader});
 const ipc={invoke:async(channel:string,...args:unknown[])=>Reflect.apply(f.listeners.get(channel)!,undefined,[f.event,...args]),on(){},off(){},removeListener(){},send(){}};let api:ReturnType<typeof createPreloadApi>;
 if(kind==='ts')api=createPreloadApi(ipc);else runInNewContext(readFileSync(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:typeof api){api=value;}}};if(name==='os')return os;throw Error('unexpected');}});
 const values=await Promise.all(Array.from({length:100},()=>api!.captureRoomConversion(wire)));
 expect(new Set(values.map(value=>value.capture.captureId)).size).toBe(1);expect(values[0]).toMatchObject({execution:{state:'blocked',reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'}});
 expect(JSON.stringify(values[0])).not.toContain('Actual referenced body');expect(JSON.stringify(values[0])).not.toContain('sourceProof');
 expect(await api!.observeRoomConversion({captureId:values[0].capture.captureId})).toEqual(values[0].capture);
 expect(f.hostCalls.prepare).not.toHaveBeenCalled();expect(f.hostCalls.start).not.toHaveBeenCalled();expect(f.modelCalls).toHaveLength(0);
 expect(f.sdk.request.mock.calls.every(([path,init])=>path==='/projects/project/followup-context'&&init?.method==='GET')).toBe(true);
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions')).filter(name=>name.startsWith('room-')&&name.endsWith('.json'))).toHaveLength(1);
});
it('actual native authorizer refuses foreign/child/recorder/destroyed senders before reading either capture or observe DTO',async()=>{
 const f=await task7FactoryFixture();let reads=0;const raw={get action(){reads++;throw Error('wire getter');},get captureId(){reads++;throw Error('wire getter');}};
 for(const channel of ['desktop:roomConversion:capture','desktop:roomConversion:observe']){
  const listener=f.listeners.get(channel)!;
  for(const event of [{sender:{...f.sender},senderFrame:f.frame},{sender:f.sender,senderFrame:{...f.frame}},{sender:f.recorder,senderFrame:f.recorderFrame}])await expect(Reflect.apply(listener,undefined,[event,raw])).rejects.toThrow();
 }
 f.sender.destroy();await expect(Reflect.apply(f.listeners.get('desktop:roomConversion:capture')!,undefined,[f.event,raw])).rejects.toThrow();expect(reads).toBe(0);expect(f.sdk.request).not.toHaveBeenCalled();
});
it('actual Main becomes unavailable during source await and cannot leak an ACK or capture after sender destruction',async()=>{
 const f=await task7FactoryFixture();f.sdk.request.mockImplementation(async()=>Response.json(context(f)));
 f.service.bindRoomConversionBroker({getRoomConversionSource:async()=>{f.sender.destroy();return {ok:true,protocol:'room_conversion_source_v1',realmId:'11111111-1111-4111-8111-111111111111',actorUserId:'user.local',roomId:'room',roomRevision:1,membershipRevision:1,messageId:'message',messageSequence:1,text:'private',contextScope:{kind:'room_only'}};}});
 await expect(Reflect.apply(f.listeners.get('desktop:roomConversion:capture')!,undefined,[f.event,wire])).rejects.toThrow();expect(f.hostCalls.prepare).not.toHaveBeenCalled();
 expect(readdirSync(join(f.dataRoot,'conversation-projects','user-submissions'))).toEqual([]);
});

it('actual Main shutdown waits for the original Room history directory close before final source closure',async()=>{
 const f=await task7FactoryFixture();
 // Retire this fixture's cold user task before its source population is sealed.
 await f.originals.cancelTask(f.seed.taskId,{requestSource:'user',actorId:`desktop-user:${f.service.multiAgent!.profileId}`});
 const original=fsPromises.opendir.bind(fsPromises);let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(done=>{enter=done;}),barrier=new Promise<void>(done=>{release=done;}),journal=join(f.dataRoot,'conversation-projects','user-submissions');
 const opener=vi.spyOn(fsPromises,'opendir').mockImplementation(async(...args)=>{const directory=await original(...args);if(String(args[0])===journal){const close=directory.close.bind(directory);vi.spyOn(directory,'close').mockImplementation(async()=>{enter();await barrier;return close();});}return directory;});
 const pending=(Reflect.apply(f.listeners.get('desktop:roomConversion:capture')!,undefined,[f.event,wire]) as Promise<unknown>).catch(error=>error);
 try{await entered;f.service.taskShutdown.ingress.stopAccepting();f.service.taskShutdown.ingress.abortAllActive('fixture_cleanup');expect(await f.service.taskShutdown.ingress.drain(20)).toBe(false);
  release();expect(String(await pending)).toContain('room_conversion_closed');expect(await f.service.taskShutdown.ingress.drain(5000)).toBe(true);expect(f.sdk.request).not.toHaveBeenCalled();
 }finally{release();await pending;opener.mockRestore();}
});
