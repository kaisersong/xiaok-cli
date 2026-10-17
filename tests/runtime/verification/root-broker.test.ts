import {it,expect} from 'vitest';
import {startInstalledMacRootBroker} from '../../../src/runtime/verification/root-broker.js';
it.skipIf(process.getuid?.()===0)('refuses ordinary user deployment before filesystem mutation or native authorization',async()=>{
 await expect(startInstalledMacRootBroker()).rejects.toThrow('broker_root_identity');
});
