import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { KnowledgePage } from '../../renderer/src/components/KnowledgePage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { en } from '../../renderer/src/locales/en';
import { zh } from '../../renderer/src/locales/zh';

const mocks = vi.hoisted(() => ({
  kbListCollections: vi.fn(),
  kbListSources: vi.fn(),
  kbGetSourceContent: vi.fn(),
  meetingPickAudioFile: vi.fn(),
  meetingRequestMicrophonePermission: vi.fn(),
  meetingGetAsrConfig: vi.fn(),
  meetingSaveAsrConfig: vi.fn(),
  meetingListModels: vi.fn(),
  meetingDownloadModel: vi.fn(),
  meetingUninstallModel: vi.fn(),
  meetingSaveRecordedAudio: vi.fn(),
  meetingTranscribePreview: vi.fn(),
  meetingStartLiveTranscription: vi.fn(),
  meetingPushLiveTranscriptionAudio: vi.fn(),
  meetingFinishLiveTranscription: vi.fn(),
  meetingCancelLiveTranscription: vi.fn(),
  onMeetingLiveTranscriptionUpdate: vi.fn(),
  meetingDraftRecording: vi.fn(),
  meetingProcessRecording: vi.fn(),
  meetingSaveTranscript: vi.fn(),
  meetingOpenRecorderWindow: vi.fn(),
  meetingSetRecorderWindowMode: vi.fn(),
  meetingSetRecorderSessionState: vi.fn(),
  meetingNotifyRecorderSummaryReady: vi.fn(),
  meetingNotifyRecordingSaved: vi.fn(),
  meetingCloseRecorderWindow: vi.fn(),
  onMeetingRecorderCloseRequested: vi.fn(),
  onMeetingRecordingSaved: vi.fn(),
  getUserMedia: vi.fn(),
}));

const desktopApi = vi.hoisted(() => ({
  kbListCollections: mocks.kbListCollections,
  kbListSources: mocks.kbListSources,
  kbGetSourceContent: mocks.kbGetSourceContent,
  meetingPickAudioFile: mocks.meetingPickAudioFile,
  meetingRequestMicrophonePermission: mocks.meetingRequestMicrophonePermission,
  meetingGetAsrConfig: mocks.meetingGetAsrConfig,
  meetingSaveAsrConfig: mocks.meetingSaveAsrConfig,
  meetingListModels: mocks.meetingListModels,
  meetingDownloadModel: mocks.meetingDownloadModel,
  meetingUninstallModel: mocks.meetingUninstallModel,
  meetingSaveRecordedAudio: mocks.meetingSaveRecordedAudio,
  meetingTranscribePreview: mocks.meetingTranscribePreview,
  meetingStartLiveTranscription: mocks.meetingStartLiveTranscription,
  meetingPushLiveTranscriptionAudio: mocks.meetingPushLiveTranscriptionAudio,
  meetingFinishLiveTranscription: mocks.meetingFinishLiveTranscription,
  meetingCancelLiveTranscription: mocks.meetingCancelLiveTranscription,
  onMeetingLiveTranscriptionUpdate: mocks.onMeetingLiveTranscriptionUpdate,
  meetingDraftRecording: mocks.meetingDraftRecording,
  meetingProcessRecording: mocks.meetingProcessRecording,
  meetingSaveTranscript: mocks.meetingSaveTranscript,
  meetingOpenRecorderWindow: mocks.meetingOpenRecorderWindow,
  meetingSetRecorderWindowMode: mocks.meetingSetRecorderWindowMode,
  meetingSetRecorderSessionState: mocks.meetingSetRecorderSessionState,
  meetingNotifyRecorderSummaryReady: mocks.meetingNotifyRecorderSummaryReady,
  meetingNotifyRecordingSaved: mocks.meetingNotifyRecordingSaved,
  meetingCloseRecorderWindow: mocks.meetingCloseRecorderWindow,
  onMeetingRecorderCloseRequested: mocks.onMeetingRecorderCloseRequested,
  onMeetingRecordingSaved: mocks.onMeetingRecordingSaved,
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => desktopApi,
}));

