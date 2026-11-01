import { describe, expect, it, vi } from 'vitest';
import { createAssistantLoopExecutor } from '../../electron/assistant-loop-executor.js';

const activeProfile = {
  id: 'default-personal-assistant' as const,
  status: 'active' as const,
  locale: 'zh' as const,
  timeZone: 'Asia/Shanghai',
  eveningTime: '22:30',
  morningTime: '08:30',
  workdays: [1, 2, 3, 4, 5],
  quietHours: { start: '23:00', end: '07:00' },
  dataScopes: ['tasks' as const],
  createdAt: 1,
  updatedAt: 1,
};

describe('assistant loop executor', () => {
  it.each(['needs_consent', 'paused'] as const)('does not collect or call the provider when profile is %s', async status => {
    const collect = vi.fn();
    const complete = vi.fn();
    const executor = createAssistantLoopExecutor({
      getProfile: () => ({ ...activeProfile, status }),
      collect,
      complete,
      stageCandidates: vi.fn(),
      recordEvidence: vi.fn(),
      finishSuccess: vi.fn(),
      finishFailure: vi.fn(),
    });

    await expect(executor.execute({ kind: 'evening', runId: 'run-1', now: 2_000 })).resolves.toEqual({
      status: 'skipped',
      reason: status,
    });
    expect(collect).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('stages validated evening candidates before atomic success publication', async () => {
    const calls: string[] = [];
    const stageCandidates = vi.fn(async () => { calls.push('stage'); });
    const recordEvidence = vi.fn(async () => { calls.push('evidence'); return ['evidence-1']; });
    const finishSuccess = vi.fn(async () => { calls.push('finish'); });
    const executor = createAssistantLoopExecutor({
      getProfile: () => activeProfile,
      collect: vi.fn().mockResolvedValue({ from: 1, to: 2, timeZone: 'Asia/Shanghai', items: [], dropped: {} }),
      complete: vi.fn().mockResolvedValue({
        summary: '今日完成关键工作。',
        candidates: [{
          kind: 'memory',
          title: '汇报偏好',
          content: '先说结论。',
          scope: 'global',
          confidence: 0.9,
          evidenceRefs: [{ kind: 'task', id: 'task-1' }],
          dedupeKey: 'memory:reporting',
        }],
      }),
      stageCandidates,
      recordEvidence,
      finishSuccess,
      finishFailure: vi.fn(),
    });

    const result = await executor.execute({ kind: 'evening', runId: 'run-1', now: 2_000 });

    expect(result).toEqual({ status: 'success', summary: '今日完成关键工作。', candidateCount: 1 });
    expect(calls).toEqual(['stage', 'evidence', 'finish']);
    expect(finishSuccess).toHaveBeenCalledWith({ runId: 'run-1', evidenceIds: ['evidence-1'], summary: '今日完成关键工作。', now: 2_000 });
  });

  it('morning briefing accepts zero suggestions and never stages candidates', async () => {
    const stageCandidates = vi.fn();
    const executor = createAssistantLoopExecutor({
      getProfile: () => activeProfile,
      collect: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockResolvedValue({ recommendations: [] }),
      stageCandidates,
      recordEvidence: vi.fn().mockResolvedValue(['briefing-evidence']),
      finishSuccess: vi.fn(),
      finishFailure: vi.fn(),
    });

    await expect(executor.execute({ kind: 'morning', runId: 'run-2', now: 3_000 })).resolves.toEqual({
      status: 'success',
      summary: 'assistant_morning_no_recommendations',
      candidateCount: 0,
    });
    expect(stageCandidates).not.toHaveBeenCalled();
  });

  it('records runtime_unavailable without falling back to a general agent runtime', async () => {
    const finishFailure = vi.fn();
    const executor = createAssistantLoopExecutor({
      getProfile: () => activeProfile,
      collect: vi.fn().mockResolvedValue({}),
      complete: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      stageCandidates: vi.fn(),
      recordEvidence: vi.fn(),
      finishSuccess: vi.fn(),
      finishFailure,
    });

    await expect(executor.execute({ kind: 'evening', runId: 'run-3', now: 4_000 })).resolves.toEqual({
      status: 'failed',
      reason: 'runtime_unavailable',
    });
    expect(finishFailure).toHaveBeenCalledWith({
      runId: 'run-3',
      failureKind: 'executor_failed',
      message: 'runtime_unavailable: provider unavailable',
      now: 4_000,
    });
  });
});

it('rejects external sources on protected publication without a common fence and never falls back ordinary',async()=>{
 const ordinary=vi.fn(),publish=vi.fn(),complete=vi.fn();
 const executor=createAssistantLoopExecutor({getProfile:()=>activeProfile,collect:()=>({}),beginDerivedCapture:()=>({finish:async()=>({lineage:{version:1,profileId:activeProfile.id,profileRevision:'a'.repeat(64),parents:[],calendar:{epoch:1,observationRevision:'a'.repeat(64),events:[]}},context:{kind:'data',calendar:{status:'partial',events:[]},personalization:{kind:'data',status:'disabled',memories:[]}},items:[],isCurrent:()=>true})}),complete,stageCandidates:ordinary,recordEvidence:ordinary,finishSuccess:ordinary,finishFailure:vi.fn()});
 expect((await executor.execute({kind:'morning',runId:'run',now:1,publicationProducer:{recordAssistantOutput:publish} as never})).status).toBe('failed');
 expect(complete).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled();expect(ordinary).not.toHaveBeenCalled();
});
it('never sends naked external or untracked inherited source text to the model',async()=>{
 for(const snapshot of [{calendar:{events:[{title:'private'}]}},{current:{items:[]},derivedRunIds:['old-private-run']}]){
  const complete=vi.fn(),recordEvidence=vi.fn();
  const executor=createAssistantLoopExecutor({getProfile:()=>activeProfile,collect:()=>snapshot,complete,stageCandidates:vi.fn(),recordEvidence,finishSuccess:vi.fn(),finishFailure:vi.fn()});
  expect((await executor.execute({kind:'morning',runId:'run',now:1})).status).toBe('failed');expect(complete).not.toHaveBeenCalled();expect(recordEvidence).not.toHaveBeenCalled();
 }
});
