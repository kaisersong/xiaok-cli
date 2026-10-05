import {it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({close:vi.fn(),receiverClose:vi.fn(),construction:vi.fn()}));
vi.mock('../../../src/runtime/verification/installed-controller-lifetime.js',()=>({createInstalledControllerLifetime:()=>({database:{prepare:()=>({get:()=>undefined,all:()=>[],run(){}})} as any,assertCurrent(){},close:f.close})}));
vi.mock('../../../src/runtime/verification/installed-receiver-registration.js',()=>({createInstalledReceiverRegistration:()=>({close:f.receiverClose}),assertInstalledReceiverRegistration(){}}));
vi.mock('../../../src/runtime/verification/installed-execution-stack.js',()=>({createInstalledExecutionStack:async()=>{f.construction();try{throw Error('late_construction_failure');}finally{throw Error('cleanup_unknown');}}}));
vi.mock('../../../src/runtime/verification/root-broker-client.js',()=>({createInstalledRootBrokerClient:()=>({dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-shared-capacity.js',()=>({createInstalledSharedCapacity:()=>({capacity:{migrateLegacy(){}},close(){}}),isCapacityMappingNotReady:()=>false}));
import {startInstalledVerificationController} from '../../../src/runtime/verification/installed-controller.js';
it('retains installed lifetime when stack constructor cannot return its partially created owner',async()=>{
 await expect(startInstalledVerificationController()).rejects.toThrow();
 expect(f.construction).toHaveBeenCalledOnce();expect(f.receiverClose).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();
});
