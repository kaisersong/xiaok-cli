import { zh } from '../../renderer/src/locales/zh';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { KnowledgePage } from '../../renderer/src/components/KnowledgePage';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

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
    let samples: Float32Array = new Float32Array(128);
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

describe('Recorder window ACK boundaries', () => {
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


  async function startRecorder() {
    renderKnowledge('/meeting-recorder/col-1');
    const panel = await screen.findByRole('main', { name: 'AI录音' });
    fireEvent.click(within(panel).getByRole('button', { name: '开始录音' }));
    await screen.findByRole('button', { name: '完成' });
    await waitFor(() => expect(mocks.meetingSetRecorderWindowMode).toHaveBeenCalledTimes(2));
    return panel;
  }
  async function summaryRecorder() {
    const panel = await startRecorder();
    activeProcessor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(16_000).fill(0.1) } });
    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));
    const edit = await screen.findByRole('button', { name: '编辑总结' });
    fireEvent.click(edit);
    const editor = await screen.findByLabelText('总结内容');
    fireEvent.change(editor, { target: { value: '用户草稿必须保留' } });
    return editor;
  }
  it('keeps the workbench and real media owner when compact is denied', async () => {
    const panel = await startRecorder();
    mocks.meetingSetRecorderWindowMode.mockResolvedValueOnce({ ok: false });
    fireEvent.click(within(panel).getByRole('button', { name: '缩小为悬浮窗' }));
    await waitFor(() => expect(mocks.meetingSetRecorderWindowMode).toHaveBeenLastCalledWith({ mode: 'compact' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '缩小为悬浮窗' })).toBeInTheDocument());
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/.+/);
  });
  it('keeps the exact editor DOM and summary on denied explicit close', async () => {
    const editor = await summaryRecorder();
    mocks.meetingCloseRecorderWindow.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('总结内容')).toBe(editor));
    expect(editor).toHaveValue('用户草稿必须保留');
  });
  it('does not repeat a durable save when its saved notification is denied', async () => {
    const editor = await summaryRecorder();
    mocks.meetingNotifyRecordingSaved.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingNotifyRecordingSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到知识库' })).not.toBeDisabled());
    expect(mocks.meetingCloseRecorderWindow).not.toHaveBeenCalled();
    expect(screen.getByLabelText('总结内容')).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingNotifyRecordingSaved).toHaveBeenCalledTimes(2));
    expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(1);
  });
  it('does not repeat the save or delivered event after a denied close', async () => {
    const editor = await summaryRecorder();
    mocks.meetingCloseRecorderWindow.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到知识库' })).not.toBeDisabled());
    expect(screen.getByLabelText('总结内容')).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalledTimes(2));
    expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.meetingNotifyRecordingSaved).toHaveBeenCalledTimes(1);
  });
  it('keeps a newer edited draft DOM after the older held save ACK', async () => {
    const editor = await summaryRecorder();
    let release!: (value: { ok: boolean }) => void;
    mocks.meetingSaveTranscript.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: '保存等待期间的新草稿' } });
    release({ ok: true });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到知识库' })).not.toBeDisabled());
    expect(screen.getByLabelText('总结内容')).toBe(editor);
    expect(editor).toHaveValue('保存等待期间的新草稿');
    expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.meetingNotifyRecordingSaved).not.toHaveBeenCalled();
    expect(mocks.meetingCloseRecorderWindow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(2));
    expect(mocks.meetingSaveTranscript.mock.calls[1][0].transcript).toContain('保存等待期间的新草稿');
    await waitFor(() => expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalledTimes(1));
  });

  it('ignores a late compact ACK after actual recording completion produces the summary', async () => {
    const panel = await startRecorder();
    let release!: (reply: { ok: boolean }) => void;
    mocks.meetingSetRecorderWindowMode.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.click(within(panel).getByRole('button', { name: '缩小为悬浮窗' }));
    await waitFor(() => expect(mocks.meetingSetRecorderWindowMode).toHaveBeenLastCalledWith({ mode: 'compact' }));
    activeProcessor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(16_000).fill(0.1) } });
    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));
    await screen.findByRole('button', { name: '保存到知识库' });
    expect(mocks.meetingDraftRecording).toHaveBeenCalledTimes(1);
    await act(async () => { release({ ok: true }); });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存到知识库' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '展开录音窗口' })).not.toBeInTheDocument();
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('keeps the current media owner and visible workbench error when compact rejects', async () => {
    const panel = await startRecorder();
    mocks.meetingSetRecorderWindowMode.mockRejectedValueOnce(Error('owned_failure'));
    fireEvent.click(within(panel).getByRole('button', { name: '缩小为悬浮窗' }));
    await screen.findByText(zh.knowledge.meetingRecorderOperationUnknown);
    expect(screen.getByRole('button', { name: '缩小为悬浮窗' })).toBeInTheDocument();
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    expect(stopTrack).not.toHaveBeenCalled();
  });
  it('keeps the summary DOM on rejected explicit close', async () => {
    const editor = await summaryRecorder();
    mocks.meetingCloseRecorderWindow.mockRejectedValueOnce(Error('owned_failure'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await screen.findByText(zh.knowledge.meetingRecorderOperationUnknown);
    expect(screen.getByLabelText('总结内容')).toBe(editor);
    expect(editor).toHaveValue('用户草稿必须保留');
  });
  it('does not close after a held saved-notification ACK when the user edited a newer draft', async () => {
    const editor = await summaryRecorder();
    let release!: (reply: { ok: boolean }) => void;
    mocks.meetingNotifyRecordingSaved.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingNotifyRecordingSaved).toHaveBeenCalledTimes(1));
    fireEvent.change(editor, { target: { value: '通知等待期间的新草稿' } });
    await act(async () => { release({ ok: true }); });
    expect(mocks.meetingCloseRecorderWindow).not.toHaveBeenCalled();
    expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('总结内容')).toBe(editor);
    expect(editor).toHaveValue('通知等待期间的新草稿');
    expect(screen.getByText(zh.knowledge.meetingRecorderNewDraftUnsaved)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalledTimes(1));
  });

});
