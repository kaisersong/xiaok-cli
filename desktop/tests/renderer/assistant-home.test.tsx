import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGetAssistantOverview, mockActivateAssistant,mockConfigureCalendarMemory } = vi.hoisted(() => ({
  mockGetAssistantOverview: vi.fn(),
  mockActivateAssistant: vi.fn(),
  mockConfigureCalendarMemory:vi.fn(),
}));

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: ({value,onChange}:{value:string;onChange:(value:string)=>void}) => <textarea data-testid="chat-input" value={value} onChange={event=>onChange(event.target.value)} />,
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    getAutomationOverviewSnapshot: vi.fn().mockResolvedValue({
      generatedAt: 1,
      sourceVersions: { loopStore: 1, timedActionStore: 1 },
      globalBackgroundAutoRunEnabled: true,
      totals: { loops: 0, userLoops: 0, schedules: 0, activeSchedules: 0, diagnostics: 0, recentFailures: 0 },
      recentFailures: [],
    }),
  },
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ projects: [], projectsLoaded: true }),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    systemUsername: 'Tester',
    getAssistantOverview: mockGetAssistantOverview,
    activateAssistant: mockActivateAssistant,
    configureAssistantCalendarMemory:mockConfigureCalendarMemory,
  }),
}));

import {
  AssistantHomeCard,
  type AssistantHomeSnapshot,
} from '../../renderer/src/components/assistant/AssistantHomeCard';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { WelcomePage } from '../../renderer/src/components/WelcomePage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(snapshot: AssistantHomeSnapshot, overrides: Partial<React.ComponentProps<typeof AssistantHomeCard>> = {}) {
  const callbacks = {
    onActivate: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onOpenDetails: vi.fn(),
  };
  render(
    <LocaleProvider>
      <AssistantHomeCard snapshot={snapshot} {...callbacks} {...overrides} />
    </LocaleProvider>,
  );
  return callbacks;
}

