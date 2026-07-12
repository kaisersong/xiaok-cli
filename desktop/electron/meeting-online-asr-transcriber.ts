import { openAsBlob, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePcm16WavInfo } from './meeting-audio-format.js';
import { normalizeTranscriptSegmentText, normalizeTranscriptText } from './meeting-local-transcriber.js';
import type { MeetingTranscriber, MeetingTranscriptionResult } from './meeting-service.js';

export interface OnlineAsrFetchResponse {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export type OnlineAsrFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string | Buffer | FormData;
    signal?: AbortSignal;
  },
) => Promise<OnlineAsrFetchResponse>;

export interface VolcengineMeetingTranscriberOptions {
  appKey: string;
  accessKey?: string;
  endpoint: string;
  resourceId?: string;
  fetch?: OnlineAsrFetch;
}

export interface AliyunMeetingTranscriberOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  uploadPolicyEndpoint?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  fetch?: OnlineAsrFetch;
}

const VOLCENGINE_DEFAULT_RESOURCE_ID = 'volc.bigasr.auc_turbo';
const ALIYUN_DEFAULT_MODEL = 'fun-asr';
const ALIYUN_UPLOAD_POLICY_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/uploads';
const ALIYUN_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const ALIYUN_DEFAULT_POLL_INTERVAL_MS = 2_000;

export function createVolcengineMeetingTranscriber(options: VolcengineMeetingTranscriberOptions): MeetingTranscriber {
  const fetchImpl = options.fetch ?? defaultFetch;
  const resourceId = options.resourceId?.trim() || VOLCENGINE_DEFAULT_RESOURCE_ID;

  return {
    async transcribeFile(input) {
      const audio = readFileSync(input.audioFilePath);
      const info = parsePcm16WavInfo(audio);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': input.meetingId || `xiaok-${Date.now()}`,
        'X-Api-Sequence': '-1',
      };
      if (options.accessKey?.trim()) {
        headers['X-Api-App-Key'] = options.appKey;
        headers['X-Api-Access-Key'] = options.accessKey.trim();
      } else {
        headers['X-Api-Key'] = options.appKey;
      }

      const response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user: { uid: 'xiaok-desktop' },
          audio: {
            format: 'wav',
            codec: 'raw',
            rate: info.sampleRate,
            bits: info.bitsPerSample,
            channel: info.channels,
            data: audio.toString('base64'),
          },
          request: {
            model_name: 'bigmodel',
            enable_itn: true,
            enable_punc: true,
          },
        }),
      });

      const statusCode = response.headers?.get('X-Api-Status-Code') ?? response.headers?.get('x-api-status-code');
      if (!response.ok || (statusCode && statusCode !== '20000000')) {
        throw new Error(`volcengine_asr_failed:${statusCode || response.status}`);
      }
      return parseVolcengineResponse(await response.text(), info.durationSeconds);
    },
  };
}

export function createAliyunMeetingTranscriber(options: AliyunMeetingTranscriberOptions): MeetingTranscriber {
  const fetchImpl = options.fetch ?? defaultFetch;
  const model = options.model?.trim() || ALIYUN_DEFAULT_MODEL;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const uploadPolicyEndpoint = options.uploadPolicyEndpoint ?? ALIYUN_UPLOAD_POLICY_ENDPOINT;
  const timeoutMs = Math.max(1, options.timeoutMs ?? ALIYUN_DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? ALIYUN_DEFAULT_POLL_INTERVAL_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));

  return {
    async transcribeFile(input) {
      const deadline = now() + timeoutMs;
      const ossUrl = await uploadAliyunAudio({
        fetchImpl,
        apiKey: options.apiKey,
        model,
        audioFilePath: input.audioFilePath,
        uploadPolicyEndpoint,
        deadline,
        now,
      });
      const submit = await requestAliyunJson({
        fetchImpl,
        url: `${baseUrl}/api/v1/services/audio/asr/transcription`,
        init: {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
            'X-DashScope-OssResourceResolve': 'enable',
          },
          body: JSON.stringify({
            model,
            input: { file_urls: [ossUrl] },
            parameters: { channel_id: [0], language_hints: ['zh'] },
          }),
        },
        errorPrefix: 'aliyun_asr_submit_failed',
        deadline,
        now,
      });
      const taskId = readNestedText(submit, ['output', 'task_id']);
      if (!taskId) throw new Error('aliyun_asr_invalid_response');

      const transcriptionUrl = await pollAliyunTask({
        fetchImpl,
        apiKey: options.apiKey,
        baseUrl,
        taskId,
        deadline,
        pollIntervalMs,
        now,
        sleep,
      });
      const transcription = await requestAliyunJson({
        fetchImpl,
        url: transcriptionUrl,
        init: { method: 'GET', headers: {} },
        errorPrefix: 'aliyun_asr_result_download_failed',
        deadline,
        now,
      });
      return parseAliyunBailianResponse(transcription);
    },
  };
}

