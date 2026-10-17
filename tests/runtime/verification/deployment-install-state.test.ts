import {it,expect} from 'vitest';
import {initializeInstalledMacState} from '../../../src/runtime/verification/deployment-install-state.js';
it.skipIf(process.getuid?.()===0)('will not generate service keys/config or impersonate the service from an ordinary process',()=>{
 expect(()=>initializeInstalledMacState('a'.repeat(64),400,401)).toThrow('deployment_root_required');
});
