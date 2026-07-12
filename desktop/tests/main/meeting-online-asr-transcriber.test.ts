// @vitest-environment node

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodePcm16Wav } from '../../electron/meeting-audio-format.js';
import {
  createAliyunMeetingTranscriber,
  createVolcengineMeetingTranscriber,
} from '../../electron/meeting-online-asr-transcriber.js';

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | Buffer | FormData;
};

function jsonResponse(payload: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string) {
        return headers[name] ?? headers[name.toLowerCase()] ?? null;
      },
    },
    text: async () => JSON.stringify(payload),
  };
}

describe('online meeting ASR transcribers', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-online-asr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('submits local WAV as base64 to Volcengine flash recognition and maps utterance timestamps', async () => {
    const audioFilePath = join(rootDir, 'volc.wav');
    const wav = encodePcm16Wav({ sampleRate: 16_000, channels: 1, samples: new Int16Array(16_000) });
    writeFileSync(audioFilePath, wav);
    const requests: CapturedRequest[] = [];

    const transcriber = createVolcengineMeetingTranscriber({
      appKey: 'volc-app',
      accessKey: 'volc-access',
      endpoint: 'https://openspeech.example.test/api/v3/auc/bigmodel/recognize/flash',
      fetch: async (url, init) => {
        requests.push({
          url,
          headers: init.headers,
          body: init.body,
        });
        return jsonResponse({
          result: {
            text: '客户表示预算下周确认。',
            utterances: [
              { start_time: 1000, end_time: 2500, text: '客户表示预算下周确认。' },
            ],
          },
        }, {
          'X-Api-Status-Code': '20000000',
        });
      },
    });

    const result = await transcriber.transcribeFile({ audioFilePath, meetingId: 'meeting-volc' });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://openspeech.example.test/api/v3/auc/bigmodel/recognize/flash');
    expect(requests[0].headers['X-Api-App-Key']).toBe('volc-app');
    expect(requests[0].headers['X-Api-Access-Key']).toBe('volc-access');
    expect(requests[0].headers['X-Api-Resource-Id']).toBe('volc.bigasr.auc_turbo');
    expect(requests[0].headers['X-Api-Request-Id']).toBe('meeting-volc');
    expect(requests[0].headers['X-Api-Sequence']).toBe('-1');
    const body = JSON.parse(String(requests[0].body)) as { audio: { data: string }; request: { model_name: string } };
    expect(Buffer.from(body.audio.data, 'base64').equals(wav)).toBe(true);
    expect(body.request.model_name).toBe('bigmodel');
    expect(result.text).toBe('客户表示预算下周确认。');
    expect(result.segments).toEqual([
      { start: 1, end: 2.5, text: '客户表示预算下周确认。' },
    ]);
  });

  it('uploads local WAV and maps Bailian FunASR sentence timestamps', async () => {
    const audioFilePath = join(rootDir, 'aliyun.wav');
    const samples = new Int16Array(48_000);
    samples.fill(1200);
    writeFileSync(audioFilePath, encodePcm16Wav({ sampleRate: 48_000, channels: 1, samples }));
    const requests: CapturedRequest[] = [];

    const transcriber = createAliyunMeetingTranscriber({
      apiKey: 'sk-aliyun-api-key',
      baseUrl: 'https://workspace.example.test',
      model: 'fun-asr',
      pollIntervalMs: 1,
      fetch: async (url, init) => {
        requests.push({ url, method: init.method, headers: init.headers, body: init.body });
        if (url.includes('/api/v1/uploads?')) {
          return jsonResponse({
            data: {
              upload_host: 'https://oss-upload.example.test',
              upload_dir: 'dashscope-instant/upload-id',
              oss_access_key_id: 'temporary-access-key',
              signature: 'temporary-signature',
              policy: 'temporary-policy',
              x_oss_object_acl: 'private',
              x_oss_forbid_overwrite: 'true',
            },
          });
        }
        if (url === 'https://oss-upload.example.test') {
          return { ...jsonResponse({}), text: async () => '' };
        }
        if (url.endsWith('/api/v1/services/audio/asr/transcription')) {
          return jsonResponse({ output: { task_id: 'task-123' }, request_id: 'request-submit' });
        }
        if (url.endsWith('/api/v1/tasks/task-123')) {
          return jsonResponse({
            output: {
              task_status: 'SUCCEEDED',
              results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.example.test/transcript.json' }],
            },
          });
        }
        return jsonResponse({
          transcripts: [{
            text: '第一段完成。第二段继续！',
            sentences: [
              { begin_time: 0, end_time: 480, text: '第一段完成。' },
              { begin_time: 480, end_time: 1000, text: '第二段继续！' },
            ],
          }],
        });
      },
    });

    const result = await transcriber.transcribeFile({ audioFilePath, meetingId: 'meeting-aliyun' });

    expect(requests).toHaveLength(5);
    expect(requests[0].url).toContain('/api/v1/uploads?action=getPolicy&model=fun-asr');
    expect(requests[0].headers.Authorization).toBe('Bearer sk-aliyun-api-key');
    expect(requests[1].body).toBeInstanceOf(FormData);
    expect((requests[1].body as FormData).get('key')).toBe('dashscope-instant/upload-id/aliyun.wav');
    expect(requests[2].headers.Authorization).toBe('Bearer sk-aliyun-api-key');
    expect(requests[2].headers['X-DashScope-Async']).toBe('enable');
    expect(requests[2].headers['X-DashScope-OssResourceResolve']).toBe('enable');
    expect(JSON.parse(String(requests[2].body))).toEqual({
      model: 'fun-asr',
      input: { file_urls: ['oss://dashscope-instant/upload-id/aliyun.wav'] },
      parameters: { channel_id: [0], language_hints: ['zh'] },
    });
    expect(requests[3].method).toBe('GET');
    expect(requests[4].headers.Authorization).toBeUndefined();
    expect(result.text).toBe('第一段完成。第二段继续！');
    expect(result.segments).toEqual([
      { start: 0, end: 0.48, text: '第一段完成。' },
      { start: 0.48, end: 1, text: '第二段继续！' },
    ]);
  });

  it('fails fast when Bailian reports a failed async task', async () => {
    const audioFilePath = join(rootDir, 'aliyun-failed.wav');
    writeFileSync(audioFilePath, encodePcm16Wav({ sampleRate: 16_000, channels: 1, samples: new Int16Array(160) }));
    let requestCount = 0;
    const transcriber = createAliyunMeetingTranscriber({
      apiKey: 'sk-api-key',
      baseUrl: 'https://workspace.example.test',
      fetch: async () => {
        requestCount += 1;
        if (requestCount === 1) return jsonResponse({ data: {
          upload_host: 'https://oss.example.test', upload_dir: 'dir', oss_access_key_id: 'id', signature: 'sig', policy: 'policy',
          x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true',
        } });
        if (requestCount === 2) return jsonResponse({});
        if (requestCount === 3) return jsonResponse({ output: { task_id: 'failed-task' } });
        return jsonResponse({ output: { task_status: 'FAILED', code: 'InvalidParameter', message: 'unsupported audio' } });
      },
    });

    await expect(transcriber.transcribeFile({ audioFilePath, meetingId: 'failed' }))
      .rejects.toThrow('aliyun_asr_task_failed:InvalidParameter');
  });

  it('stops polling Bailian when the overall deadline expires', async () => {
    const audioFilePath = join(rootDir, 'aliyun-timeout.wav');
    writeFileSync(audioFilePath, encodePcm16Wav({ sampleRate: 16_000, channels: 1, samples: new Int16Array(160) }));
    let requestCount = 0;
    let clock = 0;
    const transcriber = createAliyunMeetingTranscriber({
      apiKey: 'sk-api-key',
      baseUrl: 'https://workspace.example.test',
      timeoutMs: 5,
      pollIntervalMs: 5,
      now: () => clock,
      sleep: async milliseconds => { clock += milliseconds; },
      fetch: async () => {
        requestCount += 1;
        if (requestCount === 1) return jsonResponse({ data: {
          upload_host: 'https://oss.example.test', upload_dir: 'dir', oss_access_key_id: 'id', signature: 'sig', policy: 'policy',
          x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true',
        } });
        if (requestCount === 2) return jsonResponse({});
        if (requestCount === 3) return jsonResponse({ output: { task_id: 'pending-task' } });
        return jsonResponse({ output: { task_status: 'RUNNING' } });
      },
    });

    await expect(transcriber.transcribeFile({ audioFilePath, meetingId: 'timeout' }))
      .rejects.toThrow('aliyun_asr_timeout');
  });

  it('rejects a successful Bailian task with an empty transcript', async () => {
    const audioFilePath = join(rootDir, 'aliyun-empty.wav');
    writeFileSync(audioFilePath, encodePcm16Wav({ sampleRate: 16_000, channels: 1, samples: new Int16Array(160) }));
    let requestCount = 0;
    const transcriber = createAliyunMeetingTranscriber({
      apiKey: 'sk-api-key',
      baseUrl: 'https://workspace.example.test',
      fetch: async () => {
        requestCount += 1;
        if (requestCount === 1) return jsonResponse({ data: {
          upload_host: 'https://oss.example.test', upload_dir: 'dir', oss_access_key_id: 'id', signature: 'sig', policy: 'policy',
          x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true',
        } });
        if (requestCount === 2) return jsonResponse({});
        if (requestCount === 3) return jsonResponse({ output: { task_id: 'empty-task' } });
        if (requestCount === 4) return jsonResponse({ output: {
          task_status: 'SUCCEEDED',
          results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.example.test/empty.json' }],
        } });
        return jsonResponse({ transcripts: [{ text: '', sentences: [] }] });
      },
    });

    await expect(transcriber.transcribeFile({ audioFilePath, meetingId: 'empty' }))
      .rejects.toThrow('empty_transcription');
  });
});
