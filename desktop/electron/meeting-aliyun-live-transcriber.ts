import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export interface AliyunLiveTranscriptionUpdate {
  sentenceId: string;
  start: number;
  end: number;
  text: string;
  final: boolean;
}

interface AliyunLiveWebSocket {
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): this;
  on(event: 'error', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  send(data: string | Buffer): void;
  close(): void;
  terminate(): void;
}

export interface AliyunLiveTranscriptionSessionOptions {
  apiKey: string;
  baseUrl: string;
  sampleRate: number;
  language?: string;
  taskId?: string;
  startTimeoutMs?: number;
  finishTimeoutMs?: number;
  maxBufferedAudioBytes?: number;
  websocketFactory?: (url: string, headers: Record<string, string>) => AliyunLiveWebSocket;
  onUpdate: (update: AliyunLiveTranscriptionUpdate) => void;
}

export interface AliyunLiveTranscriptionSession {
  start(): Promise<void>;
  pushAudio(audio: Buffer): void;
  finish(): Promise<void>;
  cancel(): void;
}

export interface AliyunLiveTranscriptionRegistry {
  start(
    ownerId: number,
    options: Omit<AliyunLiveTranscriptionSessionOptions, 'onUpdate'>,
    onUpdate: (sessionId: string, update: AliyunLiveTranscriptionUpdate) => void,
  ): Promise<string>;
  pushAudio(ownerId: number, sessionId: string, audio: Buffer): void;
  finish(ownerId: number, sessionId: string): Promise<void>;
  cancel(ownerId: number, sessionId: string): void;
  cancelOwner(ownerId: number): void;
}

export function createAliyunLiveTranscriptionRegistry(dependencies: {
  idFactory?: () => string;
  sessionFactory?: typeof createAliyunLiveTranscriptionSession;
} = {}): AliyunLiveTranscriptionRegistry {
  const sessions = new Map<string, { ownerId: number; session: AliyunLiveTranscriptionSession }>();
  const idFactory = dependencies.idFactory ?? randomUUID;
  const sessionFactory = dependencies.sessionFactory ?? createAliyunLiveTranscriptionSession;

  const readOwned = (ownerId: number, sessionId: string) => {
    const active = sessions.get(sessionId);
    if (!active || active.ownerId !== ownerId) throw new Error('aliyun_live_session_not_found');
    return active;
  };

  return {
    async start(ownerId, options, onUpdate) {
      const sessionId = idFactory();
      const session = sessionFactory({
        ...options,
        onUpdate: update => onUpdate(sessionId, update),
      });
      sessions.set(sessionId, { ownerId, session });
      try {
        await session.start();
        return sessionId;
      } catch (error) {
        sessions.delete(sessionId);
        session.cancel();
        throw error;
      }
    },

    pushAudio(ownerId, sessionId, audio) {
      readOwned(ownerId, sessionId).session.pushAudio(audio);
    },

    async finish(ownerId, sessionId) {
      const active = readOwned(ownerId, sessionId);
      try {
        await active.session.finish();
      } finally {
        sessions.delete(sessionId);
      }
    },

    cancel(ownerId, sessionId) {
      const active = readOwned(ownerId, sessionId);
      sessions.delete(sessionId);
      active.session.cancel();
    },

    cancelOwner(ownerId) {
      for (const [sessionId, active] of sessions) {
        if (active.ownerId !== ownerId) continue;
        sessions.delete(sessionId);
        active.session.cancel();
      }
    },
  };
}

type SessionState = 'created' | 'starting' | 'started' | 'finishing' | 'finished' | 'closed' | 'failed';

const DEFAULT_START_TIMEOUT_MS = 15_000;
const DEFAULT_FINISH_TIMEOUT_MS = 15_000;

