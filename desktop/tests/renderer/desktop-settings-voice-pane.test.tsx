import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { DesktopSettings } from '../../renderer/src/components/DesktopSettings';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { api } from '../../renderer/src/api';

const meetingMocks = vi.hoisted(() => ({
  meetingGetAsrConfig: vi.fn(),
  meetingSaveAsrConfig: vi.fn(),
  meetingListModels: vi.fn(),
  meetingDownloadModel: vi.fn(),
  meetingUninstallModel: vi.fn(),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => meetingMocks,
}));

vi.mock('../../renderer/src/api', () => {
  const handler: ProxyHandler<Record<string, any>> = {
    get(target, prop) {
      if (typeof prop === 'string' && !target[prop]) {
        target[prop] = vi.fn().mockResolvedValue(undefined);
      }
      return target[prop];
    },
  };
  return { api: new Proxy({}, handler) };
});

function renderSettings() {
  render(
    <MemoryRouter>
      <LocaleProvider>
        <DesktopSettings onClose={() => {}} />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('DesktopSettings voice pane', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getSkillDebugConfig).mockResolvedValue({ enabled: false });
    vi.mocked(api.saveSkillDebugConfig).mockResolvedValue({ enabled: false });
    vi.mocked(api.getKswarmConfig).mockResolvedValue({ maxConcurrentTasks: 3 });
    vi.mocked(api.saveKswarmConfig).mockResolvedValue({ maxConcurrentTasks: 3 });
    vi.mocked(api.getServiceStatus).mockResolvedValue({ checkedAt: Date.now(), services: [] });
    vi.mocked(api.getLoopDefinitions).mockResolvedValue([]);
    vi.mocked(api.getLoopRuns).mockResolvedValue([]);
    vi.mocked(api.getEvidenceAnomalies).mockResolvedValue([]);
    vi.mocked(api.listUserLoopTemplates).mockResolvedValue([]);
    vi.mocked(api.getAccountSettings).mockResolvedValue({});

    meetingMocks.meetingGetAsrConfig.mockResolvedValue({
      defaultProvider: 'sherpa-onnx-paraformer',
      volcengine: {
        configured: false,
        appKeyConfigured: false,
        accessKeyConfigured: false,
        endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
        resourceId: 'volc.seedasr.sauc.duration',
      },
      aliyun: {
        configured: false,
        apiKeyConfigured: false,
        baseUrl: 'https://dashscope.example.test',
        model: 'fun-asr',
      },
    });
    meetingMocks.meetingSaveAsrConfig.mockImplementation(async input => ({
      defaultProvider: input.defaultProvider,
      volcengine: {
        configured: Boolean(input.volcengine?.appKey),
        appKeyConfigured: Boolean(input.volcengine?.appKey),
        accessKeyConfigured: Boolean(input.volcengine?.accessKey),
        endpoint: input.volcengine?.endpoint ?? 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
        resourceId: input.volcengine?.resourceId ?? 'volc.seedasr.sauc.duration',
      },
      aliyun: {
        configured: Boolean(input.aliyun?.apiKey),
        apiKeyConfigured: Boolean(input.aliyun?.apiKey),
        baseUrl: input.aliyun?.baseUrl ?? 'https://dashscope.example.test',
        model: input.aliyun?.model ?? 'fun-asr',
      },
    }));
    meetingMocks.meetingListModels.mockResolvedValue([
      {
        id: 'base',
        capability: 'asr',
        engineId: 'whisper',
        fileName: 'base.pt',
        sizeBytes: 151_000_000,
        sizeLabel: '145 MB',
        downloaded: true,
        status: 'downloaded',
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
    meetingMocks.meetingDownloadModel.mockResolvedValue({ ok: true });
    meetingMocks.meetingUninstallModel.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders voice settings and saves online ASR providers', async () => {
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '语音' }));
    await screen.findByText('AI录音设置');

    fireEvent.change(screen.getByLabelText('默认录音引擎'), { target: { value: 'volcengine-asr' } });
    fireEvent.change(screen.getByLabelText('火山引擎 ASR App Key / API Key'), { target: { value: 'volc-app-key' } });
    fireEvent.change(screen.getByLabelText('火山引擎 ASR Access Key（可选）'), { target: { value: 'volc-access-key' } });
    fireEvent.change(screen.getByLabelText('火山引擎 ASR Endpoint'), { target: { value: 'https://volc.test/asr' } });
    fireEvent.change(screen.getByLabelText('火山引擎 ASR Resource ID'), { target: { value: 'volc.test.resource' } });
    fireEvent.click(screen.getByRole('button', { name: '保存会议 ASR' }));

    await waitFor(() => {
      expect(meetingMocks.meetingSaveAsrConfig).toHaveBeenCalledWith({
        defaultProvider: 'volcengine-asr',
        volcengine: {
          appKey: 'volc-app-key',
          accessKey: 'volc-access-key',
          endpoint: 'https://volc.test/asr',
          resourceId: 'volc.test.resource',
        },
      });
    });
    expect(localStorage.getItem('meeting-transcriber-engine')).toBe('volcengine-asr');
    expect(await screen.findByText('会议 ASR 配置已保存')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('默认录音引擎'), { target: { value: 'aliyun-asr' } });
    fireEvent.change(screen.getByLabelText('阿里云百炼 FunASR API Key'), { target: { value: 'sk-aliyun-api-key' } });
    fireEvent.change(screen.getByLabelText('阿里云百炼 FunASR Base URL'), { target: { value: 'https://workspace.aliyun.test' } });
    fireEvent.click(screen.getByRole('button', { name: '保存会议 ASR' }));

    await waitFor(() => {
      expect(meetingMocks.meetingSaveAsrConfig).toHaveBeenLastCalledWith({
        defaultProvider: 'aliyun-asr',
        aliyun: {
          apiKey: 'sk-aliyun-api-key',
          baseUrl: 'https://workspace.aliyun.test',
          model: 'fun-asr',
        },
      });
    });
    expect(localStorage.getItem('meeting-transcriber-engine')).toBe('aliyun-asr');
  });

  it('shows speech model download status in voice settings', async () => {
    meetingMocks.meetingDownloadModel.mockReturnValueOnce(new Promise(() => undefined));
    renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: '语音' }));
    await screen.findByText('AI录音设置');
    await waitFor(() => {
      expect(meetingMocks.meetingListModels).toHaveBeenCalled();
    });

    expect(screen.getByText('语音识别模型')).toBeInTheDocument();
    expect(screen.getByText('标点模型')).toBeInTheDocument();
    expect(screen.getByText('base.pt')).toBeInTheDocument();
    expect(screen.getByText('medium.pt')).toBeInTheDocument();
    const mediumStatusRow = screen.getByTestId('voice-model-status-medium');
    expect(within(mediumStatusRow).getByText('不完整')).toBeInTheDocument();
    expect(screen.getByText('本地 66 MB / 1.5 GB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '卸载 base.pt' }).textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: '重新下载 medium.pt' }));

    await waitFor(() => {
      expect(meetingMocks.meetingDownloadModel).toHaveBeenCalledWith('medium');
    });
    await waitFor(() => {
      expect(within(mediumStatusRow).getByText('下载中…')).toBeInTheDocument();
    });
    expect(within(mediumStatusRow).queryByText('不完整')).not.toBeInTheDocument();
  });
});
