// @vitest-environment node
import {expect,it} from 'vitest';
import * as worker from '../../electron/workflow-script-worker.js';
it('keeps the original SDK failure as primary when the business classifier throws a secondary fault',async()=>{
 const primary=Error('original SDK failure'),secondary=Error('classifier secondary'),controller={async createAgentNode(){throw primary;}};
 const run=(worker as unknown as {__runIsolatedWorkflowScript(...args:unknown[]):Promise<unknown>}).__runIsolatedWorkflowScript;
 await expect(run("export const meta={name:'worker_primary',description:'Original raw failure'}\nreturn await agent('inert')",{controller,isKnownBusinessFailure(){throw secondary;}},undefined,1000)).rejects.toBe(primary);const fate=worker.readOriginalWorkflowScriptRuntimeFate(controller,primary);await fate.waitKnown();fate.assertKnown();
});