describe('AssistantHomeCard', () => {
  it('requires explicit consent before activating the personal assistant', () => {
    const callbacks = renderCard({
      profile: { status: 'needs_consent', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [],
      pendingCandidateCount: 0,
    });

    expect(screen.getByText('每日助理')).toBeInTheDocument();
    expect(screen.getByText(/启用后，小K会在晚间整理工作/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用每日助理' }));
    expect(callbacks.onActivate).toHaveBeenCalledTimes(1);
  });

  it('keeps the home card lightweight and renders at most three ranked suggestions', () => {
    const callbacks = renderCard({
      profile: { status: 'active', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [
        { id: 'one', title: '确认发布节奏', summary: '先冻结本周发布窗口' },
        { id: 'two', title: '整理评审结论', summary: '将一致意见归档' },
        { id: 'three', title: '跟进失败任务', summary: '检查昨晚失败原因' },
        { id: 'four', title: '不应出现在首页', summary: '首页最多三条' },
      ],
      pendingCandidateCount: 4,
    });

    expect(screen.getByText('确认发布节奏')).toBeInTheDocument();
    expect(screen.getByText('整理评审结论')).toBeInTheDocument();
    expect(screen.getByText('跟进失败任务')).toBeInTheDocument();
    expect(screen.queryByText('不应出现在首页')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看每日助理详情' }));
    expect(callbacks.onOpenDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '暂停每日助理' }));
    expect(callbacks.onPause).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit resume action while paused', () => {
    const callbacks = renderCard({
      profile: { status: 'paused', eveningTime: '21:30', morningTime: '08:30' },
      suggestions: [],
      pendingCandidateCount: 0,
    });

    expect(screen.getByText('每日助理已暂停')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复每日助理' }));
    expect(callbacks.onResume).toHaveBeenCalledTimes(1);
  });
});

describe('WelcomePage assistant integration', () => {
  it('reads the main-owned snapshot and refreshes it after explicit consent', async () => {
    mockGetAssistantOverview
      .mockResolvedValueOnce({
        profile: { status: 'needs_consent', eveningTime: '21:30', morningTime: '08:30' },
        suggestions: [],
        candidates: [],
        pendingCandidateCount: 0,
      })
      .mockResolvedValueOnce({
        profile: { status: 'active', eveningTime: '21:30', morningTime: '08:30' },
        suggestions: [{ id: 'suggestion-1', title: '授权后建议', summary: '来自 main-owned 快照' }],
        candidates: [],
        pendingCandidateCount: 0,
      });
    mockActivateAssistant.mockResolvedValue(undefined);

    render(
      <LocaleProvider>
        <MemoryRouter>
          <WelcomePage />
        </MemoryRouter>
      </LocaleProvider>,
    );

    expect(await screen.findByRole('button', { name: '启用每日助理' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启用每日助理' }));
    expect(await screen.findByText('授权后建议')).toBeInTheDocument();
    expect(mockActivateAssistant).toHaveBeenCalledTimes(1);
    expect(mockGetAssistantOverview).toHaveBeenCalledTimes(2);
  });
});

it('shows unknown coverage for legacy data without claiming an all-clear', () => {
 renderCard({profile:{status:'active',eveningTime:'22:30',morningTime:'08:30'},suggestions:[],pendingCandidateCount:0});
 expect(screen.getByText('历史结果或尚未检查，来源覆盖未知。')).toBeInTheDocument();
});
it('keeps incomplete sources and failed analysis visible outside the collapsed details', () => {
 renderCard({profile:{status:'active',eveningTime:'22:30',morningTime:'08:30'},suggestions:[],pendingCandidateCount:0,coverageState:'known',analysisStatus:'failed',coverage:[{sourceId:'kswarm_projects',status:'unavailable',requestedWindow:{from:1,to:2},recordCount:0,includedCount:0,checkedAt:2,freshUntil:3,errorCode:'source_unavailable'}]});
 expect(screen.getByText('部分来源未完整检查，请查看覆盖详情。')).toBeVisible();
 expect(screen.getByText('来源已采集，建议分析未完成。')).toBeVisible();
 expect(screen.getByText('检查来源')).toBeInTheDocument();
 expect(screen.getByText('项目')).toBeInTheDocument();
});

it('offers draft/dismiss/snooze only for an identified v2 proposal and never exposes a Start action',()=>{
 const proposal={schemaVersion:2 as const,id:'assistant-action-'+ 'a'.repeat(64),profileId:'default-personal-assistant' as const,revision:3,workItemIdentity:'a'.repeat(64),originRunId:'run',sourceVector:'b'.repeat(64),actionKind:'review' as const,title:'审查结果',reason:'有交付待审',nextStep:'检查证据',instruction:'只读核查交付证据。',evidenceRefs:[{kind:'task',id:'one'}],decision:'open' as const,createdAt:1,updatedAt:1,validUntil:9e15,snoozeUntil:null,startAvailability:'unavailable' as const};
 const draft=vi.fn(),dismiss=vi.fn(),snooze=vi.fn();
 renderCard({profile:{status:'active',eveningTime:'22:30',morningTime:'08:30'},suggestions:[{id:proposal.id,title:proposal.title,summary:proposal.reason}],pendingCandidateCount:0,proposals:[proposal]}, {onPrepareDraft:draft,onDismissAction:dismiss,onSnoozeAction:snooze});
 fireEvent.click(screen.getByRole('button',{name:'整理为草稿'}));expect(draft).toHaveBeenCalledWith(proposal.instruction);
 fireEvent.click(screen.getByRole('button',{name:'忽略'}));expect(dismiss).toHaveBeenCalledWith(proposal.id,3);
 fireEvent.click(screen.getByRole('button',{name:'稍后（2小时）'}));expect(snooze).toHaveBeenCalledWith(proposal.id,3);
 expect(screen.queryByRole('button',{name:'开始处理'})).not.toBeInTheDocument();
});
it('prefills an actual home input without submitting and preserves an existing user draft',async()=>{
 const proposal={schemaVersion:2,id:'assistant-action-'+'a'.repeat(64),profileId:'default-personal-assistant',revision:1,workItemIdentity:'a'.repeat(64),originRunId:'run',sourceVector:'b'.repeat(64),actionKind:'review',title:'Review task',reason:'Review result',nextStep:'Read evidence',instruction:'只读审查证据，不修改原任务。',evidenceRefs:[{kind:'task',id:'one'}],decision:'open',createdAt:1,updatedAt:1,validUntil:9e15,snoozeUntil:null,startAvailability:'unavailable'};
 mockGetAssistantOverview.mockResolvedValue({profile:{status:'active',eveningTime:'22:30',morningTime:'08:30'},suggestions:[{id:proposal.id,title:proposal.title,summary:proposal.reason}],proposals:[proposal],candidates:[],pendingCandidateCount:0});
 render(<LocaleProvider><MemoryRouter><WelcomePage/></MemoryRouter></LocaleProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'整理为草稿'}));
 expect(screen.getByTestId('chat-input')).toHaveValue(proposal.instruction);
 expect(screen.getByText(/草稿已填入输入框，尚未发送/)).toBeInTheDocument();
 fireEvent.change(screen.getByTestId('chat-input'),{target:{value:'我已有的个人草稿'}});
 expect(screen.getByRole('button',{name:'整理为草稿'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'整理为草稿'}));
 expect(screen.getByTestId('chat-input')).toHaveValue('我已有的个人草稿');
});
it('passes independent calendar memory consent through Welcome and HomeCard without optimistic success',async()=>{
 mockGetAssistantOverview.mockReset();mockConfigureCalendarMemory.mockReset();const overview=(enabled:boolean,revision:number)=>({profile:{status:'active',eveningTime:'21:30',morningTime:'08:30'},suggestions:[],candidates:[],pendingCandidateCount:0,calendarMemory:{enabled,revision}});
 mockGetAssistantOverview.mockResolvedValueOnce(overview(false,4)).mockResolvedValue(overview(true,5));let complete!:(value:any)=>void;mockConfigureCalendarMemory.mockImplementation(()=>new Promise(resolve=>{complete=resolve}));
 render(<LocaleProvider><MemoryRouter><WelcomePage/></MemoryRouter></LocaleProvider>);fireEvent.click(await screen.findByText('云之家日历'));fireEvent.click(screen.getByRole('checkbox',{name:'日历准备建议使用已确认记忆'}));
 expect(mockConfigureCalendarMemory).toHaveBeenCalledExactlyOnceWith({enabled:true,expectedRevision:4});expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('checkbox')).toBeDisabled();complete({enabled:true,revision:5});
 await waitFor(()=>expect(screen.getByRole('checkbox')).toBeChecked());expect(screen.getByRole('checkbox')).not.toBeDisabled();expect(mockGetAssistantOverview).toHaveBeenCalledTimes(2);
});
it('refreshes calendar memory revision after conflict and keeps authoritative state with an error',async()=>{
 mockGetAssistantOverview.mockReset();mockConfigureCalendarMemory.mockReset();const overview=(revision:number)=>({profile:{status:'active',eveningTime:'21:30',morningTime:'08:30'},suggestions:[],candidates:[],pendingCandidateCount:0,calendarMemory:{enabled:true,revision}});
 mockGetAssistantOverview.mockResolvedValueOnce(overview(9)).mockResolvedValue(overview(10));mockConfigureCalendarMemory.mockRejectedValue(Error('revision_conflict'));
 render(<LocaleProvider><MemoryRouter><WelcomePage/></MemoryRouter></LocaleProvider>);fireEvent.click(await screen.findByText('云之家日历'));fireEvent.click(screen.getByRole('checkbox'));
 expect(mockConfigureCalendarMemory).toHaveBeenCalledWith({enabled:false,expectedRevision:9});expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByRole('checkbox')).toBeChecked();expect(screen.getByRole('checkbox')).not.toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));expect(mockConfigureCalendarMemory).toHaveBeenLastCalledWith({enabled:false,expectedRevision:10});await waitFor(()=>expect(screen.getByRole('checkbox')).not.toBeDisabled());
});
it('keeps model and periodic settings identities separate when their revisions match',()=>{
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{renderCard({profile:{status:'active',eveningTime:'22:30',morningTime:'08:30'},suggestions:[],pendingCandidateCount:0,analysisProvider:{revision:0,selectedModelId:null,models:[],state:'not_configured',reason:null},periodic:{revision:0,enabled:false,notificationsEnabled:false,intervalMinutes:240,quietHours:{start:'22:00',end:'08:00'},available:false,reason:'quality_unverified',notificationsAvailable:false}},{onConfigureAnalysis:vi.fn(),onSavePeriodic:vi.fn(),onCheckPeriodic:vi.fn()});expect(errors.mock.calls.filter(call=>String(call[0]).includes('same key'))).toEqual([]);
 }finally{errors.mockRestore();}
});
