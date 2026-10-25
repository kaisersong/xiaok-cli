import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {TimedActionStore} from '../../electron/timed-action-store.js';
import {TimedActionScheduler} from '../../electron/timed-action-scheduler.js';
it.each(['throw','reject'] as const)('a notification %s after the actual commit cannot downgrade a finished run',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'timed-notify-terminal-')),store=new TimedActionStore(join(root,'timed.sqlite'));let observed=false;
 const scheduler=new TimedActionScheduler(store,{executors:{notify:{kind:'notify',async execute(){return{};}}},now:()=>10,onRunComplete(){observed=true;if(mode==='reject')return Promise.reject(Error('notification rejected after commit'));throw Error('notification failed after commit');}});
 try{store.createAction({id:'original',title:'Original',trigger:{kind:'once',at:5},executor:{kind:'notify',message:'Original'},source:'user',now:1});await scheduler.runOnce();await vi.waitFor(()=>expect(observed).toBe(true));await new Promise(resolve=>setImmediate(resolve));expect(store.listRuns('original')[0].status).toBe('success');expect(store.getAction('original')).toMatchObject({status:'completed',runCount:1,consecutiveFailures:0});}finally{scheduler.stopAccepting();store.close();rmSync(root,{recursive:true,force:true});}
});
