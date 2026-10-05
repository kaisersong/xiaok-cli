import {it,expect} from 'vitest';
import {createInstalledRootBrokerClient} from '../../../src/runtime/verification/root-broker-client.js';
it('requires an actual protected deployment and never falls back to a user socket or environment endpoint',()=>{
 process.env.XIAOK_BROKER_SOCKET='/tmp/not-a-controller';try{expect(()=>createInstalledRootBrokerClient()).toThrow();}finally{delete process.env.XIAOK_BROKER_SOCKET;}
});
