import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ObservationControls} from '../../renderer/src/components/ObservationControls';
import {zh} from '../../renderer/src/locales/zh';
import {en} from '../../renderer/src/locales/en';
const state=vi.hoisted(()=>({locale:'zh',prepare:vi.fn(),status:vi.fn(),stop:vi.fn(),revoke:vi.fn()}));
vi.mock('../../renderer/src/contexts/LocaleContext',()=>({useLocale:()=>({t:state.locale==='zh'?zh:en})}));
vi.mock('../../renderer/src/api',()=>({api:{prepareObservationTask:state.prepare,getObservationTaskStatus:state.status,stopObservationTask:state.stop,revokeObservationTask:state.revoke}}));
afterEach(()=>{cleanup();vi.clearAllMocks();state.locale='zh';});
describe('Observation controls',()=>{
 it('shows semantic outcomes and reserved budget from main, refreshing on existing task activity',async()=>{
  state.status.mockResolvedValue({mode:'active',semantic:{mode:'mechanism-experiment',state:'waiting',attempts:0,maxAttempts:2,reservedCostUnits:0,maxCostUnits:50000000}});
  const view=render(<ObservationControls draftId={null} onDraft={()=>{}} running taskId="task" activityRevision={0}/>);
  await screen.findByText('等待已确认的子任务边界');
  state.status.mockResolvedValue({mode:'active',semantic:{mode:'mechanism-experiment',state:'compacted',attempts:1,maxAttempts:2,reservedCostUnits:1000000,maxCostUnits:50000000}});
  view.rerender(<ObservationControls draftId={null} onDraft={()=>{}} running taskId="task" activityRevision={1}/>);
  await screen.findByText('历史已压缩，原始要求和执行事实已保留');
  expect(screen.getByText(/摘要调用 1\/2/)).toBeTruthy();expect(screen.getByText(/按发送前核验价格预留/)).toBeTruthy();
 });
 it.each(['revoked','unavailable'])('shows accurate %s state',async mode=>{state.status.mockResolvedValue({mode});render(<ObservationControls draftId={null} onDraft={()=>{}} running taskId="task"/>);await screen.findByText(mode==='revoked'?'披露授权已撤销；任务正在停止':'此任务未启用观测记忆');expect(screen.queryByText(zh.observation.closed)).toBeNull();});
 it.each(['zh','en'])('uses %s labels and only returns a native-approved draft',async locale=>{
  state.locale=locale;state.prepare.mockResolvedValue({draftId:'approved',model:'deepseek-flash'});const onDraft=vi.fn();
  render(<ObservationControls draftId={null} onDraft={onDraft} running={false}/>);
  fireEvent.click(screen.getByRole('button',{name:(locale==='zh'?zh:en).observation.enable}));await waitFor(()=>expect(onDraft).toHaveBeenCalledWith('approved'));
 });
 it('stop and revoke remain separate controls, and errors do not pretend success',async()=>{
  state.status.mockResolvedValue({mode:'active'});state.stop.mockResolvedValue({mode:'recall-only'});state.revoke.mockRejectedValue(new Error('no authority'));
  render(<ObservationControls draftId={null} onDraft={()=>{}} running taskId="task"/>);
  fireEvent.click(await screen.findByRole('button',{name:zh.observation.stop}));await screen.findByText(zh.observation.recallOnly);
  fireEvent.click(screen.getByRole('button',{name:zh.observation.revoke}));await screen.findByRole('alert');
  expect(state.stop).toHaveBeenCalledWith('task');expect(state.revoke).toHaveBeenCalledWith('task');expect(screen.getByText(zh.observation.recallOnly)).toBeTruthy();
 });
});

it.each(['zh','en'])('separates durable edit and validation facts and shows unknown execution in %s',async locale=>{
 state.locale=locale;state.status.mockResolvedValue({mode:'active',compound:{mode:'mechanism-experiment',edit:'succeeded',validation:'unknown',pendingOperations:0,unknownOperations:1,completedOperations:0}});
 render(<ObservationControls draftId={null} onDraft={()=>{}} running taskId="task"/>);
 await screen.findByText(locale==='zh'?'编辑：已成功':'Edit: Succeeded');
 expect(screen.getByText(locale==='zh'?'验证：结果未知':'Validation: Outcome unknown')).toBeTruthy();
 expect(screen.getByText(locale==='zh'?'有 1 项操作结果未知，需要确认执行状态。':'1 operation(s) have an unknown outcome and require execution confirmation.')).toBeTruthy();
});