async function uploadAliyunAudio(input: {
  fetchImpl: OnlineAsrFetch;
  apiKey: string;
  model: string;
  audioFilePath: string;
  uploadPolicyEndpoint: string;
  deadline: number;
  now: () => number;
}): Promise<string> {
  const policyUrl = new URL(input.uploadPolicyEndpoint);
  policyUrl.searchParams.set('action', 'getPolicy');
  policyUrl.searchParams.set('model', input.model);
  const policyResponse = await requestAliyunJson({
    fetchImpl: input.fetchImpl,
    url: policyUrl.toString(),
    init: { method: 'GET', headers: { Authorization: `Bearer ${input.apiKey}` } },
    errorPrefix: 'aliyun_asr_upload_policy_failed',
    deadline: input.deadline,
    now: input.now,
  });
  const policy = isRecord(policyResponse.data) ? policyResponse.data : {};
  const uploadHost = readTextField(policy, ['upload_host']);
  const uploadDir = readTextField(policy, ['upload_dir']);
  if (!uploadHost || !uploadDir) throw new Error('aliyun_asr_invalid_response');
  const fileName = basename(input.audioFilePath);
  const objectKey = `${uploadDir}/${fileName}`;
  const form = new FormData();
  form.append('OSSAccessKeyId', readRequiredAliyunField(policy, 'oss_access_key_id'));
  form.append('Signature', readRequiredAliyunField(policy, 'signature'));
  form.append('policy', readRequiredAliyunField(policy, 'policy'));
  form.append('x-oss-object-acl', readRequiredAliyunField(policy, 'x_oss_object_acl'));
  form.append('x-oss-forbid-overwrite', readRequiredAliyunField(policy, 'x_oss_forbid_overwrite'));
  form.append('key', objectKey);
  form.append('success_action_status', '200');
  form.append('file', await openAsBlob(input.audioFilePath), fileName);
  ensureAliyunDeadline(input.deadline, input.now);
  const response = await input.fetchImpl(uploadHost, {
    method: 'POST',
    headers: {},
    body: form,
    signal: createAliyunTimeoutSignal(input.deadline, input.now),
  });
  if (!response.ok) throw new Error(`aliyun_asr_upload_failed:${response.status}`);
  return `oss://${objectKey}`;
}

