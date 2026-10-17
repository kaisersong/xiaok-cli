import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TimedActionStore} from '../../electron/timed-action-store.js';
function fixture(){const root=mkdtempSync(join(tmpdir(),'loop-timed-')),store=new TimedActionStore(join(root,'timed.sqlite'));store.createAction({id:'original-action',title:'Original',trigger:{kind:'interval',intervalMinutes:5},executor:{kind:'loop',loopId:'original-loop'},source:'user',consecutiveFailures:2,now:0});const [claimed]=store.claimDueActions(300000,1,{recoveryReason:'normal_tick'});store.markRunRunning(claimed.action.id,claimed.runId,300000);return{root,store,claimed,close(){store.close();rmSync(root,{recursive:true,force:true});}};}
it.each(['success','reused','stale','pending'] as const)('raw %s sibling cannot advance a Loop schedule from a completion DTO',mode=>{
 const f=fixture();try{const before={action:f.store.getAction(f.claimed.action.id),runs:f.store.listRuns(f.claimed.action.id),version:f.store.getAutomationStoreVersion()},decision={loopRunId:'invented-run',loopStatus:'success' as const,reused:true};
 expect(()=>{if(mode==='success')f.store.finishRunSuccess(f.claimed.action.id,f.claimed.runId,400000,{decision});else if(mode==='reused')f.store.finishRunSkipped(f.claimed.action.id,f.claimed.runId,400000,{action:'skip',reason:'logical_run_already_completed: invented-run'},decision);else if(mode==='pending')f.store.finishRunPublicationPending(f.claimed.action.id,f.claimed.runId,400000,{...decision,loopStatus:'publication_pending'});else f.store.releaseStaleLocks(400000,60000,{resolveLinkedLoopRun:()=>decision});}).toThrow();
 expect({action:f.store.getAction(f.claimed.action.id),runs:f.store.listRuns(f.claimed.action.id),version:f.store.getAutomationStoreVersion()}).toEqual(before);
 }finally{f.close();}
});