export function createAliyunLiveTranscriptionSession(
  options: AliyunLiveTranscriptionSessionOptions,
): AliyunLiveTranscriptionSession {
  const taskId = options.taskId ?? randomUUID();
  const sampleRate = normalizeSampleRate(options.sampleRate);
  const maxBufferedAudioBytes = options.maxBufferedAudioBytes ?? sampleRate * 2 * 5;
  const socketFactory = options.websocketFactory ?? ((url, headers) => (
    new WebSocket(url, { headers }) as unknown as AliyunLiveWebSocket
  ));
  const socket = socketFactory(toAliyunWebSocketUrl(options.baseUrl), {
    Authorization: `Bearer ${options.apiKey}`,
  });
  let state: SessionState = 'created';
  let bufferedAudio: Buffer[] = [];
  let bufferedAudioBytes = 0;
  let startPromise: Promise<void> | null = null;
  let resolveStart: (() => void) | null = null;
  let rejectStart: ((error: Error) => void) | null = null;
  let finishPromise: Promise<void> | null = null;
  let resolveFinish: (() => void) | null = null;
  let rejectFinish: ((error: Error) => void) | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (startTimer) clearTimeout(startTimer);
    if (finishTimer) clearTimeout(finishTimer);
    startTimer = null;
    finishTimer = null;
  };

  const fail = (error: Error) => {
    if (state === 'failed' || state === 'closed' || state === 'finished') return;
    state = 'failed';
    clearTimers();
    bufferedAudio = [];
    bufferedAudioBytes = 0;
    rejectStart?.(error);
    rejectFinish?.(error);
    rejectStart = null;
    rejectFinish = null;
    socket.terminate();
  };

  socket.on('open', () => {
    if (state !== 'starting') return;
    socket.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'fun-asr-realtime',
        parameters: {
          format: 'pcm',
          sample_rate: sampleRate,
          language_hints: [normalizeLanguage(options.language)],
          semantic_punctuation_enabled: false,
          max_sentence_silence: 800,
          heartbeat: true,
        },
        input: {},
      },
    }));
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary || state === 'closed' || state === 'failed') return;
    const message = parseServerMessage(data);
    if (!message) return;
    const header = asRecord(message.header);
    const event = readText(header.event);
    if (event === 'task-started' && state === 'starting') {
      state = 'started';
      if (startTimer) clearTimeout(startTimer);
      startTimer = null;
      for (const audio of bufferedAudio) socket.send(audio);
      bufferedAudio = [];
      bufferedAudioBytes = 0;
      resolveStart?.();
      resolveStart = null;
      rejectStart = null;
      return;
    }
    if (event === 'result-generated' && (state === 'started' || state === 'finishing')) {
      const payload = asRecord(message.payload);
      const output = asRecord(payload.output);
      const sentence = asRecord(output.sentence);
      const text = readText(sentence.text).trim();
      const sentenceId = readText(sentence.sentence_id);
      if (!text || !sentenceId) return;
      options.onUpdate({
        sentenceId,
        start: readMilliseconds(sentence.begin_time),
        end: readMilliseconds(sentence.end_time),
        text,
        final: sentence.sentence_end === true,
      });
      return;
    }
    if (event === 'task-finished' && state === 'finishing') {
      state = 'finished';
      clearTimers();
      resolveFinish?.();
      resolveFinish = null;
      rejectFinish = null;
      socket.close();
      return;
    }
    if (event === 'task-failed') {
      fail(new Error(`aliyun_live_task_failed:${stableErrorCode(readText(header.error_code) || 'unknown')}`));
    }
  });

  socket.on('error', () => fail(new Error('aliyun_live_connect_failed')));
  socket.on('close', () => {
    if (state === 'closed' || state === 'finished' || state === 'failed') return;
    fail(new Error(state === 'starting' ? 'aliyun_live_connect_failed' : 'aliyun_live_connection_closed'));
  });

  return {
    start() {
      if (startPromise) return startPromise;
      if (state !== 'created') return Promise.reject(new Error('aliyun_live_not_started'));
      state = 'starting';
      startPromise = new Promise<void>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      startTimer = setTimeout(() => fail(new Error('aliyun_live_connect_failed')), Math.max(1, options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS));
      return startPromise;
    },

    pushAudio(audio) {
      if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length % 2 !== 0) {
        throw new Error('aliyun_live_invalid_audio');
      }
      if (state === 'started') {
        socket.send(audio);
        return;
      }
      if (state === 'created' || state === 'starting') {
        if (bufferedAudioBytes + audio.length > maxBufferedAudioBytes) {
          fail(new Error('aliyun_live_audio_buffer_overflow'));
          throw new Error('aliyun_live_audio_buffer_overflow');
        }
        bufferedAudio.push(Buffer.from(audio));
        bufferedAudioBytes += audio.length;
        return;
      }
      throw new Error('aliyun_live_not_started');
    },

    finish() {
      if (state === 'finished') return Promise.resolve();
      if (finishPromise) return finishPromise;
      if (state !== 'started') return Promise.reject(new Error('aliyun_live_not_started'));
      state = 'finishing';
      finishPromise = new Promise<void>((resolve, reject) => {
        resolveFinish = resolve;
        rejectFinish = reject;
      });
      socket.send(JSON.stringify({
        header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: {} },
      }));
      finishTimer = setTimeout(() => fail(new Error('aliyun_live_finish_timeout')), Math.max(1, options.finishTimeoutMs ?? DEFAULT_FINISH_TIMEOUT_MS));
      return finishPromise;
    },

    cancel() {
      if (state === 'closed' || state === 'finished') return;
      state = 'closed';
      clearTimers();
      bufferedAudio = [];
      bufferedAudioBytes = 0;
      rejectStart?.(new Error('aliyun_live_cancelled'));
      rejectFinish?.(new Error('aliyun_live_cancelled'));
      rejectStart = null;
      rejectFinish = null;
      socket.close();
    },
  };
}

function toAliyunWebSocketUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('aliyun_live_invalid_base_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('aliyun_live_invalid_base_url');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api-ws/v1/inference';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function normalizeSampleRate(value: number): number {
  if (!Number.isInteger(value) || value < 8_000 || value > 96_000) throw new Error('aliyun_live_invalid_sample_rate');
  return value;
}

function normalizeLanguage(value?: string): string {
  const language = typeof value === 'string' ? value.trim() : '';
  return /^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/i.test(language) ? language : 'zh';
}

function parseServerMessage(data: unknown): Record<string, unknown> | null {
  try {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function readMilliseconds(value: unknown): number {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 1000 : 0;
}

function stableErrorCode(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80) || 'unknown';
}