function renderKnowledge(initialEntry = '/knowledge/col-1') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocaleProvider>
        <Routes>
          <Route path="/knowledge/:collectionId" element={<KnowledgePage />} />
          <Route path="/meeting-recorder/:collectionId" element={<KnowledgePage />} />
        </Routes>
      </LocaleProvider>
    </MemoryRouter>,
  );
}

type FakeAudioProcessEvent = {
  inputBuffer: {
    getChannelData: (channel: number) => Float32Array;
  };
};

let activeProcessor: {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onaudioprocess: ((event: FakeAudioProcessEvent) => void) | null;
} | null = null;
let activeAnalyser: {
  fftSize: number;
  smoothingTimeConstant: number;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getFloatTimeDomainData: (array: Float32Array) => void;
  setSamples: (samples: Float32Array) => void;
} | null = null;

let stopTrack: ReturnType<typeof vi.fn>;
let originalMediaDevices: typeof navigator.mediaDevices | undefined;
let originalAudioContext: typeof window.AudioContext | undefined;
let liveTranscriptionUpdate: ((input: { sessionId: string; sentenceId: string; start: number; end: number; text: string; final: boolean }) => void) | null = null;

class FakeAudioContext {
  static constructorOptions: AudioContextOptions[] = [];
  sampleRate = 16000;
  constructor(options?: AudioContextOptions) {
    FakeAudioContext.constructorOptions.push(options ?? {});
  }
  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createAnalyser = vi.fn(() => {
    let samples = new Float32Array(128);
    activeAnalyser = {
      fftSize: 128,
      smoothingTimeConstant: 0,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getFloatTimeDomainData: (array: Float32Array) => {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = samples[index % samples.length] ?? 0;
        }
      },
      setSamples: (nextSamples: Float32Array) => {
        samples = nextSamples;
      },
    };
    return activeAnalyser;
  });
  createScriptProcessor = vi.fn(() => {
    activeProcessor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    };
    return activeProcessor;
  });
  createGain = vi.fn(() => ({
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  close = vi.fn().mockResolvedValue(undefined);
}

describe('Knowledge meeting entry', () => {
  beforeEach(() => {
    activeProcessor = null;
    activeAnalyser = null;
    FakeAudioContext.constructorOptions = [];
    liveTranscriptionUpdate = null;
    stopTrack = vi.fn();
    localStorage.removeItem('meeting-transcriber-engine');
    localStorage.removeItem('meeting-transcriber-model');
    localStorage.removeItem('meeting-transcriber-language');
    originalMediaDevices = navigator.mediaDevices;
    originalAudioContext = window.AudioContext;
    mocks.kbListCollections.mockResolvedValue([
      {
        id: 'col-1',
        name: '会议',
        description: '',
        color: '',
        chunkCountCached: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mocks.kbListSources.mockResolvedValue([]);
    mocks.kbGetSourceContent.mockResolvedValue({
      source: {
        id: 'source-recorded',
        collectionId: 'col-1',
        kind: 'meeting',
        title: 'Weekly Sync',
        parseStatus: 'parsed',
        chunkCount: 2,
      },
      text: '## 会议纪要\n\nAlice will ship the demo.\n\n## 逐字转写\n\nAlice will ship the demo.',
      hasMore: false,
      totalChars: 82,
    });
    mocks.meetingPickAudioFile.mockResolvedValue('/tmp/weekly-sync.wav');
    mocks.meetingRequestMicrophonePermission.mockResolvedValue({ status: 'granted' });
    mocks.meetingGetAsrConfig.mockResolvedValue({
      defaultProvider: 'sherpa-onnx-paraformer',
      volcengine: {
        configured: true,
        appKeyConfigured: true,
        accessKeyConfigured: true,
        endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
        resourceId: 'volc.seedasr.sauc.duration',
      },
      aliyun: {
        configured: true,
        apiKeyConfigured: true,
        baseUrl: 'https://workspace.example.test',
        model: 'fun-asr',
      },
    });
    mocks.meetingSaveAsrConfig.mockResolvedValue({
      defaultProvider: 'volcengine-asr',
      volcengine: {
        configured: true,
        appKeyConfigured: true,
        accessKeyConfigured: true,
      },
      aliyun: {
        configured: false,
        apiKeyConfigured: false,
        baseUrl: 'https://dashscope.aliyuncs.com',
        model: 'fun-asr',
      },
    });
    mocks.meetingListModels.mockResolvedValue([
      {
        id: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
        capability: 'asr',
        engineId: 'sherpa-onnx-paraformer',
        fileName: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
        sizeBytes: 77_920_048,
        sizeLabel: '78 MB',
        downloaded: false,
        status: 'not_downloaded',
      },
      {
        id: 'base',
        capability: 'asr',
        engineId: 'whisper',
        fileName: 'base.pt',
        sizeBytes: 145_262_807,
        sizeLabel: '145 MB',
        downloaded: true,
        status: 'downloaded',
        localSizeBytes: 145_262_807,
        localSizeLabel: '145 MB',
      },
      {
        id: 'small',
        capability: 'asr',
        engineId: 'whisper',
        fileName: 'small.pt',
        sizeBytes: 483_617_219,
        sizeLabel: '484 MB',
        downloaded: false,
        status: 'not_downloaded',
      },
      {
        id: 'medium',
        capability: 'asr',
        engineId: 'whisper',
        fileName: 'medium.pt',
        sizeBytes: 1_528_008_539,
        sizeLabel: '1.5 GB',
        downloaded: false,
        status: 'incomplete',
        localSizeBytes: 66_142_208,
        localSizeLabel: '66 MB',
      },
      {
        id: 'large',
        capability: 'asr',
        engineId: 'whisper',
        fileName: 'large.pt',
        sizeBytes: 3_094_000_000,
        sizeLabel: '3.1 GB',
        downloaded: false,
        status: 'corrupt',
        localSizeBytes: 3_094_000_000,
        localSizeLabel: '3.1 GB',
      },
      {
        id: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-int8',
        capability: 'punctuation',
        engineId: 'sherpa-onnx-punctuation',
        fileName: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
        sizeBytes: 64_717_756,
        sizeLabel: '65 MB',
        downloaded: false,
        status: 'not_downloaded',
      },
    ]);
    mocks.meetingDownloadModel.mockResolvedValue({ ok: true });
    mocks.meetingUninstallModel.mockResolvedValue({ ok: true });
    mocks.meetingSaveRecordedAudio.mockResolvedValue({
      ok: true,
      filePath: '/tmp/recorded-meeting.wav',
    });
    mocks.meetingTranscribePreview.mockResolvedValue({
      ok: true,
      text: 'Alice 正在说明需求。',
      segments: [{ start: 0, end: 1, text: 'Alice 正在说明需求。' }],
    });
    mocks.meetingStartLiveTranscription.mockResolvedValue({ ok: true, sessionId: 'live-1' });
    mocks.meetingPushLiveTranscriptionAudio.mockResolvedValue({ ok: true });
    mocks.meetingFinishLiveTranscription.mockResolvedValue({ ok: true });
    mocks.meetingCancelLiveTranscription.mockResolvedValue({ ok: true });
    mocks.onMeetingLiveTranscriptionUpdate.mockImplementation((handler) => {
      liveTranscriptionUpdate = handler;
      return () => { liveTranscriptionUpdate = null; };
    });
    mocks.meetingDraftRecording.mockResolvedValue({
      ok: true,
      suggestedTitle: '需求同步 - 07/09 21:00',
      transcript: 'Alice 正在说明需求。\nBob 记录行动项。',
      segments: [
        { start: 0, end: 1, text: 'Alice 正在说明需求。' },
        { start: 1, end: 2, text: 'Bob 记录行动项。' },
      ],
      summaryMarkdown: '## 会议纪要\n\n### 待办\n- Alice 会继续跟进。\n',
    });
    mocks.meetingProcessRecording.mockResolvedValue({
      ok: true,
      source: { id: 'source-recorded', title: 'Weekly Sync' },
    });
    mocks.meetingSaveTranscript.mockResolvedValue({
      ok: true,
      source: { id: 'source-1', title: 'Weekly Sync' },
    });
    mocks.meetingOpenRecorderWindow.mockResolvedValue({ ok: true });
    mocks.meetingSetRecorderWindowMode.mockResolvedValue({ ok: true });
    mocks.meetingSetRecorderSessionState.mockResolvedValue({ ok: true });
    mocks.meetingNotifyRecorderSummaryReady.mockResolvedValue({ ok: true });
    mocks.meetingNotifyRecordingSaved.mockResolvedValue({ ok: true });
    mocks.meetingCloseRecorderWindow.mockResolvedValue({ ok: true });
    mocks.onMeetingRecorderCloseRequested.mockReturnValue(() => undefined);
    mocks.onMeetingRecordingSaved.mockReturnValue(() => undefined);
    mocks.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }],
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: originalAudioContext,
    });
    vi.clearAllMocks();
  });

  it('opens a meeting import form and saves transcript through the desktop API', async () => {
    renderKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: '会议记录' }));
    const dialog = screen.getByRole('dialog', { name: '导入会议记录' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '开始录音' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('会议标题'), { target: { value: 'Weekly Sync' } });
    fireEvent.click(screen.getByRole('button', { name: '选择 WAV' }));

    await waitFor(() => {
      expect(mocks.meetingPickAudioFile).toHaveBeenCalled();
    });
    expect(screen.getByText('/tmp/weekly-sync.wav')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('转写文本'), {
      target: { value: 'Alice will ship the demo.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));

    await waitFor(() => {
      expect(mocks.meetingSaveTranscript).toHaveBeenCalledWith({
        collectionId: 'col-1',
        title: 'Weekly Sync',
        audioFilePath: '/tmp/weekly-sync.wav',
        transcript: 'Alice will ship the demo.',
      });
    });
  });

  it('opens AI recording in a dedicated recorder window instead of an in-page dialog', async () => {
    renderKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: 'AI录音' }));

    await waitFor(() => {
      expect(mocks.meetingOpenRecorderWindow).toHaveBeenCalledWith({ collectionId: 'col-1' });
    });
    expect(screen.queryByRole('dialog', { name: 'AI录音' })).not.toBeInTheDocument();
    expect(mocks.meetingRequestMicrophonePermission).not.toHaveBeenCalled();
  });

  it('uses configured online ASR engine from saved recording settings without recorder settings UI', async () => {
    localStorage.setItem('meeting-transcriber-engine', 'volcengine-asr');
    localStorage.setItem('meeting-transcriber-language', 'zh');
    renderKnowledge('/meeting-recorder/col-1');

    const panel = await screen.findByRole('main', { name: 'AI录音' });
    expect(within(panel).queryByRole('button', { name: '转写设置' })).not.toBeInTheDocument();
    expect(within(panel).queryByText('模型下载状态')).not.toBeInTheDocument();
    expect(within(panel).queryByText('线上 ASR 配置')).not.toBeInTheDocument();
    expect(within(panel).getByText('火山引擎 ASR / 中文')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '开始录音' }));
    await waitFor(() => {
      expect(mocks.meetingStartLiveTranscription).toHaveBeenCalledWith({
        engine: 'volcengine-asr',
        sampleRate: 16_000,
        language: 'zh',
      });
    });
    expect(FakeAudioContext.constructorOptions.at(-1)).toEqual({ sampleRate: 16_000 });
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array(16_000).fill(0.1),
      },
    });
    liveTranscriptionUpdate?.({
      sessionId: 'live-1', sentenceId: '120', start: 0.12, end: 1.32, text: '今天讨论销售方案。', final: true,
    });
    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(mocks.meetingDraftRecording).toHaveBeenCalledWith(expect.objectContaining({
        audioFilePath: '/tmp/recorded-meeting.wav',
        engine: 'volcengine-asr',
        language: 'zh',
        transcript: '今天讨论销售方案。',
        segments: [{ start: 0.12, end: 1.32, text: '今天讨论销售方案。' }],
      }));
    });
    expect(mocks.meetingDraftRecording.mock.calls[0][0]).not.toHaveProperty('model');
  });

  it('keeps the WAV and does not run legacy batch ASR when Volcengine returns no live text', async () => {
    localStorage.setItem('meeting-transcriber-engine', 'volcengine-asr');
    localStorage.setItem('meeting-transcriber-language', 'zh');
    renderKnowledge('/meeting-recorder/col-1');

    const panel = await screen.findByRole('main', { name: 'AI录音' });
    fireEvent.click(within(panel).getByRole('button', { name: '开始录音' }));
    await waitFor(() => expect(mocks.meetingStartLiveTranscription).toHaveBeenCalled());
    activeProcessor?.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(16_000).fill(0.1) },
    });
    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalled();
      expect(within(panel).getByText('转写失败：empty_transcription')).toBeInTheDocument();
    });
    expect(mocks.meetingDraftRecording).not.toHaveBeenCalled();
  });

  it('streams real microphone PCM to Aliyun, upserts live text, pauses transport, and finishes before final draft', async () => {
    localStorage.setItem('meeting-transcriber-engine', 'aliyun-asr');
    localStorage.setItem('meeting-transcriber-language', 'zh');
    renderKnowledge('/meeting-recorder/col-1');

    const panel = await screen.findByRole('main', { name: 'AI录音' });
    fireEvent.click(within(panel).getByRole('button', { name: '开始录音' }));
    await waitFor(() => {
      expect(mocks.meetingStartLiveTranscription).toHaveBeenCalledWith({ engine: 'aliyun-asr', sampleRate: 16_000, language: 'zh' });
    });

    activeProcessor?.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([1, -1, 0.5, 0]) },
    });
    await waitFor(() => expect(mocks.meetingPushLiveTranscriptionAudio).toHaveBeenCalled());
    const firstChunk = mocks.meetingPushLiveTranscriptionAudio.mock.calls[0][0];
    expect(firstChunk.sessionId).toBe('live-1');
    const pcm = Buffer.from(firstChunk.pcmBase64, 'base64');
    expect([...new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)]).toEqual([32767, -32768, 16383, 0]);

    liveTranscriptionUpdate?.({ sessionId: 'live-1', sentenceId: '9', start: 0, end: 0.8, text: '今天讨论', final: false });
    liveTranscriptionUpdate?.({ sessionId: 'live-1', sentenceId: '9', start: 0, end: 1.2, text: '今天讨论销售方案。', final: true });
    expect(await within(panel).findAllByText('今天讨论销售方案。')).toHaveLength(2);
    expect(within(panel).queryByText('今天讨论')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '暂停' }));
    const pushedBeforePause = mocks.meetingPushLiveTranscriptionAudio.mock.calls.length;
    activeProcessor?.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0.25, 0.25]) },
    });
    expect(mocks.meetingPushLiveTranscriptionAudio).toHaveBeenCalledTimes(pushedBeforePause);

    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(mocks.meetingFinishLiveTranscription).toHaveBeenCalledWith({ sessionId: 'live-1' }));
    await waitFor(() => expect(mocks.meetingDraftRecording).toHaveBeenCalled());
    expect(mocks.meetingDraftRecording.mock.calls.at(-1)?.[0]).not.toHaveProperty('transcript');
  });

  it('opens AI recording idle, streams transcript after explicit start, then saves an editable summary draft', async () => {
    localStorage.setItem('meeting-transcriber-engine', 'whisper');
    localStorage.setItem('meeting-transcriber-model', 'small');
    localStorage.setItem('meeting-transcriber-language', 'zh');
    renderKnowledge('/meeting-recorder/col-1');

    const panel = await screen.findByRole('main', { name: 'AI录音' });
    expect(panel).toBeInTheDocument();
    expect((within(panel).getByLabelText('录音标题') as HTMLInputElement).value).toMatch(/^录音 - \d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(within(panel).queryByText('未选择音频文件')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('会议标题')).not.toBeInTheDocument();
    expect(within(panel).queryByText('录音控制')).not.toBeInTheDocument();
    expect(within(panel).getByText('Whisper fallback / 中文')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '开始录音' })).toBeInTheDocument();
    expect(mocks.meetingRequestMicrophonePermission).not.toHaveBeenCalled();
    expect(mocks.getUserMedia).not.toHaveBeenCalled();

    fireEvent.change(within(panel).getByLabelText('录音场景'), { target: { value: 'sales' } });
    fireEvent.click(within(panel).getByRole('button', { name: '开始录音' }));
    await screen.findByRole('button', { name: '完成' });
    expect(within(panel).getByText('文字记录')).toBeInTheDocument();
    expect(within(panel).getByText('实时要点')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(mocks.meetingRequestMicrophonePermission).toHaveBeenCalled();
    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(activeProcessor?.onaudioprocess).toBeTypeOf('function');
    expect(within(panel).queryByRole('button', { name: '开始录音' })).not.toBeInTheDocument();
    const audioLevelMeter = within(panel).getByLabelText('音频波动');
    expect(Array.from(audioLevelMeter.querySelectorAll('[data-audio-level]')).every(bar => Number(bar.getAttribute('data-audio-level')) === 0)).toBe(true);

    fireEvent.change(within(panel).getByLabelText('录音标题'), { target: { value: 'Weekly Sync' } });
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
      },
    });
    expect(Array.from(audioLevelMeter.querySelectorAll('[data-audio-level]')).every(bar => Number(bar.getAttribute('data-audio-level')) === 0)).toBe(true);
    activeAnalyser?.setSamples(new Float32Array([0, 0.5, -0.5, 1]));
    await waitFor(() => {
      expect(Array.from(audioLevelMeter.querySelectorAll('[data-audio-level]')).some(bar => Number(bar.getAttribute('data-audio-level')) > 0)).toBe(true);
    });
    expect(mocks.meetingTranscribePreview).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole('button', { name: '缩小为悬浮窗' }));
    await waitFor(() => {
      expect(mocks.meetingSetRecorderWindowMode).toHaveBeenCalledWith({ mode: 'compact' });
    });
    const compactSurface = screen.getByRole('main', { name: 'AI录音' });
    const expandButton = within(compactSurface).getByRole('button', { name: '展开录音窗口' });
    const pauseButton = within(compactSurface).getByRole('button', { name: '暂停' });
    const finishButton = within(compactSurface).getByRole('button', { name: '完成' });
    expect(compactSurface).toHaveAttribute('data-app-region', 'drag');
    expect(expandButton).toHaveAttribute('data-app-region', 'no-drag');
    expect(pauseButton).toHaveAttribute('data-app-region', 'no-drag');
    expect(finishButton).toHaveAttribute('data-app-region', 'no-drag');
    expect(within(compactSurface).getByTestId('meeting-compact-waveform')).toHaveClass('mt-1');
    expect(within(compactSurface).getByTestId('meeting-compact-waveform')).not.toHaveClass('mt-auto');
    expect(within(compactSurface).getByRole('meter', { name: '音频波动' })).toHaveClass('h-6');
    expect(within(compactSurface).getByTestId('meeting-compact-controls')).toHaveStyle({ marginTop: '4px' });
    expect(within(compactSurface).getByText('00:00')).toBeInTheDocument();
    fireEvent.click(expandButton);
    await waitFor(() => {
      expect(mocks.meetingSetRecorderWindowMode).toHaveBeenCalledWith({ mode: 'workbench' });
    });
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.25, 0.25]),
      },
    });
    expect(mocks.meetingTranscribePreview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.75, 0.5]),
      },
    });
    expect(mocks.meetingTranscribePreview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(within(panel).getByText('正在生成录音总结')).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalledWith({
        title: 'Weekly Sync',
        wavBase64: expect.any(String),
      });
    });
    const wavBase64 = mocks.meetingSaveRecordedAudio.mock.calls[0][0].wavBase64 as string;
    const wavBytes = Uint8Array.from(atob(wavBase64), char => char.charCodeAt(0));
    expect(String.fromCharCode(...wavBytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wavBytes.slice(8, 12))).toBe('WAVE');
    expect(stopTrack).toHaveBeenCalled();

    await waitFor(() => {
      expect(mocks.meetingDraftRecording).toHaveBeenCalledWith({
        title: 'Weekly Sync',
        audioFilePath: '/tmp/recorded-meeting.wav',
        engine: 'whisper',
        model: 'small',
        language: 'zh',
        scenario: 'sales',
      });
    });
    expect(mocks.meetingProcessRecording).not.toHaveBeenCalled();
    expect(mocks.meetingSaveTranscript).not.toHaveBeenCalled();
    const summaryView = await screen.findByRole('main', { name: 'AI录音' });
    expect(await within(summaryView).findByRole('tab', { name: '总结' })).toHaveAttribute('aria-selected', 'true');
    expect(within(summaryView).queryByLabelText('总结内容')).not.toBeInTheDocument();
    expect(within(summaryView).getByText('会议纪要')).toBeInTheDocument();
    fireEvent.click(within(summaryView).getByRole('button', { name: '编辑总结' }));
    const summaryEditor = await within(summaryView).findByLabelText('总结内容');
    expect(summaryEditor).toHaveValue('## 会议纪要\n\n### 待办\n- Alice 会继续跟进。\n');
    expect(within(summaryView).getByLabelText('录音标题')).toHaveValue('需求同步 - 07/09 21:00');
    expect(mocks.meetingNotifyRecorderSummaryReady).toHaveBeenCalledWith({ title: '需求同步 - 07/09 21:00' });
    fireEvent.change(summaryEditor, {
      target: { value: '## 会议纪要\n\n已编辑总结。\n' },
    });
    fireEvent.click(within(summaryView).getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => {
      expect(mocks.meetingSaveTranscript).toHaveBeenCalledWith({
        collectionId: 'col-1',
        title: '需求同步 - 07/09 21:00',
        audioFilePath: '/tmp/recorded-meeting.wav',
        transcript: '## 会议纪要\n\n已编辑总结。\n\n## 逐字转写\n\nAlice 正在说明需求。\nBob 记录行动项。',
      });
    });
    await waitFor(() => {
      expect(mocks.meetingNotifyRecordingSaved).toHaveBeenCalledWith({ collectionId: 'col-1' });
      expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalled();
    });
  });

  it('starts sherpa-onnx recording preview shortly after recording begins', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.meetingTranscribePreview.mockResolvedValueOnce({
      ok: true,
      text: '张三负责跟进客户需求。',
      segments: [{ start: 0, end: 2, text: '张三负责跟进客户需求。' }],
    });
    renderKnowledge('/meeting-recorder/col-1');

    const panel = await screen.findByRole('main', { name: 'AI录音' });
    fireEvent.click(within(panel).getByRole('button', { name: '开始录音' }));
    await screen.findByRole('button', { name: '完成' });
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array(16_000).fill(0.1),
      },
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await waitFor(() => {
      expect(mocks.meetingTranscribePreview).toHaveBeenCalledWith({
        title: expect.stringMatching(/^录音 - \d{2}\/\d{2} \d{2}:\d{2}$/),
        wavBase64: expect.any(String),
        engine: 'sherpa-onnx-paraformer',
        model: 'sherpa-onnx-paraformer-zh-small-2024-03-09',
        language: 'zh',
      });
    });
    expect(within(panel).getAllByText('张三负责跟进客户需求。')).toHaveLength(2);
    expect(mocks.meetingDraftRecording).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));
    await waitFor(() => {
      expect(mocks.meetingDraftRecording).toHaveBeenCalled();
    });
    const draftInput = mocks.meetingDraftRecording.mock.calls[0][0] as Record<string, unknown>;
    expect(draftInput).not.toHaveProperty('transcript');
    expect(draftInput).not.toHaveProperty('segments');
  });

  it('opens generated meeting transcript content from the source list', async () => {
    mocks.kbListSources.mockResolvedValue([
      {
        id: 'source-recorded',
        collectionId: 'col-1',
        kind: 'meeting',
        title: 'Weekly Sync',
        parseStatus: 'parsed',
        chunkCount: 2,
      },
    ]);

    renderKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: '打开 Weekly Sync' }));

    await waitFor(() => {
      expect(mocks.kbGetSourceContent).toHaveBeenCalledWith({
        sourceId: 'source-recorded',
        offset: 0,
        limit: 64000,
      });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Weekly Sync' });
    expect(dialog).toHaveTextContent('## 会议纪要');
    expect(dialog).toHaveTextContent('Alice will ship the demo.');
    expect(dialog).toHaveTextContent('## 逐字转写');
  });

  it('shows a friendly model download certificate error', () => {
    expect(zh.knowledge.meetingProcessError('whisper_model_download_ssl_failed')).toContain('证书');
    expect(en.knowledge.meetingProcessError('whisper_model_download_ssl_failed')).toContain('certificate');
    expect(zh.knowledge.meetingProcessError('whisper_model_incomplete')).toContain('重新下载');
    expect(zh.knowledge.meetingProcessError('whisper_model_not_downloaded')).toContain('下载');
    expect(en.knowledge.meetingProcessError('whisper_model_incomplete').toLowerCase()).toContain('download');
    expect(en.knowledge.meetingProcessError('whisper_model_not_downloaded').toLowerCase()).toContain('download');
  });
});
