import {StrictMode} from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutomationsPage } from '../../renderer/src/components/automations/AutomationsPage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getServiceStatus: vi.fn(),
  restartRelatedService: vi.fn(),
  getLoopDefinitions: vi.fn(),
  getLoopRuns: vi.fn(),
  getEvidenceAnomalies: vi.fn(),
  runLoopNow: vi.fn(),
  listUserLoopTemplates: vi.fn(),
  getLoopScheduleBindings: vi.fn(),
  createUserLoopTemplate: vi.fn(),
  createLoopSchedule: vi.fn(),
  clearLoopRunHistory: vi.fn(),
  getAutomationOverviewSnapshot: vi.fn(),
  getAutomationsConfig: vi.fn(),
  setGlobalBackgroundAutoRun: vi.fn(),
  openLoopOutputDirectory: vi.fn(),
  readLoopOutputPreview: vi.fn(),
  readLoopTaskResult: vi.fn(),
  getAccountSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
}));

vi.mock('../../renderer/src/api/bridge', () => ({
  api: {
    getSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    saveSkillDebugConfig: vi.fn().mockResolvedValue({ enabled: false }),
    getKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    saveKswarmConfig: vi.fn().mockResolvedValue({ maxConcurrentTasks: 3 }),
    getServiceStatus: mocks.getServiceStatus,
    restartRelatedService: mocks.restartRelatedService,
    getLoopDefinitions: mocks.getLoopDefinitions,
    getLoopRuns: mocks.getLoopRuns,
    getEvidenceAnomalies: mocks.getEvidenceAnomalies,
    runLoopNow: mocks.runLoopNow,
    listUserLoopTemplates: mocks.listUserLoopTemplates,
    getLoopScheduleBindings: mocks.getLoopScheduleBindings,
    createUserLoopTemplate: mocks.createUserLoopTemplate,
    createLoopSchedule: mocks.createLoopSchedule,
    clearLoopRunHistory: mocks.clearLoopRunHistory,
    getAutomationOverviewSnapshot: mocks.getAutomationOverviewSnapshot,
    getAutomationsConfig: mocks.getAutomationsConfig,
    setGlobalBackgroundAutoRun: mocks.setGlobalBackgroundAutoRun,
    openLoopOutputDirectory: mocks.openLoopOutputDirectory,
    readLoopOutputPreview: mocks.readLoopOutputPreview,
    readLoopTaskResult: mocks.readLoopTaskResult,
    getAccountSettings: mocks.getAccountSettings,
    updateAccountSettings: mocks.updateAccountSettings,
  },
}));

