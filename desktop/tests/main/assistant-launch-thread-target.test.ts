import {it,expect} from 'vitest';
import {createAssistantThreadTargets} from '../../electron/assistant-launch-thread-target.js';
const domain={lane:'local' as const,workspaceId:'w',cwd:'/w',device:'1',inode:'2',permissionRevision:1,bootId:'b'};
const id='00000000-0000-4000-8000-000000000001';
it('validates ownership, deletion, workspace and revision',async()=>{
 let row:any={threadId:id,title:'Owned',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal:null};
 const owner=createAssistantThreadTargets({profileId:'p',read:async()=>row,assertCurrent:binding=>{if(row.revision!==binding.revision)throw Error('thread_target_stale');}});
 const binding=await owner.prepare(id,domain);expect(binding.kind).toBe('existing');await owner.validate(binding,domain);
 row.revision++;expect(()=>owner.assertCurrent(binding)).toThrow('stale');
 for(const patch of [{profileId:'other'},{workspaceId:'other'},{deleted:true},{threadId:'other'}]){const old=row;row={...row,...patch};await expect(owner.prepare(id,domain)).rejects.toThrow();row=old;}
});
it('blocks all Goal states without implicit restore',async()=>{
 for(const state of ['active','paused','armed','completed','cancelled','blocked']){
 const owner=createAssistantThreadTargets({profileId:'p',read:async()=>({threadId:id,title:'Goal',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal:{state}}),assertCurrent:()=>{}});
 await expect(owner.prepare(id,domain)).rejects.toThrow('goal_requires_new_thread');
 }
});
it('blocks missing threads',async()=>{
 const owner=createAssistantThreadTargets({profileId:'p',read:async()=>undefined,assertCurrent:()=>{}});await expect(owner.prepare(id,domain)).rejects.toThrow();
});
it('accepts opaque local thread IDs and rejects a Goal introduced after prepare',async()=>{
 let goal:object|null=null;
 const owner=createAssistantThreadTargets({profileId:'p',read:async threadId=>({threadId,title:'Local',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal}),assertCurrent:()=>{}});
 const target=await owner.prepare('local_existing-thread',domain);goal={state:'active'};
 await expect(owner.validate(target,domain)).rejects.toThrow('assistant_thread_target_stale');
});
it('bounds all Goal quote fields, evidence counts and UTF-8 envelope bytes',async()=>{
 const {ASSISTANT_GOAL_CONSENT_SCHEMA}=await import('../../shared/assistant-launch-contract.js');
 const state={goalId:'g',revision:1,epoch:1,sessionId:'t',objective:'o',expectedEvidenceKinds:['answer'],status:'active',turnsUsed:0,tokensUsed:0,activeWallClockMs:0,budgetLimits:{turnLimit:3},consecutiveBlockedTurns:0,createdAt:1,updatedAt:1};
 const quote={consentId:'00000000-0000-4000-8000-000000000001',threadId:'t',validUntil:100,state};
 expect(ASSISTANT_GOAL_CONSENT_SCHEMA.safeParse(quote).success).toBe(true);
 for(const patch of [{objective:'x'.repeat(4001)},{completionCriterion:'x'.repeat(4001)},{terminalReason:'x'.repeat(4001)},{blockerFingerprint:'x'.repeat(4001)},{expectedEvidenceKinds:Array(5).fill('answer')},{goalId:'x'.repeat(161)},{unknown:'extra'},{objective:'目'.repeat(4000),completionCriterion:'验'.repeat(4000)}])expect(ASSISTANT_GOAL_CONSENT_SCHEMA.safeParse({...quote,state:{...state,...patch}}).success).toBe(false);
});
it('lists only current main-owned workspace rows and uses main title without preparing Goal quotes',async()=>{
 const rows:any={owned:{threadId:'owned',title:'Actual main objective',profileId:'p',workspaceId:'w',revision:1,deleted:false,goal:{state:'active'}},foreign:{threadId:'foreign',title:'Foreign',profileId:'other',workspaceId:'w',revision:1,deleted:false,goal:null},deleted:{threadId:'deleted',title:'Deleted',profileId:'p',workspaceId:'w',revision:1,deleted:true,goal:null}};
 const owner=createAssistantThreadTargets({profileId:'p',read:async id=>rows[id],assertCurrent:()=>{},list:async()=>({items:Object.keys(rows).map(threadId=>({threadId,title:'Unverified title',available:true,reason:null})),nextCursor:'next'})});
 const page=await owner.list!(domain,{});expect(page).toEqual({items:[{threadId:'owned',title:'Actual main objective',available:true,reason:null}],nextCursor:'next'});
});
