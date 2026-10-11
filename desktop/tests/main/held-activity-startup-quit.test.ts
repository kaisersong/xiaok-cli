// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {startDesktopKSwarmService} from '../../electron/kswarm-service-lifetime.js';
it('actual whole startup token retains held owner config and refuses its late grant after quit before attach or start',async()=>{
 const gate=new DesktopShutdownGate(),service=createKSwarmService({activityOwnerPending:true});
 let release!: (value: Awaited<ReturnType<NonNullable<typeof service.activityOwnerConfig>>>)=>void;
 const held=new Promise<Awaited<ReturnType<NonNullable<typeof service.activityOwnerConfig>>>>(done=>{release=done;});
 const config=vi.spyOn(service,'activityOwnerConfig').mockReturnValue(held),start=vi.spyOn(service,'start'),attach=vi.fn(async()=>{throw Error('late attachment must never run');});
 const pending=startDesktopKSwarmService(gate,service,attach);void pending.catch(()=>{});
 try{expect(config).toHaveBeenCalledOnce();expect(gate.outstanding).toBe(1);gate.close();expect(await gate.drain(1)).toBe(false);
 release({kswarm:{url:'http://127.0.0.1:1',mutationToken:'fixture',brokerUrl:'http://127.0.0.1:1',roomToken:'fixture'},managedSources:[]});
 await expect(pending).rejects.toThrow('shutting_down');expect(attach).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();expect(await gate.drain(0)).toBe(true);
 }finally{config.mockRestore();start.mockRestore();await sealAndDrainKSwarmServiceInstance(service);}
});
