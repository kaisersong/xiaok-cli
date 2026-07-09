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
  meetingListModels: vi.fn(),
  meetingDownloadModel: vi.fn(),
  meetingUninstallModel: vi.fn(),
  meetingSaveRecordedAudio: vi.fn(),
  meetingTranscribePreview: vi.fn(),
  meetingDraftRecording: vi.fn(),
  meetingProcessRecording: vi.fn(),
  meetingSaveTranscript: vi.fn(),
  getUserMedia: vi.fn(),
}));

const desktopApi = vi.hoisted(() => ({
  kbListCollections: mocks.kbListCollections,
  kbListSources: mocks.kbListSources,
  kbGetSourceContent: mocks.kbGetSourceContent,
  meetingPickAudioFile: mocks.meetingPickAudioFile,
  meetingRequestMicrophonePermission: mocks.meetingRequestMicrophonePermission,
  meetingListModels: mocks.meetingListModels,
  meetingDownloadModel: mocks.meetingDownloadModel,
  meetingUninstallModel: mocks.meetingUninstallModel,
  meetingSaveRecordedAudio: mocks.meetingSaveRecordedAudio,
  meetingTranscribePreview: mocks.meetingTranscribePreview,
  meetingDraftRecording: mocks.meetingDraftRecording,
  meetingProcessRecording: mocks.meetingProcessRecording,
  meetingSaveTranscript: mocks.meetingSaveTranscript,
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => desktopApi,
}));

