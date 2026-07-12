import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import WebSocket from 'ws';

export interface VolcengineLiveTranscriptionUpdate {
  sentenceId: string;
  start: number;
  end: number;
  text: string;
  final: boolean;
}

interface VolcengineLiveWebSocket {
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): this;
  on(event: 'error', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  send(data: string | Buffer): void;
  close(): void;
  terminate(): void;
}

export interface VolcengineLiveTranscriptionSessionOptions {
  appKey: string;
  accessKey?: string;
  endpoint: string;
  resourceId: string;
  sampleRate: number;
  packetDurationMs?: number;
  connectId?: string;
  startTimeoutMs?: number;
  finishTimeoutMs?: number;
  maxBufferedAudioBytes?: number;
  websocketFactory?: (url: string, headers: Record<string, string>) => VolcengineLiveWebSocket;
  onUpdate: (update: VolcengineLiveTranscriptionUpdate) => void;
}

export interface VolcengineLiveTranscriptionSession {
  start(): Promise<void>;
  pushAudio(audio: Buffer): void;
  finish(): Promise<void>;
  cancel(): void;
}

export interface VolcengineLiveTranscriptionRegistry {
  start(
    ownerId: number,
    options: Omit<VolcengineLiveTranscriptionSessionOptions, 'onUpdate'>,
    onUpdate: (sessionId: string, update: VolcengineLiveTranscriptionUpdate) => void,
  ): Promise<string>;
  pushAudio(ownerId: number, sessionId: string, audio: Buffer): void;
  finish(ownerId: number, sessionId: string): Promise<void>;
  cancel(ownerId: number, sessionId: string): void;
  cancelOwner(ownerId: number): void;
}

