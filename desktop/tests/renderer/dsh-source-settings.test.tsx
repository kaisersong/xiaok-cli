import {StrictMode} from 'react';
import {cleanup,fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DshSourceSettings} from '../../renderer/src/components/DshSourceSettings';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import type {DshDesktopApi,DshDesktopState} from '../../../src/shared/dsh-desktop';
const state=():DshDesktopState=>({schemaVersion:1,executionQualified:false,availability:'ready',domain:{revision:1,authorityEpoch:1,state:'pending_baseline'},modes:[],setups:[],sources:[],lastErrorCode:null});
function api(){return{getState:vi.fn().mockResolvedValue(state()),setMode:vi.fn().mockResolvedValue(state()),configureSetup:vi.fn().mockResolvedValue(state()),connect:vi.fn().mockResolvedValue(state()),disconnect:vi.fn().mockResolvedValue(state()),reconcile:vi.fn().mockResolvedValue(state()),configureBudget:vi.fn().mockResolvedValue(state()),publishMandate:vi.fn().mockResolvedValue(state()),publishEgressPolicy:vi.fn().mockResolvedValue(state())};}
function mount(a:DshDesktopApi,strict=false){const tree=<LocaleProvider><DshSourceSettings api={a}/></LocaleProvider>;return render(strict?<StrictMode>{tree}</StrictMode>:tree);}
beforeEach(()=>localStorage.setItem('xiaok:locale','zh'));afterEach(()=>{cleanup();localStorage.removeItem('xiaok:locale');});
it('only reads on mount and leaves automatic execution unavailable without original qualification',async()=>{const a=api();mount(a);await screen.findByText('授权与运行条件待确认');expect(a.getState).toHaveBeenCalledTimes(1);for(const option of screen.getAllByRole('option',{name:'自动生成草稿'}))expect(option).toBeDisabled();expect(a.setMode).not.toHaveBeenCalled();expect(a.connect).not.toHaveBeenCalled();});
it('shares the pending initial read across StrictMode effects',async()=>{const a=api();mount(a,true);await screen.findByText('授权与运行条件待确认');expect(a.getState).toHaveBeenCalledTimes(1);});
it('passes only the selected mode and exact current revision after an explicit click',async()=>{const a=api();mount(a);await screen.findByText('授权与运行条件待确认');fireEvent.change(screen.getByLabelText('全局'),{target:{value:'observe'}});fireEvent.click(screen.getAllByRole('button',{name:'应用'})[0]!);await waitFor(()=>expect(a.setMode).toHaveBeenCalledTimes(1));expect(a.setMode).toHaveBeenCalledWith({schemaVersion:1,scopeKind:'global',sourceBindingId:null,mode:'observe',expectedRevision:0});});
it('a failed refresh removes stale mutation eligibility and never renders private errors',async()=>{const a=api();mount(a);await screen.findByText('授权与运行条件待确认');a.getState.mockRejectedValueOnce(Error('secret-private-token'));fireEvent.click(screen.getByRole('button',{name:'刷新'}));await screen.findByRole('alert');expect(screen.getByLabelText('全局')).toBeDisabled();expect(screen.queryByText('secret-private-token')).toBeNull();});
it('clears credentials after a failed connection and does not retry it on refresh',async()=>{const a=api(),s=state();s.modes=['global','tenant','workspace'].map(scopeKind=>({scopeKind:scopeKind as 'global'|'tenant'|'workspace',sourceBindingId:null,mode:'observe',epoch:1,revision:1,status:'effective'}));s.setups=[{setupId:'setup',configurationRevision:1,candidateRepository:{owner:'org',repo:'repo'},selection:{kind:'label_ids',match:'all',labelIds:['1']},minimumIntervalMs:60000,mode:'observe'}];a.getState.mockResolvedValue(s);a.connect.mockRejectedValue(Error('private'));mount(a);await screen.findByText('org/repo');const input=screen.getByLabelText('GitHub 访问令牌');fireEvent.change(input,{target:{value:'token-secret'}});fireEvent.click(screen.getByRole('button',{name:'连接'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'刷新'}));await screen.findByText('org/repo');expect(screen.getByLabelText('GitHub 访问令牌')).toHaveValue('');expect(a.connect).toHaveBeenCalledTimes(1);});
it('locks duplicate mutations synchronously while the original operation is pending',async()=>{const a=api();let release!:(s:DshDesktopState)=>void;a.setMode.mockReturnValue(new Promise(yes=>{release=yes;}));mount(a);await screen.findByText('授权与运行条件待确认');fireEvent.change(screen.getByLabelText('全局'),{target:{value:'observe'}});const button=screen.getAllByRole('button',{name:'应用'})[0]!;fireEvent.click(button);fireEvent.click(button);expect(a.setMode).toHaveBeenCalledTimes(1);await act(async()=>release(state()));});

