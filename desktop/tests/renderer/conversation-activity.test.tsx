import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ConversationActivityPanel } from '../../renderer/src/components/ConversationActivityPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), work: vi.fn(), dismiss: vi.fn(), reporting: vi.fn(), stop: vi.fn(), inputs: vi.fn(), subscribe: vi.fn((_thread: string, _callback: () => void) => vi.fn()) }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => ({
  getConversationActivities: mocks.list, getWorkActivity: mocks.work, dismissWorkAttention: mocks.dismiss, updateWorkReporting: mocks.reporting,
  stopWorkWatch: mocks.stop, subscribeConversationActivities: mocks.subscribe,
  getMcpTaskInputs: mocks.inputs,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const projection = { watchId: 'watch', executionState: 'accepted', businessOutcome: 'unknown', freshness: 'fresh', sourceSequence: 1,
  revision: 1, lastProgressAt: null, lastHeartbeatAt: 1000, lastReportAt: null, evidenceRefs: [], summary: '<img src=x onerror=alert(1)>' };
const watch = { watchId: 'watch', workId: 'project', source: 'kswarm', status: 'active', preference: 'normal', policyRevision: 0, nextReportDueAt: 301000 };
function mount() {
  return render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" /></LocaleProvider></MemoryRouter>);
}
async function expand() {
  const toggle = await screen.findByTestId('activity-toggle');
  fireEvent.click(toggle);
}
describe('conversation work feedback', () => {
  it('uses the original main presentation category and stable work identity instead of event arrival time', async () => {
    const items=[{id:'running',rank:4,state:'running',time:999999},{id:'delivery',rank:3,state:'accepted',time:1},{id:'a-answer',rank:0,state:'accepted',time:0},{id:'z-answer',rank:0,state:'accepted',time:100}];
    mocks.list.mockResolvedValue(items.map((item,index)=>({watchId:item.id,localSeq:index+1,kind:'progress',at:item.time,projection})));
    mocks.work.mockImplementation(async(id:string)=>{const item=items.find(row=>row.id===id)!;return {watch:{...watch,watchId:id,workId:id},projection:{...projection,watchId:id,executionState:item.state,lastProgressAt:item.time},presentation:{schemaVersion:1,categoryRank:item.rank,workRef:id,anchorFactId:'anchor:'+id}};});
    mount();await expand();expect(screen.getAllByTestId(/^activity-work-/).map(node=>node.getAttribute('data-testid'))).toEqual(['activity-work-a-answer','activity-work-z-answer','activity-work-delivery','activity-work-running']);
  });
  it('reveals required plugin input and keeps its outcome visible after it is handled', async () => {
    let changed: (() => void) | undefined;
    mocks.subscribe.mockImplementation((_thread, callback) => { changed = callback; return vi.fn(); });
    mocks.list.mockResolvedValue([{ watchId: 'watch', localSeq: 1, kind: 'input_required', at: 1000, projection }]);
    const plugin = { ...watch, source: 'mcp' };
    mocks.work.mockResolvedValue({ watch: plugin, projection: { ...projection, executionState: 'input_required', summary: '选择报告格式' } });
    mocks.inputs.mockResolvedValue([{ inputId: 'input', expectedDigest: 'digest', prompt: '选择报告格式', fields: [] }]);
    mount();
    await waitFor(() => expect(screen.getByTestId('activity-toggle')).toHaveAttribute('aria-expanded', 'true'));
    expect(await screen.findByRole('button', { name: /提交|Submit/ })).toBeVisible();
    mocks.work.mockResolvedValue({ watch: plugin, projection: { ...projection, executionState: 'cancelled', summary: '已取消' } });
    changed?.();
    await waitFor(() => expect(screen.getByTestId('activity-work-watch')).toHaveTextContent('已取消'));
    expect(screen.getByTestId('activity-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('activity-toggle')).not.toBeDisabled();
  });
  it('keeps long completed reports collapsed and updates one fixed summary in place', async () => {
    let changed: (() => void) | undefined;
    mocks.subscribe.mockImplementation((_thread: string, callback: () => void) => { changed = callback; return vi.fn(); });
    mocks.list.mockResolvedValue([{ watchId: 'watch', localSeq: 1, kind: 'report', at: 1000, projection }]);
    const summary = '# 巡检报告\n' + '历史汇报正文。'.repeat(1000);
    mocks.work.mockResolvedValue({ watch, projection: { ...projection, executionState: 'completed', summary } });
    mount();
    const toggle = await screen.findByTestId('activity-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('activity-work-watch')).not.toBeInTheDocument();
    expect(screen.queryByText(summary)).not.toBeInTheDocument();
    mocks.work.mockResolvedValue({ watch, projection: { ...projection, executionState: 'running', summary: '当前工作正在推进' } });
    changed?.();
    await waitFor(() => expect(toggle).toHaveTextContent('当前工作正在推进'));
    expect(screen.getAllByTestId('activity-toggle')).toHaveLength(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expand();
    expect(screen.getByTestId('activity-details')).toHaveClass('max-h-64', 'overflow-y-auto');
    expect(screen.getAllByTestId('activity-work-watch')).toHaveLength(1);
  });
  it('shows the latest report with a relative time under each expanded work item, and says so when none exists', async () => {
    const at = Date.now() - 3 * 60_000;
    mocks.list.mockResolvedValue([{ watchId: 'watch', localSeq: 1, kind: 'report', at, projection },
      { watchId: 'quiet', localSeq: 2, kind: 'accepted', at, projection }]);
    mocks.work.mockImplementation(async (id: string) => ({ watch: { ...watch, watchId: id }, projection: { ...projection, watchId: id, executionState: 'completed' } }));
    mount();
    expect(await screen.findByTestId('activity-toggle')).toBeVisible();
    expect(screen.queryByTestId('activity-last-report')).not.toBeInTheDocument();
    await expand();
    const lines = screen.getAllByTestId('activity-last-report').map(node => node.textContent);
    expect(lines).toContain('还没有汇报');
    const reported = lines.find(line => line?.startsWith('最近汇报：'));
    expect(reported).toMatch(/^最近汇报：.+ · 3\s*分钟前$/);
    expect(reported).not.toMatch(/completed|executionState|_/);
  });
  it('loads the next activity page so later work cards are not silently hidden', async () => {
    mocks.list.mockImplementation(async (input: { afterLocalSeq?: number }) => input.afterLocalSeq
      ? [{ activityId: 'later', localSeq: 201, watchId: 'later-watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]
      : Array.from({ length: 200 }, (_, index) => ({ activityId: `id-${index}`, localSeq: index + 1, watchId: 'watch', threadId: 'thread', kind: 'progress', at: 1000, projection })));
    mocks.work.mockImplementation(async (id: string) => ({ watch: { ...watch, watchId: id }, projection: { ...projection, watchId: id } }));
    mount();
    await expand();
    await waitFor(() => expect(screen.getByTestId('activity-work-later-watch')).toBeVisible());
  });
  it('shows a loading error even before the first card can be read', async () => {
    mocks.list.mockRejectedValueOnce(new Error('read failed')); mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
  });
  it('maps a failed owner attach to fixed copy and never renders the internal code', async () => {
    mocks.list.mockRejectedValue(new Error("Error invoking remote method 'desktop:activity:list': Error: activity_owner_unavailable"));
    const { container } = mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    const text = container.textContent ?? '';
    expect(text).toMatch(/xiaoK 的后台组件和当前版本不一致，部分功能暂时无法启动。请退出所有 xiaok 窗口后重新打开。|background component does not match this version/);
    expect(text).not.toMatch(/activity_owner|unavailable|mismatch|Error invoking/);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
  it('keeps the generic message for ordinary read failures', async () => {
    mocks.list.mockRejectedValue(new Error('read failed')); const { container } = mount();
    await waitFor(() => expect(screen.getByRole('status')).toBeVisible());
    expect(container.textContent).not.toMatch(/后台组件|background component/);
  });
  it('clears previously authorized content and question controls when a current refresh loses source access', async () => {
    let changed: (()=>void) | undefined;
    mocks.subscribe.mockImplementation((_thread,callback)=>{changed=callback;return vi.fn();});
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'report',at:1000,projection}]);
    mocks.work.mockResolvedValue({watch:{...watch,source:'mcp'},projection:{...projection,executionState:'input_required',summary:'private previous summary'}});
    mocks.inputs.mockResolvedValue([{inputId:'input',expectedDigest:'digest',prompt:'private previous question',fields:[]}]);
    mount();expect(await screen.findByText('private previous question')).toBeVisible();
    mocks.work.mockRejectedValue(new Error('activity_source_forbidden'));changed?.();
    await waitFor(()=>expect(screen.getByRole('status')).toBeVisible());
    expect(screen.queryByText('private previous question')).not.toBeInTheDocument();expect(screen.queryByText('private previous summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/提交|Submit/})).not.toBeInTheDocument();expect(screen.queryByTestId('activity-work-watch')).not.toBeInTheDocument();
  });
  it('ignores an older successful source response after a newer refresh lost access', async () => {
    let changed: (()=>void)|undefined,resolveOld!: (value:unknown)=>void;
    mocks.subscribe.mockImplementation((_thread,callback)=>{changed=callback;return vi.fn();});
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'report',at:1000,projection}]);
    mocks.work.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));mount();await waitFor(()=>expect(resolveOld).toBeTypeOf('function'));
    mocks.work.mockRejectedValue(new Error('activity_source_forbidden'));changed?.();await waitFor(()=>expect(screen.getByRole('status')).toBeVisible());
    resolveOld({watch,projection:{...projection,summary:'private late summary'}});await waitFor(()=>expect(mocks.work).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('activity-toggle')).not.toBeInTheDocument();expect(screen.queryByText('private late summary')).not.toBeInTheDocument();
  });
  it('does not retain a report read before the final work permission check denied access', async () => {
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'report',at:1000,projection:{...projection,executionState:'completed'}}]);
    mocks.work.mockResolvedValue({watch,projection:{...projection,executionState:'accepted',freshness:'unavailable',summary:undefined,errorCode:'activity_source_forbidden'}});
    mount();await expand();expect(screen.getByTestId('activity-last-report')).toHaveTextContent(/还没有汇报|No report yet/);
    expect(screen.getByTestId('activity-last-report')).not.toHaveTextContent(/已完成|Completed/);
  });
  it('dismisses only the current reminder and keeps required input and business status visible', async () => {
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'input_required',at:1000,projection}]);
    const current={watch:{...watch,source:'mcp'},projection:{...projection,executionState:'input_required',summary:'仍等待用户选择'},
      presentation:{categoryRank:0,workRef:'project',anchorFactId:'anchor',projectionVersion:7,freshness:'fresh',protocolUnavailable:false},
      attentionState:{presentationIncarnation:'b640b9fa-ff47-4758-aeaf-dfe03d047ca8',dismissed:false}};
    mocks.work.mockResolvedValue(current);mocks.inputs.mockResolvedValue([{inputId:'input',expectedDigest:'digest',prompt:'必须回答的问题',fields:[]}]);
    mocks.dismiss.mockImplementation(async()=>{const dismissed={...current,attentionState:{...current.attentionState,dismissed:true}};mocks.work.mockResolvedValue(dismissed);return dismissed;});
    mount();expect(await screen.findByText('必须回答的问题')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:/关闭此提醒|Dismiss reminder/}));
    await waitFor(()=>expect(mocks.dismiss).toHaveBeenCalledWith({watchId:'watch',expectedProjectionVersion:7,expectedPresentationIncarnation:current.attentionState.presentationIncarnation}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:/关闭此提醒|Dismiss reminder/})).not.toBeInTheDocument());
    expect(screen.getByText('必须回答的问题')).toBeVisible();expect(screen.getByTestId('activity-work-watch')).toHaveTextContent('等待处理');
    expect(mocks.stop).not.toHaveBeenCalled();expect(mocks.reporting).not.toHaveBeenCalled();
  });
  it('keeps blocking facts visible in the collapsed panel and above pending question forms',async()=>{
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'blocked',at:1000,projection}]);
    mocks.work.mockResolvedValue({watch,projection,presentation:{categoryRank:1,workRef:'project',anchorFactId:'anchor',freshness:'fresh',protocolUnavailable:false,reasons:[{code:'authorization_required',severity:'blocking'},{code:'delivery_unknown',severity:'blocking'}]}});
    mount();await screen.findByTestId('activity-toggle');expect(screen.getByTestId('activity-toggle')).toHaveAttribute('aria-expanded','false');expect(screen.getByTestId('activity-safety-facts')).toHaveTextContent('需要确认授权');expect(screen.getByTestId('activity-safety-facts')).toHaveTextContent('交付结果尚未确认');expect(screen.queryByTestId('activity-details')).not.toBeInTheDocument();
  });
  it('keeps every current blocking and warning reason visible after reminder dismissal, using localized copy',async()=>{
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'blocked',at:1000,projection}]);
    mocks.work.mockResolvedValue({watch,projection,presentation:{categoryRank:1,workRef:'project',anchorFactId:'anchor',freshness:'fresh',protocolUnavailable:false,reasons:[{code:'authorization_required',severity:'blocking'},{code:'artifact_stale',severity:'warning'},{code:'draft_ready',severity:'info'}]},attentionState:{presentationIncarnation:'b640b9fa-ff47-4758-aeaf-dfe03d047ca8',dismissed:true}});
    mount();await expand();expect(screen.getByTestId('activity-safety-facts')).toHaveTextContent('需要确认授权');expect(screen.getByTestId('activity-attention-reasons')).toHaveTextContent('产物依据的内容已更新');expect(screen.getByTestId('activity-attention-reasons')).not.toHaveTextContent(/authorization_required|artifact_stale|草稿已就绪/);
  });
  it('does not show old reports or a dismiss action when shared source freshness is unconfirmed', async()=>{
    mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'report',at:1000,projection:{...projection,executionState:'completed'}}]);
    mocks.work.mockResolvedValue({watch,projection,presentation:{categoryRank:2,workRef:'project',anchorFactId:'anchor',projectionVersion:7,freshness:'stale',protocolUnavailable:false},attentionState:{presentationIncarnation:'b640b9fa-ff47-4758-aeaf-dfe03d047ca8',dismissed:false}});
    mount();await expand();expect(screen.getByTestId('activity-last-report')).toHaveTextContent(/还没有汇报|No report yet/);
    expect(screen.queryByRole('button',{name:/关闭此提醒|Dismiss reminder/})).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-work-watch')).toHaveTextContent(/状态暂不可确认|Status unconfirmed/);
  });
  it('shows one card for repeated observations and escapes source-provided text', async () => {
    mocks.list.mockResolvedValue([1, 2].map(localSeq => ({ activityId: `id-${localSeq}`, localSeq, watchId: 'watch', threadId: 'thread', kind: 'progress', at: 1000, projection })));
    mocks.work.mockResolvedValue({ watch, projection });
    const { container } = mount();
    await expand();
    await waitFor(() => expect(screen.getAllByTestId('activity-work-watch')).toHaveLength(1));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(screen.getByText(/已创建|Accepted/)).toBeVisible();
  });
  it('changes reporting preference and stops only the observation with its policy revision', async () => {
    mocks.list.mockResolvedValue([{ activityId: 'id', localSeq: 1, watchId: 'watch', threadId: 'thread', kind: 'accepted', at: 1000, projection }]);
    mocks.work.mockResolvedValue({ watch, projection });
    mocks.reporting.mockImplementation(async () => {
      const updated = { ...watch, preference: 'critical_only', policyRevision: 1 };
      mocks.work.mockResolvedValue({ watch: updated, projection }); return updated;
    });
    mocks.stop.mockResolvedValue({ ...watch, status: 'stopped', policyRevision: 2 });
    mount();
    await expand();
    await waitFor(() => expect(screen.getByTestId('activity-work-watch')).toBeVisible());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'critical_only' } });
    await waitFor(() => expect(mocks.reporting).toHaveBeenCalledWith({ watchId: 'watch', preference: 'critical_only', expectedPolicyRevision: 0 }));
    fireEvent.click(screen.getByRole('button', { name: /停止跟进|Stop following/ }));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith({ watchId: 'watch', expectedPolicyRevision: 1 }));
  });
});
it.each([['zh','待验收','已创建'],['en','Ready for acceptance','Accepted']] as const)('shows the independent ready stage without changing the %s ordinary business state',async(locale,ready,accepted)=>{
 localStorage.setItem('xiaok:locale',locale);
 try{mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'progress',at:1000,projection}]);mocks.work.mockResolvedValue({watch,projection,presentation:{schemaVersion:1,workRef:'project',anchorFactId:'anchor',categoryRank:3,freshness:'fresh',protocolUnavailable:false,deliveryStage:'ready_for_acceptance',reasons:[{code:'review_required',severity:'warning',sources:[]}]}});mount();await expand();const card=await screen.findByTestId('activity-work-watch');expect(card).toHaveTextContent(accepted);expect(card).toHaveTextContent(ready);expect(card).not.toHaveTextContent(/正在等待执行资源|Waiting for execution resources/);}finally{localStorage.removeItem('xiaok:locale');}
});
it.each(['unavailable','protocol','stopped'])('withholds the ready stage label for %s data',async kind=>{
 mocks.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'progress',at:1000,projection}]);mocks.work.mockResolvedValue({watch:{...watch,...(kind==='stopped'?{status:'stopped'}:{})},projection:{...projection,...(kind==='unavailable'?{freshness:'unavailable'}:{})},presentation:{schemaVersion:1,workRef:'project',anchorFactId:'anchor',categoryRank:2,freshness:kind==='unavailable'?'unavailable':'fresh',protocolUnavailable:kind==='protocol',deliveryStage:'ready_for_acceptance',reasons:[]}});mount();await expand();expect(await screen.findByTestId('activity-work-watch')).not.toHaveTextContent(/待验收|Ready for acceptance/);
});