export function createVolcengineLiveTranscriptionRegistry(dependencies: {
  idFactory?: () => string;
  sessionFactory?: typeof createVolcengineLiveTranscriptionSession;
} = {}): VolcengineLiveTranscriptionRegistry {
  const sessions = new Map<string, { ownerId: number; session: VolcengineLiveTranscriptionSession }>();
  const idFactory = dependencies.idFactory ?? randomUUID;
  const sessionFactory = dependencies.sessionFactory ?? createVolcengineLiveTranscriptionSession;

  const readOwned = (ownerId: number, sessionId: string) => {
    const active = sessions.get(sessionId);
    if (!active || active.ownerId !== ownerId) throw new Error('volcengine_live_session_not_found');
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
const DEFAULT_FINISH_TIMEOUT_MS = 20_000;
const FULL_CLIENT_REQUEST_HEADER = Buffer.from([0x11, 0x10, 0x11, 0x00]);
const AUDIO_ONLY_REQUEST_HEADER = Buffer.from([0x11, 0x20, 0x01, 0x00]);
const FINAL_AUDIO_REQUEST_HEADER = Buffer.from([0x11, 0x22, 0x01, 0x00]);

export function createVolcengineLiveTranscriptionSession(
  options: VolcengineLiveTranscriptionSessionOptions,
): VolcengineLiveTranscriptionSession {
  const sampleRate = normalizeSampleRate(options.sampleRate);
  const endpoint = normalizeWebSocketEndpoint(options.endpoint);
  const packetDurationMs = normalizePacketDuration(options.packetDurationMs);
  const packetBytes = Math.max(2, Math.round(sampleRate * 2 * packetDurationMs / 1000 / 2) * 2);
  const maxBufferedAudioBytes = options.maxBufferedAudioBytes ?? sampleRate * 2 * 5;
  const headers = createAuthHeaders(options);
  const socketFactory = options.websocketFactory ?? ((url, requestHeaders) => (
    new WebSocket(url, { headers: requestHeaders }) as unknown as VolcengineLiveWebSocket
  ));
  const socket = socketFactory(endpoint, headers);
  let state: SessionState = 'created';
  let bufferedAudio: Buffer[] = [];
  let bufferedAudioBytes = 0;
  let packetBuffer = Buffer.alloc(0);
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
    packetBuffer = Buffer.alloc(0);
    rejectStart?.(error);
    rejectFinish?.(error);
    resolveStart = null;
    rejectStart = null;
    resolveFinish = null;
    rejectFinish = null;
    socket.terminate();
  };

  const sendAudioPackets = (audio: Buffer) => {
    packetBuffer = packetBuffer.length === 0
      ? Buffer.from(audio)
      : Buffer.concat([packetBuffer, audio]);
    while (packetBuffer.length >= packetBytes) {
      socket.send(encodeClientFrame(AUDIO_ONLY_REQUEST_HEADER, packetBuffer.subarray(0, packetBytes)));
      packetBuffer = Buffer.from(packetBuffer.subarray(packetBytes));
    }
  };

  socket.on('open', () => {
    if (state !== 'starting') return;
    socket.send(encodeClientFrame(FULL_CLIENT_REQUEST_HEADER, Buffer.from(JSON.stringify({
      user: { uid: 'xiaok-desktop' },
      audio: { format: 'pcm', codec: 'raw', rate: sampleRate, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        show_utterances: true,
        result_type: 'full',
      },
    }))));
    state = 'started';
    if (startTimer) clearTimeout(startTimer);
    startTimer = null;
    for (const audio of bufferedAudio) sendAudioPackets(audio);
    bufferedAudio = [];
    bufferedAudioBytes = 0;
    resolveStart?.();
    resolveStart = null;
    rejectStart = null;
  });

  socket.on('message', (data, isBinary) => {
    if (!isBinary || state === 'closed' || state === 'failed') return;
    let response: ParsedServerFrame;
    try {
      response = parseServerFrame(toBuffer(data));
    } catch {
      fail(new Error('volcengine_live_invalid_response'));
      return;
    }
    if (response.type === 'error') {
      fail(new Error(`volcengine_live_service_failed:${stableErrorCode(String(response.code))}`));
      return;
    }
    emitTranscriptionUpdates(response.payload, response.final, options.onUpdate);
    if (response.final && state === 'finishing') {
      state = 'finished';
      clearTimers();
      resolveFinish?.();
      resolveFinish = null;
      rejectFinish = null;
      socket.close();
    }
  });

  socket.on('error', () => fail(new Error('volcengine_live_connect_failed')));
  socket.on('close', () => {
    if (state === 'closed' || state === 'finished' || state === 'failed') return;
    fail(new Error(state === 'starting' ? 'volcengine_live_connect_failed' : 'volcengine_live_connection_closed'));
  });

  return {
    start() {
      if (startPromise) return startPromise;
      if (state !== 'created') return Promise.reject(new Error('volcengine_live_not_started'));
      state = 'starting';
      startPromise = new Promise<void>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      startTimer = setTimeout(
        () => fail(new Error('volcengine_live_connect_failed')),
        Math.max(1, options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS),
      );
      return startPromise;
    },

    pushAudio(audio) {
      if (!Buffer.isBuffer(audio) || audio.length === 0 || audio.length % 2 !== 0) {
        throw new Error('volcengine_live_invalid_audio');
      }
      if (state === 'started') {
        sendAudioPackets(audio);
        return;
      }
      if (state === 'created' || state === 'starting') {
        if (bufferedAudioBytes + audio.length > maxBufferedAudioBytes) {
          fail(new Error('volcengine_live_audio_buffer_overflow'));
          throw new Error('volcengine_live_audio_buffer_overflow');
        }
        bufferedAudio.push(Buffer.from(audio));
        bufferedAudioBytes += audio.length;
        return;
      }
      throw new Error('volcengine_live_not_started');
    },

    finish() {
      if (state === 'finished') return Promise.resolve();
      if (finishPromise) return finishPromise;
      if (state !== 'started') return Promise.reject(new Error('volcengine_live_not_started'));
      state = 'finishing';
      finishPromise = new Promise<void>((resolve, reject) => {
        resolveFinish = resolve;
        rejectFinish = reject;
      });
      socket.send(encodeClientFrame(FINAL_AUDIO_REQUEST_HEADER, packetBuffer));
      packetBuffer = Buffer.alloc(0);
      finishTimer = setTimeout(
        () => fail(new Error('volcengine_live_finish_timeout')),
        Math.max(1, options.finishTimeoutMs ?? DEFAULT_FINISH_TIMEOUT_MS),
      );
      return finishPromise;
    },

    cancel() {
      if (state === 'closed' || state === 'finished') return;
      state = 'closed';
      clearTimers();
      bufferedAudio = [];
      bufferedAudioBytes = 0;
      packetBuffer = Buffer.alloc(0);
      rejectStart?.(new Error('volcengine_live_cancelled'));
      rejectFinish?.(new Error('volcengine_live_cancelled'));
      resolveStart = null;
      rejectStart = null;
      resolveFinish = null;
      rejectFinish = null;
      socket.close();
    },
  };
}

function createAuthHeaders(options: VolcengineLiveTranscriptionSessionOptions): Record<string, string> {
  const appKey = options.appKey.trim();
  const accessKey = options.accessKey?.trim();
  const headers: Record<string, string> = {
    'X-Api-Resource-Id': options.resourceId.trim(),
    'X-Api-Connect-Id': options.connectId?.trim() || randomUUID(),
  };
  if (accessKey) {
    headers['X-Api-App-Key'] = appKey;
    headers['X-Api-Access-Key'] = accessKey;
  } else {
    headers['X-Api-Key'] = appKey;
  }
  return headers;
}

function encodeClientFrame(header: Buffer, payload: Buffer): Buffer {
  const compressed = gzipSync(payload);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(compressed.length);
  return Buffer.concat([header, size, compressed]);
}

type ParsedServerFrame =
  | { type: 'response'; payload: Record<string, unknown>; final: boolean }
  | { type: 'error'; code: number };

function parseServerFrame(frame: Buffer): ParsedServerFrame {
  if (frame.length < 8 || frame[0] >> 4 !== 1) throw new Error('invalid_header');
  const headerBytes = (frame[0] & 0x0f) * 4;
  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  const compression = frame[2] & 0x0f;
  let offset = headerBytes;
  if (messageType === 0x0f) {
    if (frame.length < offset + 8) throw new Error('invalid_error');
    const code = frame.readUInt32BE(offset);
    offset += 4;
    const size = frame.readUInt32BE(offset);
    if (frame.length < offset + 4 + size) throw new Error('invalid_error');
    return { type: 'error', code };
  }
  if (messageType !== 0x09) throw new Error('unsupported_message');
  if (flags & 0x01) offset += 4;
  if (frame.length < offset + 4) throw new Error('invalid_payload');
  const size = frame.readUInt32BE(offset);
  offset += 4;
  if (frame.length < offset + size) throw new Error('invalid_payload');
  const encoded = frame.subarray(offset, offset + size);
  const payloadBytes = compression === 0x01 ? gunzipSync(encoded) : encoded;
  const parsed = JSON.parse(payloadBytes.toString('utf8')) as unknown;
  return {
    type: 'response',
    payload: asRecord(parsed),
    final: Boolean(flags & 0x02),
  };
}

function emitTranscriptionUpdates(
  payload: Record<string, unknown>,
  frameFinal: boolean,
  onUpdate: (update: VolcengineLiveTranscriptionUpdate) => void,
): void {
  const result = asRecord(payload.result);
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  let emitted = false;
  utterances.forEach((value, index) => {
    const utterance = asRecord(value);
    const text = readText(utterance.text).trim();
    if (!text) return;
    const startMs = readMillisecondsValue(utterance.start_time);
    const endMs = readMillisecondsValue(utterance.end_time);
    onUpdate({
      sentenceId: readText(utterance.id) || String(index),
      start: startMs / 1000,
      end: endMs / 1000,
      text,
      final: utterance.definite === true || frameFinal,
    });
    emitted = true;
  });
  if (emitted) return;
  const text = readText(result.text).trim();
  if (!text) return;
  onUpdate({ sentenceId: 'stream', start: 0, end: 0, text, final: frameFinal });
}

function normalizeWebSocketEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('volcengine_live_invalid_endpoint');
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('volcengine_live_invalid_endpoint');
  return url.toString();
}

function normalizeSampleRate(value: number): number {
  if (!Number.isInteger(value) || value < 8_000 || value > 96_000) throw new Error('volcengine_live_invalid_sample_rate');
  return value;
}

function normalizePacketDuration(value?: number): number {
  if (value === undefined) return 200;
  if (!Number.isFinite(value) || value < 100 || value > 1_000) throw new Error('volcengine_live_invalid_packet_duration');
  return Math.round(value);
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('invalid_payload');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function readMillisecondsValue(value: unknown): number {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : 0;
}

function stableErrorCode(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80) || 'unknown';
}