function renderSettings(path = '/automations/loops') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <LocaleProvider>
        <Routes>
          <Route path="/automations/:tab" element={<AutomationsPage />} />
        </Routes>
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('Automations Loops page', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    mocks.getServiceStatus.mockResolvedValue({
      checkedAt: 1779545079000,
      services: [],
    });
    mocks.restartRelatedService.mockResolvedValue(undefined);
    mocks.getAutomationOverviewSnapshot.mockResolvedValue({
      generatedAt: 10_000,
      globalBackgroundAutoRunEnabled: true,
      totals: {
        loops: 2,
        userLoops: 1,
        schedules: 0,
        activeSchedules: 0,
        diagnostics: 0,
        recentFailures: 0,
      },
      recentFailures: [],
    });
    mocks.getAutomationsConfig.mockResolvedValue({ globalBackgroundAutoRunEnabled: true });
    mocks.setGlobalBackgroundAutoRun.mockResolvedValue({ globalBackgroundAutoRunEnabled: false });
    mocks.getLoopDefinitions.mockResolvedValue([
      {
        id: 'artifact-evidence-regression',
        title: 'Artifact Evidence Regression',
        description: 'Checks artifact completion evidence flows for regressions.',
        status: 'active',
        origin: 'built_in',
        createdAt: 1_000,
        updatedAt: 2_000,
      },
      {
        id: 'user-loop-1',
        title: 'Weekly Briefing',
        description: 'Writes a weekly markdown briefing.',
        status: 'active',
        origin: 'user_template',
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopRuns.mockResolvedValue([]);
    mocks.getEvidenceAnomalies.mockResolvedValue([]);
    mocks.runLoopNow.mockResolvedValue({
      status: 'success',
      run: {
        id: 'run-user-loop',
        loopId: 'user-loop-1',
        status: 'success',
        trigger: { kind: 'manual' },
        evidenceIds: ['ev-file'],
        startedAt: 3_000,
        finishedAt: 4_000,
        updatedAt: 4_000,
      },
    });
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        kind: 'markdown_file',
        prompt: 'Summarize the week.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'briefing.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopScheduleBindings.mockResolvedValue([]);
    mocks.createUserLoopTemplate.mockResolvedValue({
      template: {
        loopId: 'new-loop',
        kind: 'markdown_file',
        prompt: 'Write a report.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'report.md',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 5_000,
        updatedAt: 5_000,
      },
      ignoredLegacyScheduleFields: [],
    });
    mocks.createLoopSchedule.mockResolvedValue({
      id: 'loop-schedule',
      title: 'Weekly Briefing schedule',
      status: 'active',
      trigger: { kind: 'interval', everyMs: 3_600_000 },
      executor: { kind: 'loop', loopId: 'user-loop-1' },
      createdAt: 5_000,
      updatedAt: 5_000,
    });
    mocks.openLoopOutputDirectory.mockResolvedValue({ ok: true });
    mocks.readLoopOutputPreview.mockResolvedValue({
      ok: true,
      loopId: 'user-loop-1',
      pathLabel: '/tmp/xiaok-loop/briefing.md',
      content: '# Weekly Briefing\n\nReady.',
      sizeBytes: 27,
      truncated: false,
    });
    mocks.getAccountSettings.mockResolvedValue({
      pipeline_trace_enabled: false,
      prompt_cache_debug_enabled: false,
    });
    mocks.updateAccountSettings.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    scrollIntoView.mockReset();
  });

  it('shows user Markdown loops with output path and reuses Run now from the Loops page', async () => {
    renderSettings();

    await screen.findByText('用户循环');
    expect(screen.getByText('Weekly Briefing')).toBeInTheDocument();
    expect(screen.getByText('/tmp/xiaok-loop')).toBeInTheDocument();
    expect(screen.getByText('briefing.md')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/xiaok-loop/briefing.md')).not.toBeInTheDocument();
    expect(screen.queryByText('Loop 诊断')).not.toBeInTheDocument();
    expect(screen.queryByText('Artifact Evidence Regression')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('run-loop-user-loop-1'));

    await waitFor(() => {
      expect(mocks.runLoopNow).toHaveBeenCalledWith('user-loop-1');
    });
  });

  it('shows publication pending instead of completion after the Main run response', async () => {
    mocks.runLoopNow.mockResolvedValue({status:'publication_pending',run:{id:'pending',loopId:'user-loop-1',status:'running'}});
    renderSettings();await screen.findByText('Weekly Briefing');fireEvent.click(screen.getByLabelText('run-loop-user-loop-1'));
    await screen.findByText('等待验证发布');expect(mocks.runLoopNow).toHaveBeenCalledTimes(1);
  });

  it('shows persisted publication pending after reload without running again', async () => {
    mocks.getLoopRuns.mockResolvedValue([{id:'pending',loopId:'user-loop-1',status:'running',businessState:'publication_pending',startedAt:1}]);
    renderSettings();await screen.findByText('Weekly Briefing');
    await screen.findByText('等待验证发布');expect(mocks.runLoopNow).not.toHaveBeenCalled();
  });

  it('opens the output directory and previews the output file through loopId-based APIs', async () => {
    renderSettings();

    await screen.findByText('Weekly Briefing');

    fireEvent.click(screen.getByRole('button', { name: '打开输出目录: Weekly Briefing' }));
    await waitFor(() => {
      expect(mocks.openLoopOutputDirectory).toHaveBeenCalledWith('user-loop-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '预览输出文件: Weekly Briefing' }));
    await waitFor(() => {
      expect(mocks.readLoopOutputPreview).toHaveBeenCalledWith('user-loop-1');
    });
    expect(await screen.findByText('# Weekly Briefing')).toBeInTheDocument();
    expect(screen.getByText('Ready.')).toBeInTheDocument();
  });

  it('shows result actions for task-completion loops and hides file output actions', async () => {
    mocks.listUserLoopTemplates.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        kind: 'task_completion',
        prompt: 'Generate today AI briefing.',
        outputDirectory: '',
        outputFileName: '',
        scheduleEnabled: false,
        autoRunApproved: false,
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
    mocks.getLoopRuns.mockResolvedValue([
      {
        id: 'run-user-loop',
        loopId: 'user-loop-1',
        status: 'success',
        trigger: { kind: 'manual' },
        evidenceIds: ['ev-answer'],
        startedAt: 3_000,
        finishedAt: 4_000,
        updatedAt: 4_000,
      },
    ]);
    mocks.readLoopTaskResult.mockResolvedValue({
      ok: true,
      loopId: 'user-loop-1',
      runId: 'run-user-loop',
      taskId: 'task-ai-daily',
      content: '# AI 日报\n\n今日要点。',
    });

    renderSettings();

    await screen.findByText('Weekly Briefing');
    expect(screen.queryByRole('button', { name: '打开输出目录: Weekly Briefing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览输出文件: Weekly Briefing' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看结果: Weekly Briefing' }));

    await waitFor(() => {
      expect(mocks.readLoopTaskResult).toHaveBeenCalledWith('user-loop-1');
    });
    expect(await screen.findByText('# AI 日报')).toBeInTheDocument();
    expect(screen.getByText('今日要点。')).toBeInTheDocument();
  });

  it('shows duplicate schedule bindings on user loop cards without selecting a primary schedule', async () => {
    mocks.getLoopScheduleBindings.mockResolvedValue([
      {
        loopId: 'user-loop-1',
        kind: 'multiple',
        count: 2,
        activeCount: 1,
        actionIds: ['loop-schedule-a', 'loop-schedule-b'],
        schedules: [
          { id: 'loop-schedule-a', title: 'Morning Loop', status: 'active', trigger: { kind: 'daily', hour: 9, minute: 0 }, updatedAt: 3_000 },
          { id: 'loop-schedule-b', title: 'Evening Loop', status: 'paused', trigger: { kind: 'daily', hour: 18, minute: 0 }, updatedAt: 4_000 },
        ],
      },
    ]);

    renderSettings();

    expect(await screen.findByText('Weekly Briefing')).toBeTruthy();
    expect(screen.getByText(/多个计划/)).toBeTruthy();
    expect(screen.getByText(/2 计划/)).toBeTruthy();
    expect(screen.queryByText('Morning Loop')).toBeNull();
    expect(screen.queryByText('Evening Loop')).toBeNull();
  });

  it('creates a Markdown loop template from the Loops page without schedule fields', async () => {
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '新建循环' }));

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'markdown_file' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Daily Report' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Write a short daily report.' } });
    fireEvent.change(screen.getByLabelText('输出目录'), { target: { value: '/tmp/xiaok-loop' } });
    fireEvent.change(screen.getByLabelText('输出文件名'), { target: { value: 'daily.md' } });
    fireEvent.click(screen.getByRole('button', { name: '创建循环' }));

    await waitFor(() => {
      expect(mocks.createUserLoopTemplate).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Daily Report',
        kind: 'markdown_file',
        prompt: 'Write a short daily report.',
        outputDirectory: '/tmp/xiaok-loop',
        outputFileName: 'daily.md',
      }));
    });
    expect(mocks.createUserLoopTemplate.mock.calls[0][0]).not.toHaveProperty('scheduleEnabled');
    expect(mocks.createUserLoopTemplate.mock.calls[0][0]).not.toHaveProperty('scheduleTrigger');
    expect(mocks.createUserLoopTemplate.mock.calls[0][0]).not.toHaveProperty('autoRunApproved');
  });

  it('按首页深链定位并高亮对应循环', async () => {
    renderSettings('/automations/loops#loop-user-loop-1');

    await screen.findByText('Weekly Briefing');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' }));
    expect(document.getElementById('loop-user-loop-1')).toBeTruthy();
  });
  it('does not display cached execution success as a fresh completion observation', async () => {
    mocks.getLoopRuns.mockResolvedValue([{id:'historical',loopId:'user-loop-1',status:'success',businessState:'success',startedAt:1,updatedAt:2,trigger:{kind:'manual'},evidenceIds:[]}]);
    renderSettings();await screen.findByText('Weekly Briefing');
    expect((await screen.findAllByText('等待验证发布')).length).toBeGreaterThan(0);
    expect(mocks.runLoopNow).not.toHaveBeenCalled();
  });
  it('shows a dated verified observation and clears it when refresh fails', async () => {
    mocks.getLoopRuns.mockResolvedValue([{id:'observed',loopId:'user-loop-1',status:'success',businessState:'success',completionObservation:{state:'verified_at_read',checkedAt:1000},startedAt:1,updatedAt:2,trigger:{kind:'manual'},evidenceIds:[]}]);
    renderSettings('/automations/diagnostics');await screen.findByText('Artifact Evidence Regression');await screen.findByText(/核验通过/);
    mocks.getLoopRuns.mockRejectedValueOnce(Error('offline'));
    fireEvent.click(screen.getByRole('button',{name:'刷新'}));
    await waitFor(()=>expect(screen.queryByText(/核验通过/)).not.toBeInTheDocument());
    expect((await screen.findAllByText('等待验证发布')).length).toBeGreaterThan(0);
  });

  it('ignores an older successful response after a newer request has required revalidation', async () => {
    const definitions=await mocks.getLoopDefinitions();let release!:(value:unknown)=>void;
    mocks.getLoopDefinitions.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));
    mocks.getLoopRuns.mockResolvedValue([{id:'current',loopId:'user-loop-1',status:'success',businessState:'publication_pending',completionObservation:{state:'needs_revalidation',checkedAt:2000},startedAt:1,updatedAt:2,trigger:{kind:'manual'},evidenceIds:[]}]);
    render(<StrictMode><MemoryRouter initialEntries={['/automations/loops']}><LocaleProvider><Routes><Route path='/automations/:tab' element={<AutomationsPage/>}/></Routes></LocaleProvider></MemoryRouter></StrictMode>);
    await screen.findByText('Weekly Briefing');expect((await screen.findAllByText('等待验证发布')).length).toBeGreaterThan(0);
    const count=mocks.getLoopRuns.mock.calls.length;
    mocks.getLoopRuns.mockResolvedValue([{id:'old',loopId:'user-loop-1',status:'success',businessState:'success',completionObservation:{state:'verified_at_read',checkedAt:1000},startedAt:1,updatedAt:2,trigger:{kind:'manual'},evidenceIds:[]}]);
    release(definitions);await waitFor(()=>expect(mocks.getLoopRuns.mock.calls.length).toBeGreaterThan(count));
    expect(screen.queryByText(/核验通过/)).not.toBeInTheDocument();
  });

  it('copies historical execution and dated verification on separate localized lines', async () => {
    const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    mocks.getLoopRuns.mockResolvedValue([{id:'observed',loopId:'artifact-evidence-regression',status:'success',businessState:'success',completionObservation:{state:'verified_at_read',checkedAt:1000},startedAt:1,updatedAt:2,trigger:{kind:'manual'},evidenceIds:[]}]);
    renderSettings('/automations/diagnostics');await screen.findByText(/核验通过/);fireEvent.click(screen.getByLabelText('copy-loop-diagnostics-artifact-evidence-regression'));await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));expect(writeText.mock.calls[0][0]).toContain('历史执行状态: success\n本次核验观察: 于 ');expect(writeText.mock.calls[0][0]).not.toContain('Latest run:');
  });

  it('clears loading when a silent run refresh supersedes an in-flight visible refresh', async () => {
    renderSettings('/automations/diagnostics');await screen.findByText('Artifact Evidence Regression');
    const button=screen.getByRole('button',{name:'刷新'});await waitFor(()=>expect(button).not.toBeDisabled());
    const definitions=await mocks.getLoopDefinitions();let release!:(value:unknown)=>void;
    mocks.getLoopDefinitions.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));
    fireEvent.click(button);expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText('run-loop-artifact-evidence-regression'));
    await waitFor(()=>expect(mocks.runLoopNow).toHaveBeenCalled());
    await waitFor(()=>expect(button).not.toBeDisabled());release(definitions);
  });

  it('clears the previous output bytes before a refresh and keeps them cleared on failure', async () => {
    mocks.readLoopOutputPreview.mockResolvedValueOnce({ok:true,loopId:'user-loop-1',pathLabel:'briefing.md',content:'Old published bytes',sizeBytes:19,truncated:false});
    renderSettings();await screen.findByText('Weekly Briefing');fireEvent.click(screen.getByRole('button',{name:'预览输出文件: Weekly Briefing'}));await screen.findByText('Old published bytes');
    mocks.readLoopOutputPreview.mockRejectedValueOnce(Error('publication_expired'));fireEvent.click(screen.getByRole('button',{name:'预览输出文件: Weekly Briefing'}));
    await waitFor(()=>expect(screen.queryByText('Old published bytes')).not.toBeInTheDocument());
  });

  it.each(['loop_operation_unknown', "Error invoking remote method 'desktop:loops:createUserTemplate': Error: loop_operation_unknown"])('loop typed boundary keeps uncertain creation input and localized result: %s', async message => {
    mocks.createUserLoopTemplate.mockRejectedValueOnce(Error(message));renderSettings();
    fireEvent.click(await screen.findByRole('button',{name:'新建循环'}));
    fireEvent.change(screen.getByLabelText('名称'),{target:{value:'Unconfirmed creation'}});
    fireEvent.change(screen.getByLabelText('Prompt'),{target:{value:'Keep original input'}});
    fireEvent.click(screen.getByRole('button',{name:'创建循环'}));
    expect(await screen.findByText('操作结果未确认，请刷新后检查。')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('Unconfirmed creation');
    expect(screen.getByLabelText('Prompt')).toHaveValue('Keep original input');
    expect(mocks.createUserLoopTemplate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('循环已创建')).not.toBeInTheDocument();
  });
  it('loop typed boundary retains prior anomaly facts after projection becomes unavailable',async()=>{
    mocks.getEvidenceAnomalies.mockResolvedValue([{id:'old-anomaly',loopId:'artifact-evidence-regression',ownerKind:'task',ownerId:'old-task',kind:'source_unavailable',status:'open',firstSeenAt:1,lastSeenAt:1,seenCount:1,message:'Previously observed anomaly',evidenceIds:[],metadata:{}}]);
    renderSettings('/automations/diagnostics');await screen.findByText('Previously observed anomaly');
    mocks.getEvidenceAnomalies.mockRejectedValue(Error('loop_projection_unavailable'));
    fireEvent.click(screen.getByRole('button',{name:'刷新'}));
    expect(await screen.findByText('暂时无法读取循环数据，请刷新后重试。')).toBeInTheDocument();
    expect(screen.getByText('Previously observed anomaly')).toBeInTheDocument();
    expect(mocks.runLoopNow).not.toHaveBeenCalled();
  });
  it('loop typed boundary displays uncertain clear outcome and preserves overview without another mutation',async()=>{
    mocks.getAutomationOverviewSnapshot.mockResolvedValue({generatedAt:10,sourceVersions:{loopStore:0,timedActionStore:0},globalBackgroundAutoRunEnabled:true,totals:{loops:1,userLoops:1,schedules:0,activeSchedules:0,diagnostics:0,recentFailures:1},recentFailures:[{id:'old-failure',source:'loop_run',ownerId:'user-loop-1',loopId:'user-loop-1',title:'Preserved failure',status:'failed',message:'Original failure facts',occurredAt:1}]});
    mocks.clearLoopRunHistory.mockRejectedValueOnce(Error('loop_operation_unknown'));
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
    try{renderSettings('/automations/overview');await screen.findByText('Original failure facts');fireEvent.click(screen.getByRole('button',{name:'清除此记录'}));
      expect(await screen.findByRole('alert')).toHaveTextContent('操作结果未确认，请刷新后检查。');
      expect(screen.getByText('Original failure facts')).toBeInTheDocument();expect(mocks.clearLoopRunHistory).toHaveBeenCalledTimes(1);
    }finally{confirm.mockRestore();}
  });

});
