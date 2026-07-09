import { describe, expect, it, vi } from 'vitest';
import {
  createPreloadApi,
  INVOKE_CHANNEL_BY_KEY,
  PRELOAD_API_KEYS,
} from '../../electron/preload-api.js';
import { parseMeetingTranscriberOptions } from '../../electron/ipc.js';

describe('meeting UI IPC contract', () => {
  it('exposes meeting import APIs through semantic preload channels', async () => {
    expect(PRELOAD_API_KEYS).toContain('meetingPickAudioFile');
    expect(PRELOAD_API_KEYS).toContain('meetingGetMicrophonePermission');
    expect(PRELOAD_API_KEYS).toContain('meetingRequestMicrophonePermission');
    expect(PRELOAD_API_KEYS).toContain('meetingListModels');
    expect(PRELOAD_API_KEYS).toContain('meetingDownloadModel');
    expect(PRELOAD_API_KEYS).toContain('meetingUninstallModel');
    expect(PRELOAD_API_KEYS).toContain('meetingSaveRecordedAudio');
    expect(PRELOAD_API_KEYS).toContain('meetingTranscribePreview');
    expect(PRELOAD_API_KEYS).toContain('meetingDraftRecording');
    expect(PRELOAD_API_KEYS).toContain('meetingProcessRecording');
    expect(PRELOAD_API_KEYS).toContain('meetingSaveTranscript');
    expect(INVOKE_CHANNEL_BY_KEY.meetingPickAudioFile).toBe('desktop:meeting:pickAudioFile');
    expect(INVOKE_CHANNEL_BY_KEY.meetingGetMicrophonePermission).toBe('desktop:meeting:getMicrophonePermission');
    expect(INVOKE_CHANNEL_BY_KEY.meetingRequestMicrophonePermission).toBe('desktop:meeting:requestMicrophonePermission');
    expect(INVOKE_CHANNEL_BY_KEY.meetingListModels).toBe('desktop:meeting:listModels');
    expect(INVOKE_CHANNEL_BY_KEY.meetingDownloadModel).toBe('desktop:meeting:downloadModel');
    expect(INVOKE_CHANNEL_BY_KEY.meetingUninstallModel).toBe('desktop:meeting:uninstallModel');
    expect(INVOKE_CHANNEL_BY_KEY.meetingSaveRecordedAudio).toBe('desktop:meeting:saveRecordedAudio');
    expect(INVOKE_CHANNEL_BY_KEY.meetingTranscribePreview).toBe('desktop:meeting:transcribePreview');
    expect(INVOKE_CHANNEL_BY_KEY.meetingDraftRecording).toBe('desktop:meeting:draftRecording');
    expect(INVOKE_CHANNEL_BY_KEY.meetingProcessRecording).toBe('desktop:meeting:processRecording');
    expect(INVOKE_CHANNEL_BY_KEY.meetingSaveTranscript).toBe('desktop:meeting:saveTranscript');

    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue(null),
      on: vi.fn(),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);

    await api.meetingPickAudioFile();
    await api.meetingGetMicrophonePermission();
    await api.meetingRequestMicrophonePermission();
    await api.meetingListModels();
    await api.meetingDownloadModel('small');
    await api.meetingUninstallModel('base');
    await api.meetingSaveRecordedAudio({
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
    });
    await api.meetingTranscribePreview({
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
      model: 'small',
      language: 'zh',
    });
    await api.meetingDraftRecording({
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      model: 'small',
      language: 'zh',
    });
    await api.meetingProcessRecording({
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      model: 'small',
      language: 'zh',
    });
    await api.meetingSaveTranscript({
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      transcript: 'Alice will ship the demo.',
    });

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, 'desktop:meeting:pickAudioFile');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, 'desktop:meeting:getMicrophonePermission');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, 'desktop:meeting:requestMicrophonePermission');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, 'desktop:meeting:listModels');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(5, 'desktop:meeting:downloadModel', 'small');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(6, 'desktop:meeting:uninstallModel', 'base');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(7, 'desktop:meeting:saveRecordedAudio', {
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(8, 'desktop:meeting:transcribePreview', {
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
      model: 'small',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(9, 'desktop:meeting:draftRecording', {
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      model: 'small',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(10, 'desktop:meeting:processRecording', {
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      model: 'small',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(11, 'desktop:meeting:saveTranscript', {
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      transcript: 'Alice will ship the demo.',
    });
  });

  it('normalizes meeting transcriber options from renderer input', () => {
    expect(parseMeetingTranscriberOptions({
      model: ' small ',
      language: ' zh ',
    })).toEqual({
      model: 'small',
      language: 'zh',
    });

    expect(parseMeetingTranscriberOptions({
      model: 'unknown-model',
      language: 'auto',
    })).toEqual({});
  });
});
