import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { AssistantWorkspaceContent } from '../../renderer/src/components/assistant/AssistantWorkspaceContent';
import { useAssistantWorkspace } from '../../renderer/src/hooks/useAssistantWorkspace';
function AssistantPage() { return <AssistantWorkspaceContent data={useAssistantWorkspace()} onPrepareSuggestion={text => window.dispatchEvent(new CustomEvent('assistant-test-draft', { detail: text }))} />; }
const h = vi.hoisted(() => ({ product:vi.fn(),page:vi.fn(),prepareFollow:vi.fn(),confirm:vi.fn(),accept:vi.fn(),overview: vi.fn(), schedules: vi.fn(), history: vi.fn(), automation: vi.fn(), activate: vi.fn(), unsubscribe: vi.fn(), changed: undefined as undefined | (() => void), stopAssistant:vi.fn(), due: undefined as undefined | (() => void) }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({
  getAssistantActionOverview:h.product,getAssistantCandidatePage:h.page,prepareAssistantFollowUpLaunch:h.prepareFollow,confirmAssistantLaunch:h.confirm,acceptAssistantCandidate:h.accept,kbListCollections:async()=>[],getAssistantOverview: h.overview, getScheduledTasks: h.schedules,
  getAutomationRunHistory: h.history, getAutomationOverviewSnapshot: h.automation,
  onAssistantInboxChanged:(handler:()=>void)=>{h.changed=handler;return h.stopAssistant;},
  activateAssistant: h.activate, onScheduledTaskDue: (handler: () => void) => { h.due = handler; return h.unsubscribe; },
}) }));
const profile = { id: 'default-personal-assistant', status: 'active', locale: 'zh', timeZone: 'Asia/Shanghai', eveningTime: '22:30', morningTime: '08:30', workdays: [1,2,3,4,5], quietHours: { start: '23:00', end: '08:00' }, dataScopes: ['tasks'], createdAt: 1, updatedAt: 1 };
const overview = { profile, suggestions: [{ id: 's1', title: '跟进发布评审', summary: '确认最后两项变更' }], candidates: [], pendingCandidateCount: 0 };
const schedule = { id: 'ai-daily', name: '原有 AI 动态', prompt: '原有用户指令', frequency: 'daily', executorKind: 'agent_task', status: 'active', source: 'user', createdAt: 1, updatedAt: 1, nextRunAt: 1900000000000 };
const automation = { generatedAt: 1, sourceVersions: { loopStore: 1, timedActionStore: 1 }, globalBackgroundAutoRunEnabled: false, totals: { loops: 0, userLoops: 0, schedules: 1, activeSchedules: 1, diagnostics: 0, recentFailures: 0 }, recentFailures: [] };
function Probe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}{location.hash}<span data-testid="draft">{location.state?.assistantDraftPrompt}</span></output>; }
function page() { return render(<MemoryRouter initialEntries={['/assistant']}><LocaleProvider><AssistantPage /><Probe /></LocaleProvider></MemoryRouter>); }
beforeEach(() => {
  h.product.mockReset();h.page.mockReset();h.prepareFollow.mockReset();h.confirm.mockReset();h.accept.mockReset();
  localStorage.clear(); localStorage.setItem('xiaok:locale', 'zh');
  h.overview.mockReset().mockResolvedValue(overview); h.schedules.mockReset().mockResolvedValue([schedule]);
  h.history.mockReset().mockResolvedValue([{ id: 'run1', automationKind: 'agent_task', actionId: 'ai-daily', title: '原有 AI 动态', status: 'success', startedAt: 100 }]);
  h.automation.mockReset().mockResolvedValue(automation); h.activate.mockReset(); h.unsubscribe.mockReset(); h.due = undefined; h.changed=undefined;h.stopAssistant.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('renders real suggestions and existing schedules without creating or activating work', async () => {
  page(); await screen.findByText('跟进发布评审');
  expect(screen.getByRole('heading', { name: '小K助理', level: 1 })).toBeVisible();
  expect(screen.getAllByText('原有 AI 动态').length).toBeGreaterThan(0);
  expect(screen.queryByText('后台自动运行已暂停')).toBeNull();
  expect(screen.getByText('已启动，查看结果')).toBeVisible();
  expect(h.activate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查看运行：原有 AI 动态' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/automations/schedules#task-ai-daily');
});
it('opens an editable original schedule form without a mutation', async () => {
  page(); await screen.findByText('跟进发布评审');
  fireEvent.click(screen.getByRole('button', { name: '设置关注：云之家重点消息' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/automations/schedules?create=1&assistantWatch=yzj_messages');
  expect(h.activate).not.toHaveBeenCalled();
});
it('keeps successful sources when history fails and never presents failure as an empty inbox', async () => {
  h.history.mockRejectedValue(Error('unavailable')); page(); await screen.findByText('最近运行暂时无法读取');
  expect(screen.getByText('跟进发布评审')).toBeVisible(); expect(screen.queryByText('还没有关注任务的运行记录')).toBeNull();
  h.history.mockResolvedValue([]); fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await screen.findByText('还没有关注任务的运行记录');
});
it('rejects malformed snapshots rather than claiming an empty source', async () => {
  h.schedules.mockResolvedValue([{ id: 'malformed' }]); page(); await screen.findByText('关注计划暂时无法读取');
  expect(screen.queryByText('还没有持续关注计划')).toBeNull();
});
it('coalesces events during a read, displays newer facts and unsubscribes on unmount', async () => {
  let finish!: (value: unknown) => void;
  h.overview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ...overview, suggestions: [{ id: 'new', title: '更新后的建议', summary: '新版' }] });
  const view = page(); await waitFor(() => expect(h.overview).toHaveBeenCalledTimes(1));
  act(() => { h.due?.(); h.due?.(); }); await act(async () => { finish(overview); });
  await screen.findByText('更新后的建议'); expect(h.overview).toHaveBeenCalledTimes(2);
  view.unmount(); expect(h.unsubscribe).toHaveBeenCalledTimes(1); act(() => h.due?.()); expect(h.overview).toHaveBeenCalledTimes(2);
});
it('does not label a protected historical completion needing revalidation as success', async () => {
  h.history.mockResolvedValue([{ id: 'protected', automationKind: 'loop', loopId: 'l1', title: '历史建议', status: 'success', startedAt: 100, completionObservation: { state: 'needs_revalidation', checkedAt: 100 } }]);
  page(); await screen.findByText('需重新核对');
});
it('clears failed source data after refresh rather than retaining an unmarked stale success', async () => {
  page(); await screen.findByText('跟进发布评审'); h.overview.mockRejectedValue(Error('unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  await waitFor(() => expect(screen.queryByText('跟进发布评审')).toBeNull()); expect(screen.getByText('小K助理暂不可用')).toBeVisible();
});

it('prepares a suggestion as an editable same-page draft without starting a task', async () => {
 const draft=vi.fn();window.addEventListener('assistant-test-draft',draft);
 page();await screen.findByText('跟进发布评审');fireEvent.click(screen.getByRole('button',{name:'准备处理：跟进发布评审'}));
 expect(draft).toHaveBeenCalledTimes(1);expect(draft.mock.calls[0][0].detail).toContain('跟进发布评审');expect(h.activate).not.toHaveBeenCalled();window.removeEventListener('assistant-test-draft',draft);
});

it('auto-checks an unknown status mutation once and reports it as applied without replaying it', async () => {
  h.overview.mockResolvedValue({ ...overview, profile: { ...profile, status: 'needs_consent' } });
  h.activate.mockRejectedValueOnce(Error('assistant_operation_unknown'));
  page(); fireEvent.click(await screen.findByRole('button', { name: '启用小K助理' }));
  await waitFor(() => expect(h.activate).toHaveBeenCalledTimes(1));
  expect(h.overview).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '启用小K助理' })).toBeDisabled();
  h.overview.mockResolvedValue(overview);
  await screen.findByText('已自动核对：刚才的操作已生效。', {}, { timeout: 3000 });
  expect(h.activate).toHaveBeenCalledTimes(1);
  expect(h.overview).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByText('助理设置')); await screen.findByRole('button', { name: '暂停小K助理' });
  expect(screen.getByRole('button', { name: '暂停小K助理' })).toBeEnabled();
  expect(h.activate).toHaveBeenCalledTimes(1);
});
it('reports an unknown status mutation as not applied when the read-back keeps the previous state', async () => {
  h.overview.mockResolvedValue({ ...overview, profile: { ...profile, status: 'needs_consent' } });
  h.activate.mockRejectedValueOnce(Error('assistant_operation_unknown'));
  page(); fireEvent.click(await screen.findByRole('button', { name: '启用小K助理' }));
  await waitFor(() => expect(h.activate).toHaveBeenCalledTimes(1));
  await screen.findByText('已自动核对：暂未看到刚才的操作生效，可直接重试。', {}, { timeout: 3000 });
  expect(h.activate).toHaveBeenCalledTimes(1);
  expect(h.overview).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '启用小K助理' })).toBeEnabled();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('falls back to the unknown banner when the automatic read-back fails, and one manual refresh restores it', async () => {
  h.overview.mockResolvedValueOnce({ ...overview, profile: { ...profile, status: 'needs_consent' } }).mockRejectedValueOnce(Error('unavailable'));
  h.activate.mockRejectedValueOnce(Error('assistant_operation_unknown'));
  page(); fireEvent.click(await screen.findByRole('button', { name: '启用小K助理' }));
  await waitFor(() => expect(h.activate).toHaveBeenCalledTimes(1));
  await screen.findByText('刚才的操作结果未能确认，自动核对也未成功。请点「刷新状态」确认后再继续。', {}, { timeout: 3000 });
  expect(h.overview).toHaveBeenCalledTimes(2);
  h.overview.mockResolvedValue(overview);
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
  fireEvent.click(screen.getByText('助理设置')); await screen.findByRole('button', { name: '暂停小K助理' });
  expect(h.activate).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/刚才的操作结果未能确认/)).toBeNull();
});
it('keeps candidate presentation and never repeats the decision after an auto-checked accept failure', async () => {
  h.overview.mockResolvedValue({ ...overview, pendingCandidateCount: 1, candidates: [{ id: 'candidate', runId: 'run', kind: 'memory', title: '偏好', content: '内容', scope: 'global', confidence: 0.9, evidenceRefs: [], dedupeKey: 'd', status: 'pending', createdAt: 1 }] });
  page(); fireEvent.click(await screen.findByRole('button', { name: '1 条待确认候选' }));
  h.accept.mockReset().mockRejectedValueOnce(Error('assistant_operation_unknown'));
  const accept = await screen.findByRole('button', { name: '采纳：偏好' });
  fireEvent.click(accept);
  await waitFor(() => expect(h.accept).toHaveBeenCalledTimes(1));
  await screen.findByText('已自动核对：暂未看到刚才的操作生效，可直接重试。', {}, { timeout: 3000 });
  expect(h.accept).toHaveBeenCalledTimes(1);
  expect(screen.getByText('内容')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('does not commit a late page read after unmount or start a queued read on the dead owner', async () => {
  let finish!: (value: unknown) => void;
  h.overview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = page(); await waitFor(() => expect(h.overview).toHaveBeenCalledTimes(1));
  act(() => h.due?.()); view.unmount(); await act(async () => finish(overview));
  expect(h.overview).toHaveBeenCalledTimes(1); expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});

it('keeps the top focused when there are no suggestions, hiding repeated copy, schedule metadata and zero candidates',async()=>{
 h.overview.mockResolvedValue({...overview,suggestions:[]});page();await screen.findByRole('button',{name:'连接来源'});
 await waitFor(()=>expect(screen.queryByText('今天暂无高置信建议。')).toBeNull());
 expect(screen.queryByText('把值得关注的信息带到你面前，让下一步更清楚。')).toBeNull();
 expect(screen.getAllByRole('heading',{name:'小K助理'})).toHaveLength(1);
 expect(screen.queryByText('0 条待确认候选')).toBeNull();
 expect(screen.queryByText('晚间 22:30 整理，早上 08:30 给出建议')).toBeNull();
 expect(screen.queryByText('后台自动运行已暂停')).toBeNull();
 fireEvent.click(screen.getByText('助理设置'));
 expect(screen.getByText('晚间 22:30 整理，早上 08:30 给出建议')).toBeVisible();
 expect(screen.getByRole('button',{name:'暂停小K助理'})).toBeVisible();
});

it('refreshes completed morning suggestions from the assistant event and cleans its listener',async()=>{const view=page();await screen.findByText('跟进发布评审');h.overview.mockResolvedValue({...overview,suggestions:[{id:'morning-new',title:'晨间运行的新建议',summary:'safe'}]});act(()=>h.changed?.());await screen.findByText('晨间运行的新建议');const calls=h.overview.mock.calls.length;view.unmount();expect(h.stopAssistant).toHaveBeenCalledTimes(1);act(()=>h.changed?.());expect(h.overview).toHaveBeenCalledTimes(calls);});


it('uses the modern Main candidate page and only prepares an accepted follow-up after an explicit click',async()=>{
 const candidate={id:'follow',runId:'run',kind:'follow_up',title:'Accepted follow-up',content:'Review evidence',scope:'global',confidence:1,evidenceRefs:[],dedupeKey:'d',status:'accepted',acceptedTargetRef:'draft://follow',createdAt:1};
 h.product.mockResolvedValue({...overview,schemaVersion:2,candidates:[candidate],nextCandidateCursor:'main-cursor',proposals:[],coverageState:'unknown',coverage:[],analysisStatus:null,collectedAt:null});
 h.page.mockResolvedValue({candidates:[{...candidate,id:'next',title:'Next candidate',status:'pending',acceptedTargetRef:undefined}],nextCursor:null});
 h.prepareFollow.mockResolvedValue({id:'a6ed0df6-18ac-4d34-a228-c864e9b4c9b0',candidateId:'follow',proposalId:'follow',proposalRevision:1,sourceVector:'a'.repeat(64),workItemIdentity:'b'.repeat(64),title:'Accepted follow-up',instruction:'Review evidence',domain:{lane:'local',workspaceId:'workspace',cwd:'/private/fixture',device:'1',inode:'2',permissionRevision:0,bootId:'boot'},threadId:'new-thread',createdAt:1,validUntil:Date.now()+60000});
 page();await screen.findByText('跟进发布评审');fireEvent.click(screen.getByText('助理设置'));fireEvent.click(screen.getByRole('button',{name:'查看小K助理详情'}));
 expect(h.prepareFollow).not.toHaveBeenCalled();fireEvent.click(await screen.findByRole('button',{name:'加载更多候选'}));await screen.findByText('Next candidate');expect(h.page).toHaveBeenCalledExactlyOnceWith({cursor:'main-cursor'});
 fireEvent.click(screen.getByRole('button',{name:'开始处理'}));await screen.findByRole('button',{name:'确认并开始'});expect(h.prepareFollow).toHaveBeenCalledExactlyOnceWith({candidateId:'follow'});expect(h.confirm).not.toHaveBeenCalled();
});
