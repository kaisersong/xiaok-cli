import {expect,it} from 'vitest';
import {ActivitySourceSupervisor} from '../../../src/runtime/conversation-activity/source-supervisor.js';
const original=()=>import('../../../src/runtime/conversation-activity/canonical-dispatch-business.js');
it('cannot mint canonical business birth from an imported module or JSON role claims',async()=>{
 const {mintCanonicalDesktopBusinessBirth}=await original();expect(mintCanonicalDesktopBusinessBirth()).toBeUndefined();
 expect((mintCanonicalDesktopBusinessBirth as Function)({canonical:true,requestSource:'user',role:'desktop',argv:['owner-entry.js'],parentPid:process.ppid})).toBeUndefined();
});
it('rejects a copied or Proxy birth before observing any supplied supervisor or configuration',async()=>{
 const {bindCanonicalDesktopBusinessBirth}=await original();let hooks=0;const fake=new Proxy({},{get(){hooks++;throw Error('trap');},ownKeys(){hooks++;throw Error('trap');},getPrototypeOf(){hooks++;throw Error('trap');}});
 for(const birth of [{},fake])expect(()=>bindCanonicalDesktopBusinessBirth(birth,fake as ActivitySourceSupervisor,'untrusted',fake as never)).toThrow(/birth/);expect(hooks).toBe(0);
});
it('does not make a configuration capsule or historical command a business birth',async()=>{
 const {bindCanonicalDesktopBusinessBirth}=await original();
 for(const birth of [{kind:'activity_desktop_config_v1'},Object.freeze({protocol:'activity_dispatch_business_v1',ownerEpoch:'prior',requestSource:'user'})])expect(()=>bindCanonicalDesktopBusinessBirth(birth,{} as ActivitySourceSupervisor,'unknown',{} as never)).toThrow(/birth/);
});
it('rejects foreign completion custody before reading any supplied properties',async()=>{
 const {observeCanonicalDesktopBusinessClose}=await original(),{observeCanonicalDesktopConfigClose}=await import('../../../src/runtime/conversation-activity/source-supervisor.js');let hooks=0;
 const fake=new Proxy({},{get(){hooks++;throw Error('trap');},getOwnPropertyDescriptor(){hooks++;throw Error('trap');}});
 expect(()=>observeCanonicalDesktopBusinessClose(fake,()=>{})).toThrow(/original_endpoint/);expect(()=>observeCanonicalDesktopConfigClose(fake,()=>{})).toThrow(/original_endpoint/);expect(hooks).toBe(0);
});