it('submits exact decimal budget only after explicit user action and never treats it as actual invoiced cost',async()=>{const a=api();mount(a);await screen.findByText('授权与运行条件待确认');fireEvent.change(screen.getByLabelText('授权名称'),{target:{value:'work-budget'}});fireEvent.change(screen.getByLabelText('Token 总上限'),{target:{value:'1000'}});fireEvent.change(screen.getByLabelText('美元预算上限'),{target:{value:'0.000001'}});fireEvent.change(screen.getByLabelText('有效期（UTC）'),{target:{value:'2027-01-01T00:00:00Z'}});expect(a.configureBudget).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'保存预算'}));await waitFor(()=>expect(a.configureBudget).toHaveBeenCalledWith({schemaVersion:1,mandateId:'work-budget',mandateRevision:1,tokenLimit:1000,costLimitUsd:'0.000001',validUntil:'2027-01-01T00:00:00Z'}));expect(a.publishMandate).not.toHaveBeenCalled();});
it('rejects invalid decimal amounts locally and keeps readonly execution unselected',async()=>{const a=api();mount(a);await screen.findByText('授权与运行条件待确认');fireEvent.change(screen.getByLabelText('授权名称'),{target:{value:'work'}});fireEvent.change(screen.getByLabelText('Token 总上限'),{target:{value:'1000'}});fireEvent.change(screen.getByLabelText('美元预算上限'),{target:{value:'-0'}});fireEvent.change(screen.getByLabelText('有效期（UTC）'),{target:{value:'2027-01-01T00:00:00Z'}});fireEvent.click(screen.getByRole('button',{name:'保存预算'}));await screen.findByRole('alert');expect(a.configureBudget).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'保存明确授权'})).toBeDisabled();});

it('submits an explicitly selected tenant candidate with the source setup',async()=>{
 const a=api();mount(a);await screen.findByText('授权与运行条件待确认');
 fireEvent.change(screen.getByLabelText('账户标识'),{target:{value:'tenant-alpha'}});
 fireEvent.change(screen.getByLabelText('GitHub 用户或组织'),{target:{value:'org'}});
 fireEvent.change(screen.getByLabelText('仓库名'),{target:{value:'repo'}});
 fireEvent.change(screen.getByLabelText('标签 ID'),{target:{value:'7'}});
 fireEvent.click(screen.getByRole('button',{name:'保存来源'}));
 await waitFor(()=>expect(a.configureSetup).toHaveBeenCalledTimes(1));
 expect(a.configureSetup.mock.calls[0]![0]).toMatchObject({tenantId:'tenant-alpha',candidateRepository:{owner:'org',repo:'repo'}});
});

it('does not borrow another tenant baseline to enable a source connection',async()=>{
 const a=api(),s=state();
 s.modes=['global','tenant','workspace'].map(scopeKind=>Object.assign({scopeKind:scopeKind as 'global'|'tenant'|'workspace',sourceBindingId:null,mode:'observe' as const,epoch:1,revision:1,status:'effective' as const},scopeKind==='global'?{}:{tenantId:'tenant-beta'}));
 s.setups=[Object.assign({setupId:'alpha',configurationRevision:1,candidateRepository:{owner:'org',repo:'repo'},selection:{kind:'label_ids' as const,match:'all' as const,labelIds:['7']},minimumIntervalMs:60000,mode:'observe' as const},{tenantId:'tenant-alpha'})];
 a.getState.mockResolvedValue(s);mount(a);await screen.findByText('org/repo');
 fireEvent.change(screen.getByLabelText('GitHub 访问令牌'),{target:{value:'private-test-token'}});
 expect(screen.getByRole('button',{name:'连接'})).toBeDisabled();expect(a.connect).not.toHaveBeenCalled();
});
