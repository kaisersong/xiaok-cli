// @vitest-environment node
import {expect,it} from 'vitest';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
it('actual sealed KSwarm source owner refuses newly added activity owner admission before private client or filesystem work',async()=>{
 const service=createKSwarmService({activityOwnerPending:true});
 try{expect(typeof service.activityOwnerConfig).toBe('function');expect(typeof service.bindActivityOwner).toBe('function');await sealAndDrainKSwarmServiceInstance(service);
 await expect(service.activityOwnerConfig!()).rejects.toThrow(/closed|sealed|closing/);
 expect(()=>service.bindActivityOwner!({} as Parameters<NonNullable<typeof service.bindActivityOwner>>[0])).toThrow(/closed|sealed|closing/);
 }finally{await sealAndDrainKSwarmServiceInstance(service);}
});