function renderKnowledge() {
  render(
    <MemoryRouter initialEntries={['/knowledge/col-1']}>
      <LocaleProvider>
        <Routes>
          <Route path="/knowledge/:collectionId" element={<KnowledgePage />} />
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

class FakeAudioContext {
  sampleRate = 16000;
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
    stopTrack = vi.fn();
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
    mocks.meetingListModels.mockResolvedValue([
      {
        id: 'base',
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
        fileName: 'small.pt',
        sizeBytes: 483_617_219,
        sizeLabel: '484 MB',
        downloaded: false,
        status: 'not_downloaded',
      },
      {
        id: 'medium',
        fileName: 'medium.pt',
        sizeBytes: 1_528_008_539,
        sizeLabel: '1.5 GB',
        downloaded: false,
        status: 'incomplete',
        localSizeBytes: 66_142_208,
        localSizeLabel: '66 MB',
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

  it('opens AI recording idle, streams transcript after explicit start, then saves an editable summary draft', async () => {
    renderKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: 'AI录音' }));
    const dialog = screen.getByRole('dialog', { name: 'AI录音' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('w-[920px]');
    expect((within(dialog).getByLabelText('录音标题') as HTMLInputElement).value).toMatch(/^录音 - \d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(within(dialog).queryByText('未选择音频文件')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('会议标题')).not.toBeInTheDocument();
    expect(within(dialog).getByText('录音控制')).toBeInTheDocument();
    expect(within(dialog).getByText('实时转写')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '开始录音' })).toBeInTheDocument();
    expect(mocks.meetingRequestMicrophonePermission).not.toHaveBeenCalled();
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    expect(within(dialog).queryByLabelText('本地语音模型')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('识别语言')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '转写设置' }));
    expect(within(dialog).getByLabelText('本地语音模型')).toHaveValue('base');
    expect(within(dialog).getByLabelText('识别语言')).toHaveValue('zh');
    await waitFor(() => {
      expect(mocks.meetingListModels).toHaveBeenCalled();
    });
    expect(within(dialog).getByText('模型下载状态')).toBeInTheDocument();
    expect(within(dialog).getByText('base.pt')).toBeInTheDocument();
    expect(within(dialog).getByText('145 MB')).toBeInTheDocument();
    expect(within(dialog).getByText('已下载')).toBeInTheDocument();
    expect(within(dialog).getByText('small.pt')).toBeInTheDocument();
    expect(within(dialog).getByText('484 MB')).toBeInTheDocument();
    expect(within(dialog).getByText('未下载')).toBeInTheDocument();
    expect(within(dialog).getByText('medium.pt')).toBeInTheDocument();
    expect(within(dialog).getByText('1.5 GB')).toBeInTheDocument();
    expect(within(dialog).getByText('不完整')).toBeInTheDocument();
    expect(within(dialog).getByText('本地 66 MB / 1.5 GB')).toBeInTheDocument();
    const downloadSmall = within(dialog).getByRole('button', { name: '下载 small.pt' });
    const redownloadMedium = within(dialog).getByRole('button', { name: '重新下载 medium.pt' });
    const uninstallBase = within(dialog).getByRole('button', { name: '卸载 base.pt' });
    expect(downloadSmall.textContent).toBe('');
    expect(redownloadMedium.textContent).toBe('');
    expect(uninstallBase.textContent).toBe('');
    expect(downloadSmall.closest('[data-meeting-model-status-row="small"]')).toContainElement(within(dialog).getByText('未下载'));
    expect(redownloadMedium.closest('[data-meeting-model-status-row="medium"]')).toContainElement(within(dialog).getByText('不完整'));
    expect(uninstallBase.closest('[data-meeting-model-status-row="base"]')).toContainElement(within(dialog).getByText('已下载'));
    fireEvent.click(downloadSmall);
    await waitFor(() => {
      expect(mocks.meetingDownloadModel).toHaveBeenCalledWith('small');
    });
    fireEvent.click(redownloadMedium);
    await waitFor(() => {
      expect(mocks.meetingDownloadModel).toHaveBeenCalledWith('medium');
    });
    fireEvent.click(uninstallBase);
    await waitFor(() => {
      expect(mocks.meetingUninstallModel).toHaveBeenCalledWith('base');
    });
    fireEvent.change(screen.getByLabelText('本地语音模型'), { target: { value: 'small' } });

    fireEvent.click(within(dialog).getByRole('button', { name: '开始录音' }));
    await screen.findByRole('button', { name: '完成' });
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(mocks.meetingRequestMicrophonePermission).toHaveBeenCalled();
    expect(mocks.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(activeProcessor?.onaudioprocess).toBeTypeOf('function');
    expect(within(dialog).queryByRole('button', { name: '开始录音' })).not.toBeInTheDocument();
    const audioLevelMeter = within(dialog).getByLabelText('音频波动');
    expect(Array.from(audioLevelMeter.querySelectorAll('[data-audio-level]')).every(bar => Number(bar.getAttribute('data-audio-level')) === 0)).toBe(true);

    fireEvent.change(screen.getByLabelText('录音标题'), { target: { value: 'Weekly Sync' } });
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
    await waitFor(() => {
      expect(mocks.meetingTranscribePreview).toHaveBeenCalledTimes(1);
    });
    expect(mocks.meetingTranscribePreview).toHaveBeenLastCalledWith({
      title: 'Weekly Sync',
      wavBase64: expect.any(String),
      model: 'small',
      language: 'zh',
    });
    expect(within(dialog).getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('Alice 正在说明需求。')).toBeInTheDocument();
    expect(screen.getByText('Alice 正在说明需求。').closest('[data-transcript-line="active"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.25, 0.25]),
      },
    });
    expect(mocks.meetingTranscribePreview).toHaveBeenCalledTimes(1);

    mocks.meetingTranscribePreview.mockResolvedValueOnce({
      ok: true,
      text: 'Alice 正在说明需求。\nBob 记录行动项。',
      segments: [
        { start: 0, end: 1, text: 'Alice 正在说明需求。' },
        { start: 1, end: 2, text: 'Bob 记录行动项。' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    activeProcessor?.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => new Float32Array([0.75, 0.5]),
      },
    });
    await waitFor(() => {
      expect(mocks.meetingTranscribePreview).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(within(dialog).getByText('Bob 记录行动项。')).toBeInTheDocument();
    });
    expect(within(dialog).getByText('00:01')).toBeInTheDocument();
    expect(screen.getByText('Bob 记录行动项。').closest('[data-transcript-line="active"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));

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
        model: 'small',
        language: 'zh',
      });
    });
    expect(mocks.meetingProcessRecording).not.toHaveBeenCalled();
    expect(mocks.meetingSaveTranscript).not.toHaveBeenCalled();
    const summaryEditor = await within(dialog).findByLabelText('总结内容');
    expect(summaryEditor).toHaveValue('## 会议纪要\n\n### 待办\n- Alice 会继续跟进。\n');
    expect(screen.getByLabelText('录音标题')).toHaveValue('需求同步 - 07/09 21:00');
    fireEvent.change(summaryEditor, {
      target: { value: '## 会议纪要\n\n已编辑总结。\n' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到知识库' }));
    await waitFor(() => {
      expect(mocks.meetingSaveTranscript).toHaveBeenCalledWith({
        collectionId: 'col-1',
        title: '需求同步 - 07/09 21:00',
        audioFilePath: '/tmp/recorded-meeting.wav',
        transcript: '## 会议纪要\n\n已编辑总结。\n\n## 逐字转写\n\nAlice 正在说明需求。\nBob 记录行动项。',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'AI录音' })).not.toBeInTheDocument();
    });
  });

  it('shows an active download status as soon as an incomplete speech model starts downloading', async () => {
    mocks.meetingDownloadModel.mockReturnValueOnce(new Promise(() => undefined));
    renderKnowledge();

    fireEvent.click(await screen.findByRole('button', { name: 'AI录音' }));
    const dialog = screen.getByRole('dialog', { name: 'AI录音' });
    fireEvent.click(within(dialog).getByRole('button', { name: '转写设置' }));
    const redownloadMedium = await within(dialog).findByRole('button', { name: '重新下载 medium.pt' });

    fireEvent.click(redownloadMedium);

    await waitFor(() => {
      expect(mocks.meetingDownloadModel).toHaveBeenCalledWith('medium');
    });
    const statusRow = dialog.querySelector('[data-meeting-model-status-row="medium"]');
    expect(statusRow).toBeTruthy();
    await waitFor(() => {
      expect(within(statusRow as HTMLElement).getByText('下载中…')).toBeInTheDocument();
    });
    expect(within(statusRow as HTMLElement).queryByText('不完整')).not.toBeInTheDocument();
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
