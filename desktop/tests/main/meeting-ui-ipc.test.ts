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
    expect(PRELOAD_API_KEYS).toContain('meetingGetAsrConfig');
    expect(PRELOAD_API_KEYS).toContain('meetingSaveAsrConfig');
    expect(PRELOAD_API_KEYS).toContain('meetingListModels');
    expect(PRELOAD_API_KEYS).toContain('meetingDownloadModel');
    expect(PRELOAD_API_KEYS).toContain('meetingUninstallModel');
    expect(PRELOAD_API_KEYS).toContain('meetingSaveRecordedAudio');
    expect(PRELOAD_API_KEYS).toContain('meetingTranscribePreview');
    expect(PRELOAD_API_KEYS).toContain('meetingStartLiveTranscription');
    expect(PRELOAD_API_KEYS).toContain('meetingPushLiveTranscriptionAudio');
    expect(PRELOAD_API_KEYS).toContain('meetingFinishLiveTranscription');
    expect(PRELOAD_API_KEYS).toContain('meetingCancelLiveTranscription');
    expect(PRELOAD_API_KEYS).toContain('onMeetingLiveTranscriptionUpdate');
    expect(PRELOAD_API_KEYS).toContain('meetingDraftRecording');
    expect(PRELOAD_API_KEYS).toContain('meetingProcessRecording');
    expect(PRELOAD_API_KEYS).toContain('meetingSaveTranscript');
    expect(INVOKE_CHANNEL_BY_KEY.meetingPickAudioFile).toBe('desktop:meeting:pickAudioFile');
    expect(INVOKE_CHANNEL_BY_KEY.meetingGetMicrophonePermission).toBe('desktop:meeting:getMicrophonePermission');
    expect(INVOKE_CHANNEL_BY_KEY.meetingRequestMicrophonePermission).toBe('desktop:meeting:requestMicrophonePermission');
    expect(INVOKE_CHANNEL_BY_KEY.meetingGetAsrConfig).toBe('desktop:meeting:getAsrConfig');
    expect(INVOKE_CHANNEL_BY_KEY.meetingSaveAsrConfig).toBe('desktop:meeting:saveAsrConfig');
    expect(INVOKE_CHANNEL_BY_KEY.meetingListModels).toBe('desktop:meeting:listModels');
    expect(INVOKE_CHANNEL_BY_KEY.meetingDownloadModel).toBe('desktop:meeting:downloadModel');
    expect(INVOKE_CHANNEL_BY_KEY.meetingUninstallModel).toBe('desktop:meeting:uninstallModel');
    expect(INVOKE_CHANNEL_BY_KEY.meetingSaveRecordedAudio).toBe('desktop:meeting:saveRecordedAudio');
    expect(INVOKE_CHANNEL_BY_KEY.meetingTranscribePreview).toBe('desktop:meeting:transcribePreview');
    expect(INVOKE_CHANNEL_BY_KEY.meetingStartLiveTranscription).toBe('desktop:meeting:live:start');
    expect(INVOKE_CHANNEL_BY_KEY.meetingPushLiveTranscriptionAudio).toBe('desktop:meeting:live:pushAudio');
    expect(INVOKE_CHANNEL_BY_KEY.meetingFinishLiveTranscription).toBe('desktop:meeting:live:finish');
    expect(INVOKE_CHANNEL_BY_KEY.meetingCancelLiveTranscription).toBe('desktop:meeting:live:cancel');
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
    await api.meetingGetAsrConfig();
    await api.meetingSaveAsrConfig({
      defaultProvider: 'volcengine-asr',
      volcengine: {
        appKey: 'volc-app',
        accessKey: 'volc-access',
      },
    });
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
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
    });
    await api.meetingDraftRecording({
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
    });
    await api.meetingProcessRecording({
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
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
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, 'desktop:meeting:getAsrConfig');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(5, 'desktop:meeting:saveAsrConfig', {
      defaultProvider: 'volcengine-asr',
      volcengine: {
        appKey: 'volc-app',
        accessKey: 'volc-access',
      },
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(6, 'desktop:meeting:listModels');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(7, 'desktop:meeting:downloadModel', 'small');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(8, 'desktop:meeting:uninstallModel', 'base');
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(9, 'desktop:meeting:saveRecordedAudio', {
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(10, 'desktop:meeting:transcribePreview', {
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(11, 'desktop:meeting:draftRecording', {
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(12, 'desktop:meeting:processRecording', {
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(13, 'desktop:meeting:transcribePreview', {
      title: 'Weekly Sync',
      wavBase64: 'UklGRg==',
      model: 'small',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(14, 'desktop:meeting:draftRecording', {
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      model: 'small',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(15, 'desktop:meeting:processRecording', {
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      model: 'small',
      language: 'zh',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(16, 'desktop:meeting:saveTranscript', {
      collectionId: 'col-1',
      title: 'Weekly Sync',
      audioFilePath: '/tmp/weekly-sync.wav',
      transcript: 'Alice will ship the demo.',
    });
  });

  it('routes Aliyun realtime audio through semantic channels and a structured update event', async () => {
    const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
    const ipcRenderer = {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn((channel: string, listener: (event: unknown, payload: unknown) => void) => listeners.set(channel, listener)),
      off: vi.fn(),
    };
    const api = createPreloadApi(ipcRenderer);
    const update = vi.fn();
    const unsubscribe = api.onMeetingLiveTranscriptionUpdate(update);

    await api.meetingStartLiveTranscription({ engine: 'aliyun-asr', sampleRate: 16_000, language: 'zh' });
    await api.meetingPushLiveTranscriptionAudio({ sessionId: 'live-1', pcmBase64: 'AQACAA==' });
    await api.meetingFinishLiveTranscription({ sessionId: 'live-1' });
    await api.meetingCancelLiveTranscription({ sessionId: 'live-1' });
    listeners.get('desktop:meeting:live:update')?.({}, {
      sessionId: 'live-1', sentenceId: '7', start: 0, end: 1, text: '测试。', final: true,
    });

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, 'desktop:meeting:live:start', { engine: 'aliyun-asr', sampleRate: 16_000, language: 'zh' });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, 'desktop:meeting:live:pushAudio', { sessionId: 'live-1', pcmBase64: 'AQACAA==' });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, 'desktop:meeting:live:finish', { sessionId: 'live-1' });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, 'desktop:meeting:live:cancel', { sessionId: 'live-1' });
    expect(update).toHaveBeenCalledWith({
      sessionId: 'live-1', sentenceId: '7', start: 0, end: 1, text: '测试。', final: true,
    });
    unsubscribe();
    expect(ipcRenderer.off).toHaveBeenCalledWith('desktop:meeting:live:update', expect.any(Function));
  });

  it('normalizes meeting transcriber options from renderer input', () => {
    expect(parseMeetingTranscriberOptions({
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: ' zh ',
    })).toEqual({
      engine: 'sherpa-onnx-paraformer',
      model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
      language: 'zh',
    });

    expect(parseMeetingTranscriberOptions({
      model: ' small ',
      language: ' zh ',
    })).toEqual({
      engine: 'whisper',
      model: 'small',
      language: 'zh',
    });

    expect(parseMeetingTranscriberOptions({
      engine: 'volcengine-asr',
      language: ' zh ',
    })).toEqual({
      engine: 'volcengine-asr',
      language: 'zh',
    });

    expect(parseMeetingTranscriberOptions({
      engine: 'aliyun-asr',
      language: 'auto',
    })).toEqual({
      engine: 'aliyun-asr',
    });

    expect(parseMeetingTranscriberOptions({
      engine: 'unknown-engine',
      model: 'unknown-model',
      language: 'auto',
    })).toEqual({ engine: 'sherpa-onnx-paraformer' });
  });
});
