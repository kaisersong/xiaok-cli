import { describe, expect, it } from 'vitest';
import { createMeetingSummaryService } from '../../electron/meeting-summary-service.js';

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
});
