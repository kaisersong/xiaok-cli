import {it,expect,vi,afterEach} from 'vitest';import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';import {AssistantLaunchConfirm} from '../../renderer/src/components/assistant/AssistantLaunchConfirm';
import type {AssistantLaunchDraft} from '../../shared/assistant-launch-contract';
vi.mock('../../renderer/src/contexts/LocaleContext',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../renderer/src/contexts/LocaleContext')>();
 return {...actual,useLocale:()=>{const locale=actual.useLocale();return {...locale,t:{...locale.t,assistant:{...locale.t.assistant,launchGoalHeading:'Goal details',launchGoalCompletion:'Acceptance',launchGoalBudget:(turns:number,tokens:number|null)=>`Remaining turns ${turns}; tokens ${tokens??'unlimited'}`,launchGoalWallClock:(ms:number|null)=>`Remaining wallclock ${ms??'unlimited'}`,launchGoalConsent:(objective:string)=>`Attach to ${objective} using its budget and acceptance`}}};}};
});
afterEach(cleanup);
const draft:AssistantLaunchDraft={id:'c71f96bc-9716-4998-a572-3f98fa797728',proposalId:'proposal',proposalRevision:1,sourceVector:'a'.repeat(64),workItemIdentity:'b'.repeat(64),title:'Review evidence',instruction:'Read the result.',domain:{lane:'local',workspaceId:'workspace',cwd:'/real/workspace',device:'1',inode:'2',permissionRevision:1,bootId:'boot'},threadId:'c71f96bc-9716-4998-a572-3f98fa797729',createdAt:1,validUntil:600001};
it('requires explicit confirmation of complete editable text and shows actual main workspace',()=>{
 const confirm=vi.fn();render(<LocaleProvider><AssistantLaunchConfirm draft={draft} busy={false} unknown={false} onConfirm={confirm} onClose={()=>{}} onLookup={()=>{}}/></LocaleProvider>);
 expect(confirm).not.toHaveBeenCalled();expect(screen.getByText('/real/workspace')).toBeTruthy();
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'My full edited instruction.'}});fireEvent.click(screen.getByRole('button',{name:'确认并开始'}));expect(confirm).toHaveBeenCalledWith('My full edited instruction.');
});
it('unknown acknowledgement offers lookup instead of another confirm',()=>{
 render(<LocaleProvider><AssistantLaunchConfirm draft={draft} busy={false} unknown onConfirm={()=>{}} onClose={()=>{}} onLookup={()=>{}}/></LocaleProvider>);
 expect((screen.getByRole('button',{name:'确认并开始'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('button',{name:'重新检查'})).toBeTruthy();
});
it('displays the actual main-owned existing thread title',()=>{
 render(<LocaleProvider><AssistantLaunchConfirm draft={{...draft,threadTarget:{kind:'existing',threadId:draft.threadId,title:'Owned existing conversation',profileId:'p',workspaceId:'workspace',revision:1,goalBinding:null}}} busy={false} unknown={false} onConfirm={()=>{}} onClose={()=>{}} onLookup={()=>{}}/></LocaleProvider>);
 expect(screen.getByText('Owned existing conversation')).toBeTruthy();
});

const goalDraft:AssistantLaunchDraft={...draft,threadTarget:{kind:'existing',threadId:draft.threadId,title:'Owned thread',profileId:'p',workspaceId:'workspace',revision:1,goalBinding:{consentId:'00000000-0000-4000-8000-000000000001',threadId:draft.threadId,validUntil:600001,state:{goalId:'actual-goal',revision:3,epoch:2,sessionId:draft.threadId,objective:'Actual original objective',completionCriterion:'Actual original acceptance',expectedEvidenceKinds:['answer','file_artifact'],status:'active',turnsUsed:2,tokensUsed:30,activeWallClockMs:400,budgetLimits:{turnLimit:5,tokenLimit:100,activeWallClockLimitMs:1000},consecutiveBlockedTurns:0,createdAt:1,updatedAt:2}}}};
it('displays exact Goal conditions and remaining budgets, requires separate checkbox and forwards consent',()=>{
 const confirm=vi.fn();render(<LocaleProvider><AssistantLaunchConfirm draft={goalDraft} busy={false} unknown={false} onConfirm={confirm} onClose={()=>{}} onLookup={()=>{}}/></LocaleProvider>);
 expect(screen.getByText('Actual original objective')).toBeTruthy();expect(screen.getByText('Actual original acceptance')).toBeTruthy();expect(screen.getByText('Remaining turns 3; tokens 70')).toBeTruthy();expect(screen.getByText('Remaining wallclock 600')).toBeTruthy();
 const button=screen.getByRole('button',{name:'确认并开始'}) as HTMLButtonElement;expect(button.disabled).toBe(true);
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'My edited work'}});fireEvent.click(screen.getByRole('checkbox'));expect(button.disabled).toBe(false);fireEvent.click(button);expect(confirm).toHaveBeenCalledWith('My edited work',true);
});
it('unknown Goal acknowledgement disables confirmation and offers lookup with the edited work intact',()=>{
 const confirm=vi.fn(),lookup=vi.fn();const view=render(<LocaleProvider><AssistantLaunchConfirm draft={goalDraft} busy={false} unknown={false} onConfirm={confirm} onClose={()=>{}} onLookup={lookup}/></LocaleProvider>);
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'Keep my edit'}});fireEvent.click(screen.getByRole('checkbox'));
 view.rerender(<LocaleProvider><AssistantLaunchConfirm draft={goalDraft} busy={false} unknown onConfirm={confirm} onClose={()=>{}} onLookup={lookup}/></LocaleProvider>);
 expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep my edit');expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'确认并开始'}));expect(confirm).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'重新检查'}));expect(lookup).toHaveBeenCalledOnce();
});
it('resets second consent when the main-issued Goal quote changes',()=>{
 const props={busy:false,unknown:false,onConfirm:()=>{},onClose:()=>{},onLookup:()=>{}};
 const view=render(<LocaleProvider><AssistantLaunchConfirm {...props} draft={goalDraft}/></LocaleProvider>);fireEvent.click(screen.getByRole('checkbox'));
 const next=structuredClone(goalDraft);next.threadTarget!.goalBinding!.consentId='00000000-0000-4000-8000-000000000002';
 view.rerender(<LocaleProvider><AssistantLaunchConfirm {...props} draft={next}/></LocaleProvider>);
 expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);expect((screen.getByRole('button',{name:'确认并开始'}) as HTMLButtonElement).disabled).toBe(true);
});
it('represents unconfigured token and wallclock limits as null and keeps busy consent disabled',()=>{
 const value=structuredClone(goalDraft);value.threadTarget!.goalBinding!.state.budgetLimits={turnLimit:5};
 render(<LocaleProvider><AssistantLaunchConfirm draft={value} busy unknown={false} onConfirm={()=>{}} onClose={()=>{}} onLookup={()=>{}}/></LocaleProvider>);
 expect(screen.getByText('Remaining turns 3; tokens unlimited')).toBeTruthy();expect(screen.getByText('Remaining wallclock unlimited')).toBeTruthy();expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
});
