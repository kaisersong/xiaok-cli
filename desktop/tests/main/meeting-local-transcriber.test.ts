import { describe, expect, it, vi } from 'vitest';
import { createLocalMeetingTranscriber } from '../../electron/meeting-local-transcriber.js';

function readyModelService(modelId = 'base') {
  return {
    listModels: () => [{
      id: modelId,
      fileName: `${modelId}.pt`,
      sizeBytes: 1,
      sizeLabel: '1 B',
      cacheDir: '/tmp/whisper',
      path: `/tmp/whisper/${modelId}.pt`,
      downloaded: true,
      status: 'downloaded' as const,
    }],
  };
}

describe('local meeting transcriber', () => {
  it('calls the bundled Python transcriber and returns timestamped segments', async () => {
    const exec = vi.fn(async () => ({
      stdout: `Detected language: English\n${JSON.stringify({
        text: 'Alice will ship the demo.',
        segments: [
          { start: 0, end: 1.25, text: 'Alice will ship the demo.' },
        ],
      })}\n`,
    }));
    const transcriber = createLocalMeetingTranscriber({
      pythonCommand: 'python3',
      scriptPath: '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
      model: 'base',
      exec,
      timeoutMs: 1234,
      modelService: readyModelService('base'),
    });

    const result = await transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    });

    expect(exec).toHaveBeenCalledWith(
      'python3',
      [
        '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
        'transcribe-file',
        '/tmp/weekly-sync.wav',
        '--meeting-id',
        'meeting-1',
        '--model',
        'base',
      ],
      expect.objectContaining({ timeout: 1234 }),
    );
    expect(result).toEqual({
      text: 'Alice will ship the demo.',
      segments: [
        { start: 0, end: 1.25, text: 'Alice will ship the demo.' },
      ],
    });
  });

  it('normalizes traditional Chinese transcript output to simplified Chinese', async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({
        text: '會議記錄：張三負責後續跟進。',
        segments: [
          { start: 0, end: 1.25, text: '會議記錄：張三負責後續跟進。' },
        ],
      }),
    }));
    const transcriber = createLocalMeetingTranscriber({
      pythonCommand: 'python3',
      scriptPath: '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
      exec,
      modelService: readyModelService(),
    });

    const result = await transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    });

    expect(result).toEqual({
      text: '会议记录：张三负责后续跟进。',
      segments: [
        { start: 0, end: 1.25, text: '会议记录：张三负责后续跟进。' },
      ],
    });
  });

  it('surfaces a local transcriber error when the Python process fails', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('process failed'), { stderr: '{"error":"missing_whisper"}' });
    });
    const transcriber = createLocalMeetingTranscriber({
      pythonCommand: 'python3',
      scriptPath: '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
      exec,
      modelService: readyModelService(),
    });

    await expect(transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    })).rejects.toThrow('missing_whisper');
  });

  it('refuses to invoke Python when the selected model is incomplete', async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({ text: 'should not run', segments: [] }),
    }));
    const transcriber = createLocalMeetingTranscriber({
      pythonCommand: 'python3',
      scriptPath: '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
      model: 'medium',
      exec,
      modelService: {
        listModels: () => [{
          id: 'medium',
          fileName: 'medium.pt',
          sizeBytes: 1_528_008_539,
          sizeLabel: '1.5 GB',
          cacheDir: '/tmp/whisper',
          path: '/tmp/whisper/medium.pt',
          downloaded: false,
          status: 'incomplete',
          localSizeBytes: 778_000_000,
          localSizeLabel: '778 MB',
        }],
      },
    });

    await expect(transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    })).rejects.toThrow('whisper_model_incomplete');
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses to invoke Python when the selected model is not downloaded', async () => {
    const exec = vi.fn(async () => ({
      stdout: JSON.stringify({ text: 'should not run', segments: [] }),
    }));
    const transcriber = createLocalMeetingTranscriber({
      pythonCommand: 'python3',
      scriptPath: '/plugins/kai-meeting-assistant/mcp-servers/meeting-transcriber/server.py',
      model: 'small',
      exec,
      modelService: {
        listModels: () => [{
          id: 'small',
          fileName: 'small.pt',
          sizeBytes: 483_617_219,
          sizeLabel: '484 MB',
          cacheDir: '/tmp/whisper',
          path: '/tmp/whisper/small.pt',
          downloaded: false,
          status: 'not_downloaded',
        }],
      },
    });

    await expect(transcriber.transcribeFile({
      audioFilePath: '/tmp/weekly-sync.wav',
      meetingId: 'meeting-1',
    })).rejects.toThrow('whisper_model_not_downloaded');
    expect(exec).not.toHaveBeenCalled();
  });
});
