import {it,expect} from 'vitest';
import {runBrokerHelper} from '../../../src/runtime/verification/broker-process.js';
it.skipIf(process.platform==='win32')('waits for fixed helper exit, bounds output and never treats timeout as a result',async()=>{
 const signal=new AbortController().signal;
 await expect(runBrokerHelper({executable:'/bin/echo',args:['hello'],maximumOutput:64,timeoutMs:1000,signal})).resolves.toEqual(Buffer.from('hello\n'));
 await expect(runBrokerHelper({executable:'/bin/echo',args:['oversized'],maximumOutput:1,timeoutMs:1000,signal})).rejects.toThrow('broker_helper_unknown');
 await expect(runBrokerHelper({executable:'/bin/sleep',args:['30'],maximumOutput:0,timeoutMs:25,signal})).rejects.toThrow('broker_helper_unknown');
});
