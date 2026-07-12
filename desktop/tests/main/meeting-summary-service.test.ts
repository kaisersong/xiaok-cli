import { describe, expect, it } from 'vitest';
import { createLocalMeetingSummaryService, createMeetingSummaryService } from '../../electron/meeting-summary-service.js';

describe('MeetingSummaryService', () => {
  const localBinding = {
    providerId: 'ollama',
    modelId: 'local-summary',
    locality: 'local' as const,
    configHash: 'local-hash',
  };

  it('blocks local-only summaries when the resolved model is remote', async () => {
    let summarizeCalled = false;
    const service = createMeetingSummaryService({
      resolveBinding: async () => ({
        providerId: 'openai',
        modelId: 'gpt-4o',
        locality: 'remote',
        configHash: 'remote-hash',
      }),
      summarizeTranscript: async () => {
        summarizeCalled = true;
        return { title: 'Should not happen', attendees: [], decisions: [], actionItems: [] };
      },
    });

    const result = await service.summarizeMeeting({
      transcript: 'Alice will ship the demo.',
      segments: [{ start: 0, end: 1, text: 'Alice will ship the demo.' }],
      summaryProvider: 'local-only',
      consentSnapshot: localBinding,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'summary_blocked_by_privacy',
      reason: 'local_model_required',
    });
    expect(summarizeCalled).toBe(false);
  });

  it('blocks summaries when the provider changed after consent', async () => {
    const service = createMeetingSummaryService({
      resolveBinding: async () => ({ ...localBinding, configHash: 'new-local-hash' }),
      summarizeTranscript: async () => ({ title: 'Should not happen', attendees: [], decisions: [], actionItems: [] }),
    });

    const result = await service.summarizeMeeting({
      transcript: 'Alice will ship the demo.',
      segments: [{ start: 0, end: 1, text: 'Alice will ship the demo.' }],
      summaryProvider: 'local-only',
      consentSnapshot: localBinding,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'summary_blocked_by_privacy',
      reason: 'provider_changed',
    });
  });

  it('summarizes with a local model when consent and resolved binding match', async () => {
    const service = createMeetingSummaryService({
      resolveBinding: async () => localBinding,
      summarizeTranscript: async ({ transcript }) => ({
        title: 'Weekly Sync',
        attendees: ['Alice'],
        decisions: [`Summary: ${transcript}`],
        actionItems: [{ owner: 'Alice', text: 'Ship the demo' }],
      }),
    });

    const result = await service.summarizeMeeting({
      transcript: 'Alice will ship the demo.',
      segments: [{ start: 0, end: 1, text: 'Alice will ship the demo.' }],
      summaryProvider: 'local-only',
      consentSnapshot: localBinding,
    });

    expect(result).toMatchObject({
      ok: true,
      summary: {
        title: 'Weekly Sync',
        attendees: ['Alice'],
        actionItems: [{ owner: 'Alice', text: 'Ship the demo' }],
      },
    });
  });

  it('passes the recording scenario through custom summary providers', async () => {
    const service = createMeetingSummaryService({
      resolveBinding: async () => localBinding,
      summarizeTranscript: async ({ scenario }) => ({
        title: `Scenario ${scenario}`,
        scenario,
        attendees: [],
        decisions: [],
        actionItems: [],
      }),
    });

    const result = await service.summarizeMeeting({
      transcript: '客户希望下周试用。',
      segments: [{ start: 0, end: 1, text: '客户希望下周试用。' }],
      summaryProvider: 'local-only',
      scenario: 'sales',
      consentSnapshot: localBinding,
    });

    expect(result).toMatchObject({
      ok: true,
      summary: {
        title: 'Scenario sales',
        scenario: 'sales',
      },
    });
  });

  it('does not invent sentence boundaries for raw unpunctuated Chinese transcript', async () => {
    const service = createLocalMeetingSummaryService();

    const result = await service.summarizeMeeting({
      transcript: '张三负责整理需求李四需要确认接口风险我们决定周五先小范围内测',
      segments: [
        { start: 0, end: 1, text: '张三负责整理需求' },
        { start: 1, end: 2, text: '李四需要确认接口风险' },
        { start: 2, end: 3, text: '我们决定周五先小范围内测' },
      ],
      summaryProvider: 'local-only',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.title).toBe('张三负责整理需求李四需要确认接口风险我们决定周五先小范围内测');
    expect(result.summary.overview).toEqual([
      '张三负责整理需求李四需要确认接口风险我们决定周五先小范围内测。',
    ]);
    expect(result.summary.decisions).toEqual([]);
    expect(result.summary.actionItems).toEqual([]);
  });

  it('does not split Chinese time words as person names while restoring minutes punctuation', async () => {
    const service = createLocalMeetingSummaryService();

    const result = await service.summarizeMeeting({
      transcript: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
      segments: [{
        start: 0,
        end: 8,
        text: '张三负责跟进客户需求。李四明天下午确认报价方案。王五下周提交复盘材料。',
      }],
      summaryProvider: 'local-only',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.overview).toEqual([
      '张三负责跟进客户需求。',
      '李四明天下午确认报价方案。',
      '王五下周提交复盘材料。',
    ]);
    expect(result.summary.overview).not.toContain('李四。');
    expect(result.summary.overview).not.toContain('明。');
    expect(result.summary.overview).not.toContain('天。');
  });

  it('does not fabricate sales fields when transcript has no supporting evidence', async () => {
    const service = createLocalMeetingSummaryService();

    const result = await service.summarizeMeeting({
      transcript: '今天只是简单寒暄，没有讨论业务内容。',
      segments: [{ start: 0, end: 1, text: '今天只是简单寒暄，没有讨论业务内容。' }],
      summaryProvider: 'local-only',
      scenario: 'sales',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.scenario).toBe('sales');
    expect(result.summary.sales).toEqual({
      customerNeeds: ['未识别'],
      painPoints: ['未识别'],
      competitors: ['未识别'],
      commitments: ['未识别'],
      nextSteps: ['未识别'],
      amountsAndDates: ['未识别'],
      contacts: ['未识别'],
    });
  });

  it('builds a local title from the scenario summary content before falling back to time-based callers', async () => {
    const service = createLocalMeetingSummaryService();

    const result = await service.summarizeMeeting({
      transcript: '客户需要移动端试用。我们下周提供演示环境。',
      segments: [
        { start: 0, end: 1, text: '客户需要移动端试用。' },
        { start: 1, end: 2, text: '我们下周提供演示环境。' },
      ],
      summaryProvider: 'local-only',
      scenario: 'sales',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.title).toBe('客户需要移动端试用');
  });
});
