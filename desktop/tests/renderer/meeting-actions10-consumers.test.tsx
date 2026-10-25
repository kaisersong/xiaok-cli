// UNREVIEWED actual KnowledgePage controls; copy to tests/renderer/meeting-actions10-consumers.test.tsx. Original entry fixture reused.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { KnowledgePage } from '../../renderer/src/components/KnowledgePage';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
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

function MeetingTestLocaleSwitch(){const{setLocale}=useLocale();return <button onClick={()=>setLocale('en')}>test-locale</button>;}
function MeetingTestRouteSwitch() {
  const navigate = useNavigate(), location = useLocation();
  return <><button onClick={() => navigate('/meeting-recorder/col-2')}>test-route-collection</button><button onClick={() => navigate('/knowledge/col-2')}>test-route-knowledge</button><button onClick={() => navigate('/meeting-recorder/col-2')}>test-route-recorder</button><output data-testid="test-route-path">{location.pathname}</output></>;
}
function renderKnowledge(initialEntry = '/knowledge/col-1') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocaleProvider><MeetingTestLocaleSwitch/><MeetingTestRouteSwitch/>
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

describe('Knowledge meeting entry', () => {
  beforeEach(() => {
    localStorage.setItem('xiaok:locale','zh');
    for (const mock of Object.values(mocks)) mock.mockReset();
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
    localStorage.removeItem('xiaok:locale');
    vi.useRealTimers();
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

  it('actual picker held request cannot overwrite a fresh unmounted consumer',async()=>{let release!:(value:string)=>void;mocks.meetingPickAudioFile.mockReturnValueOnce(new Promise(r=>{release=r;}));renderKnowledge();fireEvent.click(await screen.findByRole('button',{name:zh.knowledge.meetingImport}));fireEvent.click(screen.getByRole('button',{name:'选择 WAV'}));cleanup();renderKnowledge();fireEvent.click(await screen.findByRole('button',{name:zh.knowledge.meetingImport}));await act(async()=>release('/owned-retired.wav'));expect(screen.queryByText('/owned-retired.wav')).toBeNull();});
  it('actual picker late rejection uses current locale',async()=>{let reject!:(value:unknown)=>void;mocks.meetingPickAudioFile.mockReturnValueOnce(new Promise((_r,j)=>{reject=j;}));renderKnowledge();fireEvent.click(await screen.findByRole('button',{name:zh.knowledge.meetingImport}));fireEvent.click(screen.getByRole('button',{name:'选择 WAV'}));fireEvent.click(screen.getByRole('button',{name:'test-locale'}));await act(async()=>reject(Error('owned-picker-failed')));expect(await screen.findByText(en.knowledge.meetingPickFailed)).toBeInTheDocument();expect(screen.queryByText(zh.knowledge.meetingPickFailed)).toBeNull();});
  it('actual picker repeated same-turn clicks stay singleflight',async()=>{let release!:(value:null)=>void;mocks.meetingPickAudioFile.mockReturnValue(new Promise(r=>{release=r;}));renderKnowledge();fireEvent.click(await screen.findByRole('button',{name:zh.knowledge.meetingImport}));const pick=screen.getByRole('button',{name:'选择 WAV'});act(()=>{pick.dispatchEvent(new MouseEvent('click',{bubbles:true}));pick.dispatchEvent(new MouseEvent('click',{bubbles:true}));});const before=mocks.meetingPickAudioFile.mock.calls.length;await act(async()=>release(null));expect(before).toBe(1);});
  it('actual imported transcript false ACK retains the current form and does not close it',async()=>{mocks.meetingSaveTranscript.mockResolvedValueOnce({ok:false,error:'transcript_required'});renderKnowledge();fireEvent.click(await screen.findByRole('button',{name:zh.knowledge.meetingImport}));fireEvent.click(screen.getByRole('button',{name:'选择 WAV'}));await screen.findByText('/tmp/weekly-sync.wav');const textarea=screen.getByLabelText('转写文本');fireEvent.change(textarea,{target:{value:'owned transcript'}});fireEvent.click(screen.getByRole('button',{name:'保存到知识库'}));expect(await screen.findByText(zh.knowledge.meetingImportError('transcript_required'))).toBeInTheDocument();expect(textarea).toHaveValue('owned transcript');expect(screen.getByRole('dialog',{name:'导入会议记录'})).toBeInTheDocument();});
  async function beginOwnedRecording(){localStorage.setItem('meeting-transcriber-engine','aliyun-asr');localStorage.setItem('meeting-transcriber-language','zh');renderKnowledge('/meeting-recorder/col-1');const panel=await screen.findByRole('main',{name:'AI录音'});fireEvent.click(within(panel).getByRole('button',{name:'开始录音'}));await waitFor(()=>expect(mocks.meetingStartLiveTranscription).toHaveBeenCalledTimes(1));return panel;}
  function ownedAudioChunk(){act(()=>{activeProcessor?.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(16000).fill(0.1)}});});}
  async function driveStage(kind:'start'|'push'|'finish'|'audio'|'draft'){const panel=await beginOwnedRecording();if(kind==='start')return;await waitFor(()=>expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));ownedAudioChunk();if(kind==='push'){await waitFor(()=>expect(mocks.meetingPushLiveTranscriptionAudio).toHaveBeenCalled());return;}fireEvent.click(within(panel).getByRole('button',{name:'完成'}));await waitFor(()=>expect(kind==='finish'?mocks.meetingFinishLiveTranscription:kind==='audio'?mocks.meetingSaveRecordedAudio:mocks.meetingDraftRecording).toHaveBeenCalled());}
  const stageMocks={start:mocks.meetingStartLiveTranscription,push:mocks.meetingPushLiveTranscriptionAudio,finish:mocks.meetingFinishLiveTranscription,audio:mocks.meetingSaveRecordedAudio,draft:mocks.meetingDraftRecording};
  const stageReason={start:'meeting_live_failed',push:'meeting_live_failed',finish:'meeting_live_failed',audio:'invalid_wav',draft:'transcription_failed'};
  function stageError(kind:keyof typeof stageMocks,locale:'zh'|'en'){const t=locale==='zh'?zh:en;return kind==='audio'?t.knowledge.meetingRecordFailed(stageReason[kind]):kind==='draft'?t.knowledge.meetingProcessError(stageReason[kind]):t.knowledge.meetingLiveTranscriptionFailed(stageReason[kind]);}
  it('actual online recording drives start/audio/finish/draft through the full current UI',async()=>{await driveStage('draft');expect(mocks.meetingStartLiveTranscription).toHaveBeenCalledTimes(1);expect(mocks.meetingPushLiveTranscriptionAudio).toHaveBeenCalled();expect(mocks.meetingFinishLiveTranscription).toHaveBeenCalledExactlyOnceWith({sessionId:'live-1'});expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalledTimes(1);expect(mocks.meetingDraftRecording).toHaveBeenCalledTimes(1);expect(mocks.meetingProcessRecording).not.toHaveBeenCalled();});
  it.each(['start','push','finish','audio','draft']as const)('actual %s legitimate false remains visible as a business failure',async kind=>{stageMocks[kind].mockResolvedValueOnce({ok:false,error:stageReason[kind]});await driveStage(kind);expect(await screen.findByText(stageError(kind,'zh'))).toBeInTheDocument();});
  it.each(['start','push','finish','audio','draft']as const)('actual %s transport rejection is handled without an uncaught private error',async kind=>{stageMocks[kind].mockRejectedValueOnce(Error(stageReason[kind]));await driveStage(kind);if(kind==='audio'||kind==='draft')expect(await screen.findByText(zh.knowledge.meetingRecordFailed('unknown'))).toBeInTheDocument();else expect(await screen.findByText(stageError(kind,'zh'))).toBeInTheDocument();});
  it.each(['start','push','finish','audio','draft']as const)('actual %s held failure after locale change uses the current locale',async kind=>{let release!:(value:unknown)=>void;stageMocks[kind].mockReturnValueOnce(new Promise(r=>{release=r;}));await driveStage(kind);fireEvent.click(screen.getByRole('button',{name:'test-locale'}));await act(async()=>release({ok:false,error:stageReason[kind]}));expect(await screen.findByText(stageError(kind,'en'))).toBeInTheDocument();expect(screen.queryByText(stageError(kind,'zh'))).toBeNull();});
  it.each(['start','push','finish','audio','draft']as const)('actual %s held result after unmount does not start successor UI work',async kind=>{let release!:(value:unknown)=>void;stageMocks[kind].mockReturnValueOnce(new Promise(r=>{release=r;}));await driveStage(kind);cleanup();const calls={audio:mocks.meetingSaveRecordedAudio.mock.calls.length,draft:mocks.meetingDraftRecording.mock.calls.length,save:mocks.meetingSaveTranscript.mock.calls.length};await act(async()=>release({ok:false,error:stageReason[kind]}));expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalledTimes(calls.audio);expect(mocks.meetingDraftRecording).toHaveBeenCalledTimes(calls.draft);expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(calls.save);});
  it('actual live event subscription rejects another session and retires on unmount',async()=>{await beginOwnedRecording();await waitFor(()=>expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));act(()=>liveTranscriptionUpdate?.({sessionId:'foreign-session',sentenceId:'owned',start:0,end:1,text:'foreign-live-marker',final:true}));expect(screen.queryByText('foreign-live-marker')).toBeNull();cleanup();expect(liveTranscriptionUpdate).toBeNull();expect(mocks.meetingCancelLiveTranscription).toHaveBeenCalledWith({sessionId:'live-1'});});
  it('actual preview stays singleflight and its false/reject paths do not become transcript text',async()=>{localStorage.setItem('meeting-transcriber-engine','sherpa-onnx-paraformer');renderKnowledge('/meeting-recorder/col-1');const panel=await screen.findByRole('main',{name:'AI录音'});vi.useFakeTimers();await act(async()=>fireEvent.click(within(panel).getByRole('button',{name:'开始录音'})));expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function));let release!:(value:unknown)=>void;mocks.meetingTranscribePreview.mockReturnValueOnce(new Promise(r=>{release=r;})).mockRejectedValueOnce(Error('owned-preview-private'));act(()=>activeProcessor?.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array(16000*8).fill(0.1)}}));await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(mocks.meetingTranscribePreview).toHaveBeenCalledTimes(1);await act(async()=>release({ok:false,error:'invalid_wav'}));await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(mocks.meetingTranscribePreview).toHaveBeenCalledTimes(3);expect(screen.queryByText('owned-preview-private')).toBeNull();cleanup();vi.useRealTimers();});
  async function importedTranscript(){renderKnowledge();fireEvent.click(await screen.findByRole('button',{name:zh.knowledge.meetingImport}));fireEvent.click(screen.getByRole('button',{name:'选择 WAV'}));await screen.findByText('/tmp/weekly-sync.wav');fireEvent.change(screen.getByLabelText('转写文本'),{target:{value:'owned transcript'}});return screen.getByRole('button',{name:'保存到知识库'});}
  it('actual imported save rejection retains the draft and reports its failure',async()=>{mocks.meetingSaveTranscript.mockRejectedValueOnce(Error('owned-save-reject'));const save=await importedTranscript();fireEvent.click(save);expect(await screen.findByText(zh.knowledge.meetingImportError('unknown'))).toBeInTheDocument();expect(screen.getByLabelText('转写文本')).toHaveValue('owned transcript');});
  it('actual imported save late failure uses the current locale',async()=>{let release!:(value:unknown)=>void;mocks.meetingSaveTranscript.mockReturnValueOnce(new Promise(r=>{release=r;}));const save=await importedTranscript();fireEvent.click(save);fireEvent.click(screen.getByRole('button',{name:'test-locale'}));await act(async()=>release({ok:false,error:'transcript_required'}));expect(await screen.findByText(en.knowledge.meetingImportError('transcript_required'))).toBeInTheDocument();expect(screen.queryByText(zh.knowledge.meetingImportError('transcript_required'))).toBeNull();});
  it('actual imported save is same-turn singleflight',async()=>{let release!:(value:unknown)=>void;mocks.meetingSaveTranscript.mockReturnValue(new Promise(r=>{release=r;}));const save=await importedTranscript();act(()=>{save.dispatchEvent(new MouseEvent('click',{bubbles:true}));save.dispatchEvent(new MouseEvent('click',{bubbles:true}));});const before=mocks.meetingSaveTranscript.mock.calls.length;await act(async()=>release({ok:false,error:'transcript_required'}));expect(before).toBe(1);});
  it('actual imported save late success after unmount starts no successor reads',async()=>{let release!:(value:unknown)=>void;mocks.meetingSaveTranscript.mockReturnValueOnce(new Promise(r=>{release=r;}));const save=await importedTranscript();fireEvent.click(save);cleanup();const sources=mocks.kbListSources.mock.calls.length,collections=mocks.kbListCollections.mock.calls.length;await act(async()=>release({ok:true,meeting:{},source:{},chunks:[]}));expect(mocks.kbListSources).toHaveBeenCalledTimes(sources);expect(mocks.kbListCollections).toHaveBeenCalledTimes(collections);});
  it('actual unmount while live start is pending retires the acquired stream when the ACK arrives',async()=>{const stop=vi.fn();mocks.getUserMedia.mockResolvedValue({getTracks:()=>[{stop}]});let release!:(value:unknown)=>void;mocks.meetingStartLiveTranscription.mockReturnValueOnce(new Promise(r=>{release=r;}));await driveStage('start');cleanup();await act(async()=>release({ok:true,sessionId:'late-retired'}));expect(stop).toHaveBeenCalled();expect(mocks.meetingSaveRecordedAudio).not.toHaveBeenCalled();expect(mocks.meetingDraftRecording).not.toHaveBeenCalled();});
  it('actual cleanup accepts cancel business false without claiming a new saved deliverable',async()=>{await beginOwnedRecording();await waitFor(()=>expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));mocks.meetingCancelLiveTranscription.mockResolvedValueOnce({ok:false,error:'meeting_live_session_not_found'});cleanup();expect(mocks.meetingCancelLiveTranscription).toHaveBeenCalledWith({sessionId:'live-1'});expect(mocks.meetingSaveRecordedAudio).not.toHaveBeenCalled();expect(mocks.meetingSaveTranscript).not.toHaveBeenCalled();});
  it('actual cleanup cancel rejection must be observed rather than become an unhandled Promise',async()=>{await beginOwnedRecording();await waitFor(()=>expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));mocks.meetingCancelLiveTranscription.mockRejectedValueOnce(Error('meeting_live_failed'));cleanup();await act(async()=>{await Promise.resolve();});expect(mocks.meetingCancelLiveTranscription).toHaveBeenCalledWith({sessionId:'live-1'});});
  it('actual recording start is same-turn singleflight before getUserMedia/live-start ACK',async()=>{localStorage.setItem('meeting-transcriber-engine','aliyun-asr');let release!:(value:unknown)=>void;mocks.meetingStartLiveTranscription.mockReturnValue(new Promise(r=>{release=r;}));renderKnowledge('/meeting-recorder/col-1');const panel=await screen.findByRole('main',{name:'AI录音'}),start=within(panel).getByRole('button',{name:'开始录音'});act(()=>{start.dispatchEvent(new MouseEvent('click',{bubbles:true}));start.dispatchEvent(new MouseEvent('click',{bubbles:true}));});await waitFor(()=>expect(mocks.meetingStartLiveTranscription.mock.calls.length).toBeGreaterThan(0));const before=mocks.meetingStartLiveTranscription.mock.calls.length;await act(async()=>release({ok:false,error:'meeting_live_failed'}));expect(before).toBe(1);expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);});
  it('actual repeated stop while saved-audio ACK is held cannot issue duplicate files or drafts',async()=>{let release!:(value:unknown)=>void;mocks.meetingSaveRecordedAudio.mockReturnValueOnce(new Promise(r=>{release=r;}));const panel=await beginOwnedRecording();await waitFor(()=>expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));ownedAudioChunk();const finish=within(panel).getByRole('button',{name:'完成'});act(()=>{finish.dispatchEvent(new MouseEvent('click',{bubbles:true}));finish.dispatchEvent(new MouseEvent('click',{bubbles:true}));});await waitFor(()=>expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalled());const before=mocks.meetingSaveRecordedAudio.mock.calls.length;await act(async()=>release({ok:true,filePath:'/tmp/recorded-meeting.wav'}));expect(before).toBe(1);await waitFor(()=>expect(mocks.meetingDraftRecording).toHaveBeenCalledTimes(1));});

  function seedRouteCollections() {
    mocks.kbListCollections.mockResolvedValue(['col-1','col-2'].map(id => ({ id, name: id === 'col-1' ? '会议' : '第二会议', description: '', color: '', chunkCountCached: 0, createdAt: 1, updatedAt: 1 })));
  }
  function routeChunk(value: number) { act(() => activeProcessor?.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(16000).fill(value) } })); }
  async function saveContinuedRecording() {
    await waitFor(() => expect(mocks.meetingDraftRecording).toHaveBeenCalledTimes(1));
    const save = await screen.findByRole('button', { name: zh.knowledge.meetingSave });
    fireEvent.click(save);
    await waitFor(() => expect(mocks.meetingSaveTranscript).toHaveBeenCalledTimes(1));
    expect(mocks.meetingSaveTranscript).toHaveBeenCalledWith(expect.objectContaining({ collectionId: 'col-2', audioFilePath: '/tmp/recorded-meeting.wav' }));
    await waitFor(() => expect(mocks.meetingNotifyRecordingSaved).toHaveBeenCalledExactlyOnceWith({ collectionId: 'col-2' }));
    await waitFor(() => expect(mocks.meetingCloseRecorderWindow).toHaveBeenCalledTimes(1));
  }
  it.each(['collection','mode-roundtrip'] as const)('actual published recording survives %s route navigation and explicitly saves both old and new chunks', async route => {
    seedRouteCollections();
    const panel = await beginOwnedRecording();
    await waitFor(() => expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));
    const processor = activeProcessor;
    routeChunk(0.1);
    await waitFor(() => expect(mocks.meetingPushLiveTranscriptionAudio).toHaveBeenCalledTimes(1));
    const buttons = within(panel).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent?.trim());
    if (route === 'mode-roundtrip') {
      fireEvent.click(screen.getByRole('button', { name: 'test-route-knowledge' }));
      expect(screen.getByTestId('test-route-path')).toHaveTextContent('/knowledge/col-2');
      expect(activeProcessor).toBe(processor);
      expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function));
      expect(stopTrack).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'test-route-recorder' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'test-route-collection' }));
    expect(screen.getByTestId('test-route-path')).toHaveTextContent('/meeting-recorder/col-2');
    expect(activeProcessor).toBe(processor);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(mocks.meetingCancelLiveTranscription).not.toHaveBeenCalled();
    expect(mocks.meetingSaveRecordedAudio).not.toHaveBeenCalled();
    expect(mocks.meetingNotifyRecordingSaved).not.toHaveBeenCalled();
    expect(mocks.meetingDraftRecording).not.toHaveBeenCalled();
    const nextPanel = screen.getByRole('main', { name: 'AI录音' });
    if (route === 'collection') expect(nextPanel).toBe(panel);
    expect(within(nextPanel).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent?.trim())).toEqual(buttons);
    routeChunk(0.25);
    await waitFor(() => expect(mocks.meetingPushLiveTranscriptionAudio).toHaveBeenCalledTimes(2));
    fireEvent.click(within(nextPanel).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalledTimes(1));
    const wav = Uint8Array.from(atob(mocks.meetingSaveRecordedAudio.mock.calls[0]![0].wavBase64), ch => ch.charCodeAt(0));
    expect(wav.byteLength).toBe(44 + 32000 * 2);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).not.toBe(0);
    expect(view.getInt16(44 + 16000 * 2, true)).not.toBe(view.getInt16(44, true));
    expect(mocks.meetingFinishLiveTranscription).toHaveBeenCalledExactlyOnceWith({ sessionId: 'live-1' });
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mocks.meetingStartLiveTranscription).toHaveBeenCalledTimes(1);
    await saveContinuedRecording();
  });
  it('actual finish held across collection route still writes once and permits explicit save in the current collection', async () => {
    seedRouteCollections();
    let release!: (value: unknown) => void;
    mocks.meetingFinishLiveTranscription.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const panel = await beginOwnedRecording();
    await waitFor(() => expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));
    ownedAudioChunk();
    fireEvent.click(within(panel).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(mocks.meetingFinishLiveTranscription).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'test-route-collection' }));
    expect(mocks.meetingSaveRecordedAudio).not.toHaveBeenCalled();
    await act(async () => release({ ok: true }));
    await saveContinuedRecording();
    expect(mocks.meetingSaveRecordedAudio).toHaveBeenCalledTimes(1);
    expect(mocks.meetingCancelLiveTranscription).not.toHaveBeenCalled();
  });
  it('actual collection route retires held picker without retiring mounted recording ownership', async () => {
    seedRouteCollections();
    let release!: (value: string) => void;
    mocks.meetingPickAudioFile.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    renderKnowledge();
    fireEvent.click(await screen.findByRole('button', { name: zh.knowledge.meetingImport }));
    fireEvent.click(screen.getByRole('button', { name: '选择 WAV' }));
    fireEvent.click(screen.getByRole('button', { name: 'test-route-knowledge' }));
    await act(async () => release('/retired-collection.wav'));
    expect(screen.queryByText('/retired-collection.wav')).toBeNull();
  });
  it('actual true unmount still stops recording and observes cancel rejection without a saved ACK', async () => {
    await beginOwnedRecording();
    await waitFor(() => expect(activeProcessor?.onaudioprocess).toEqual(expect.any(Function)));
    ownedAudioChunk();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.meetingCancelLiveTranscription.mockRejectedValueOnce(Error('private-unmount-cancel-marker'));
    try {
      cleanup();
      await waitFor(() => expect(warn).toHaveBeenCalledWith('meeting_live_cancel_failed'));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-unmount-cancel-marker');
      expect(stopTrack).toHaveBeenCalled();
      expect(mocks.meetingCancelLiveTranscription).toHaveBeenCalledExactlyOnceWith({ sessionId: 'live-1' });
      expect(mocks.meetingSaveRecordedAudio).not.toHaveBeenCalled();
      expect(mocks.meetingNotifyRecordingSaved).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
