// @vitest-environment node
import {withExecutionLane} from '../../electron/desktop-execution-coordinator.js';
import {expect,it} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import * as os from 'node:os';
import {randomUUID} from 'node:crypto';
import {task7FactoryFixture} from './task7-factory-fixture.js';
import {createPreloadApi} from '../../electron/preload-api.js';
it.each(['ts','cjs'])('actual %s preload -> real Main coarse/finer authorizer -> registrar -> default native Host consumes one canonical submission',async kind=>{
 const f=await task7FactoryFixture();const ipc={invoke:async(channel:string,...args:unknown[])=>Reflect.apply(f.listeners.get(channel)!,undefined,[f.event,...args]),on(){},off(){},removeListener(){},send(){}};let api:ReturnType<typeof createPreloadApi>;
 if(kind==='ts')api=createPreloadApi(ipc);else runInNewContext(readFileSync(new URL('../../electron/preload.cjs',import.meta.url),'utf8'),{require(name:string){if(name==='electron')return {ipcRenderer:ipc,contextBridge:{exposeInMainWorld(_name:string,value:typeof api){api=value;}}};if(name==='os')return os;throw Error('unexpected');}});
 const wire={action:'submit_new' as const,gestureId:randomUUID(),input:{kind:'materials' as const,prompt:'Ordinary canonical user input',materials:[],context:{threadId:'canonical-thread'}}};
 const values=await Promise.all(Array.from({length:100},()=>api!.submitUserTask(wire)));expect(new Set(values.map(value=>value.taskId)).size).toBe(1);expect(f.hostCalls.prepare).toHaveBeenCalledOnce();expect(f.hostCalls.start).toHaveBeenCalledOnce();
 const sourceDir=join(f.dataRoot,'conversation-projects','user-inputs'),records=readdirSync(sourceDir).filter(name=>!name.startsWith('canonical-')).map(name=>JSON.parse(readFileSync(join(sourceDir,name),'utf8')));
 expect(records).toHaveLength(1);expect(records[0]).toMatchObject({schemaVersion:3,taskId:values[0].taskId,submissionId:values[0].submissionId,profileId:f.service.multiAgent!.profileId});
 expect(await api!.submitUserTask({action:'retry_existing',submissionId:values[0].submissionId})).toEqual(values[0]);expect(f.hostCalls.start).toHaveBeenCalledOnce();
});
it('actual Main predicates deny foreign sender, same-URL child frame, recorder and destroyed main before DTO getters',async()=>{
 const f=await task7FactoryFixture();const listener=f.listeners.get('desktop:submitUserTask')!;let reads=0;const raw={get action(){reads++;return 'submit_new';}};
 for(const event of [{sender:{...f.sender},senderFrame:f.frame},{sender:f.sender,senderFrame:{...f.frame}},{sender:f.recorder,senderFrame:f.recorderFrame}])await expect(Reflect.apply(listener,undefined,[event,raw])).rejects.toThrow();
 f.sender.destroy();await expect(Reflect.apply(listener,undefined,[f.event,raw])).rejects.toThrow();expect(reads).toBe(0);expect(f.hostCalls.prepare).not.toHaveBeenCalled();expect(f.modelCalls).toHaveLength(0);
});

it('the semantic user source entry cannot be silently consumed on a background lane',async()=>{
 const f=await task7FactoryFixture();let reads=0;const input={get action(){reads++;return 'submit_new';}};
 expect(()=>withExecutionLane('background',()=>f.service.submitUserTask(input,{requestSource:'user',actorId:`desktop-user:${f.service.multiAgent!.profileId}`}))).toThrow('user_submission_lane_forbidden');
 expect(reads).toBe(0);expect(f.hostCalls.prepare).not.toHaveBeenCalled();expect(f.modelCalls).toHaveLength(0);
});