async function pollAliyunTask(input: {
  fetchImpl: OnlineAsrFetch;
  apiKey: string;
  baseUrl: string;
  taskId: string;
  deadline: number;
  pollIntervalMs: number;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<string> {
  for (;;) {
    const task = await requestAliyunJson({
      fetchImpl: input.fetchImpl,
      url: `${input.baseUrl}/api/v1/tasks/${encodeURIComponent(input.taskId)}`,
      init: { method: 'GET', headers: { Authorization: `Bearer ${input.apiKey}` } },
      errorPrefix: 'aliyun_asr_task_query_failed',
      deadline: input.deadline,
      now: input.now,
    });
    const output = isRecord(task.output) ? task.output : {};
    const status = readTextField(output, ['task_status']);
    if (status === 'FAILED') {
      const code = stableAliyunErrorCode(readTextField(output, ['code']) || 'unknown');
      throw new Error(`aliyun_asr_task_failed:${code}`);
    }
    if (status === 'SUCCEEDED') {
      const results = readArray(output, 'results');
      for (const result of results) {
        if (!isRecord(result) || readTextField(result, ['subtask_status']) === 'FAILED') continue;
        const url = readTextField(result, ['transcription_url']);
        if (url) return url;
      }
      throw new Error('aliyun_asr_invalid_response');
    }
    ensureAliyunDeadline(input.deadline, input.now);
    await input.sleep(Math.min(input.pollIntervalMs, Math.max(0, input.deadline - input.now())));
  }
}

async function requestAliyunJson(input: {
  fetchImpl: OnlineAsrFetch;
  url: string;
  init: Parameters<OnlineAsrFetch>[1];
  errorPrefix: string;
  deadline: number;
  now: () => number;
}): Promise<Record<string, unknown>> {
  ensureAliyunDeadline(input.deadline, input.now);
  let response: OnlineAsrFetchResponse;
  try {
    response = await input.fetchImpl(input.url, {
      ...input.init,
      signal: createAliyunTimeoutSignal(input.deadline, input.now),
    });
  } catch (error) {
    if (input.now() >= input.deadline || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error('aliyun_asr_timeout');
    }
    throw error;
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(`${input.errorPrefix}:${response.status}`);
  return parseJsonObject(raw, 'aliyun_asr_invalid_response');
}

function parseAliyunBailianResponse(parsed: Record<string, unknown>): MeetingTranscriptionResult {
  const transcripts = readArray(parsed, 'transcripts');
  const segments: MeetingTranscriptionResult['segments'] = [];
  const transcriptTexts: string[] = [];
  for (const transcript of transcripts) {
    if (!isRecord(transcript)) continue;
    const transcriptText = normalizeTranscriptText(readTextField(transcript, ['text'])).trim();
    if (transcriptText) transcriptTexts.push(transcriptText);
    for (const sentence of readArray(transcript, 'sentences')) {
      if (!isRecord(sentence)) continue;
      const text = normalizeTranscriptSegmentText(readTextField(sentence, ['text']));
      if (!text) continue;
      segments.push({
        start: readMillisecondsAsSeconds(sentence, 'begin_time'),
        end: readMillisecondsAsSeconds(sentence, 'end_time'),
        text,
      });
    }
  }
  const text = normalizeTranscriptText(transcriptTexts.join('\n') || segments.map(segment => segment.text).join('\n')).trim();
  if (!text) throw new Error('empty_transcription');
  return { text, segments: segments.length ? segments : [{ start: 0, end: 0, text }] };
}

function readRequiredAliyunField(record: Record<string, unknown>, key: string): string {
  const value = readTextField(record, [key]);
  if (!value) throw new Error('aliyun_asr_invalid_response');
  return value;
}

function readMillisecondsAsSeconds(record: Record<string, unknown>, key: string): number {
  const value = Number(record[key]);
  return Number.isFinite(value) && value >= 0 ? value / 1000 : 0;
}

function stableAliyunErrorCode(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80) || 'unknown';
}

function ensureAliyunDeadline(deadline: number, now: () => number): void {
  if (now() >= deadline) throw new Error('aliyun_asr_timeout');
}

function createAliyunTimeoutSignal(deadline: number, now: () => number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, deadline - now()));
}

function parseVolcengineResponse(raw: string, durationSeconds: number): MeetingTranscriptionResult {
  const parsed = parseJsonObject(raw, 'volcengine_asr_invalid_response');
  const result = isRecord(parsed.result) ? parsed.result : parsed;
  const utterances = readArray(result, 'utterances');
  const segments = utterances.flatMap((utterance) => {
    if (!isRecord(utterance)) return [];
    const text = normalizeTranscriptSegmentText(readTextField(utterance, ['text', 'result']));
    if (!text) return [];
    const start = readTimestampSeconds(utterance, ['start_time', 'startTime', 'start']);
    const end = readTimestampSeconds(utterance, ['end_time', 'endTime', 'end']);
    return [{
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : durationSeconds,
      text,
    }];
  });
  const text = normalizeTranscriptText(
    readTextField(result, ['text', 'result'])
      || segments.map(segment => segment.text).join('\n'),
  ).trim();
  if (!text && segments.length === 0) throw new Error('empty_transcription');
  return {
    text: text || segments.map(segment => segment.text).join('\n'),
    segments: segments.length ? segments : [{ start: 0, end: durationSeconds, text }],
  };
}

function parseJsonObject(raw: string, errorCode: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new Error(errorCode);
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readTextField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readNestedText(record: Record<string, unknown>, path: string[]): string {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return '';
    current = current[key];
  }
  return typeof current === 'string' ? current.trim() : '';
}

function readTimestampSeconds(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(record[key]);
    if (!Number.isFinite(value)) continue;
    return value >= 1000 ? value / 1000 : value;
  }
  return Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function defaultFetch(url: string, init: Parameters<OnlineAsrFetch>[1]): Promise<OnlineAsrFetchResponse> {
  if (typeof fetch !== 'function') throw new Error('fetch_unavailable');
  const body = Buffer.isBuffer(init.body)
    ? new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength)
    : init.body;
  return fetch(url, { ...init, body } as RequestInit) as unknown as OnlineAsrFetchResponse;
}
