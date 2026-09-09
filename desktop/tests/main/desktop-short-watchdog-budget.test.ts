// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {setTimeout as delay} from 'node:timers/promises';
import {authorizationFixture} from '../fixtures/multi-agent-authorization.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import * as summaryStream from '../../electron/desktop-summary-stream.js';
import type {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const action of cleanup.splice(0).reverse())await action();vi.restoreAllMocks();vi.unstubAllEnvs();});

it('a real 60 second host budget survives a 10ms cold provider preparation without gaining total time',async()=>{
 const f=await authorizationFixture(cleanup);
 const host=(f.boundary.service as unknown as {host:InProcessTaskRuntimeHost}).host;
 const actual=summaryStream.streamDesktopSummaryRecovery;
 let remaining=0;
 // Hold only the real pre-provider seam, then invoke the unmodified production
 // deadline/authorization/stream path. No fake clock or substitute budget math.
 vi.spyOn(summaryStream,'streamDesktopSummaryRecovery').mockImplementation(async function*(input){
  remaining=input.deadline-Date.now();await delay(10);yield* actual(input);
 });
 const stream=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(){yield {type:'text',delta:'A completed response from the real Desktop provider boundary.'};yield {type:'done'};});
 const task=await f.services.createTask({prompt:'Answer this short request.',materials:[],watchdogMs:60_000,context:{threadId:'short-budget'},permissionMode:'auto'});
 await host.drain();
 expect(stream).toHaveBeenCalledOnce();expect(remaining).toBeGreaterThan(20_000);expect(remaining).toBeLessThanOrEqual(30_000);
 const binding=f.store.getRootBinding(task.taskId)!;
 expect(f.store.getAgent(binding.groupId,`root_${binding.groupId}`)).toMatchObject({status:'completed',executionActive:false});
});
