// @vitest-environment node

import { EventEmitter } from 'node:events';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  createVolcengineLiveTranscriptionRegistry,
  createVolcengineLiveTranscriptionSession,
} from '../../electron/meeting-volcengine-live-transcriber.js';

class FakeWebSocket extends EventEmitter {
  readonly sent: Buffer[] = [];
  close = vi.fn(() => this.emit('close'));
  terminate = vi.fn();

  send(data: string | Buffer): void {
    this.sent.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  open(): void {
    this.emit('open');
  }

  serverFrame(payload: unknown, flags = 0b0001, sequence = 1): void {
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload)));
    const header = Buffer.from([0x11, 0x90 | flags, 0x11, 0x00]);
    const sequenceBytes = flags & 0b0001 ? Buffer.alloc(4) : Buffer.alloc(0);
    if (sequenceBytes.length) sequenceBytes.writeInt32BE(sequence);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(compressed.length);
    this.emit('message', Buffer.concat([header, sequenceBytes, size, compressed]), true);
  }

  serverError(code: number, message: string): void {
    const compressed = gzipSync(Buffer.from(message));
    const header = Buffer.from([0x11, 0xf0, 0x01, 0x00]);
    const codeBytes = Buffer.alloc(4);
    codeBytes.writeUInt32BE(code);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(compressed.length);
    this.emit('message', Buffer.concat([header, codeBytes, size, compressed]), true);
  }
}

function decodeClientFrame(frame: Buffer): { header: number[]; payload: Buffer } {
  const payloadSize = frame.readUInt32BE(4);
  return {
    header: [...frame.subarray(0, 4)],
    payload: gunzipSync(frame.subarray(8, 8 + payloadSize)),
  };
}

describe('Volcengine SeedASR realtime session', () => {
  it('authenticates the streaming 2.0 endpoint, packets PCM, and maps interim/final utterances', async () => {
    const socket = new FakeWebSocket();
    const updates: unknown[] = [];
    const session = createVolcengineLiveTranscriptionSession({
      appKey: 'volc-app-id',
      accessKey: 'volc-access-token',
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      resourceId: 'volc.seedasr.sauc.duration',
      sampleRate: 16_000,
      packetDurationMs: 200,
      websocketFactory: (url, headers) => {
        expect(url).toBe('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async');
        expect(headers).toMatchObject({
          'X-Api-App-Key': 'volc-app-id',
          'X-Api-Access-Key': 'volc-access-token',
          'X-Api-Resource-Id': 'volc.seedasr.sauc.duration',
        });
        expect(headers['X-Api-Connect-Id']).toMatch(/^[a-z0-9-]+$/i);
        expect(headers).not.toHaveProperty('X-Api-Key');
        return socket;
      },
      onUpdate: update => updates.push(update),
    });

    const started = session.start();
    session.pushAudio(Buffer.alloc(6_400, 1));
    expect(socket.sent).toHaveLength(0);
    socket.open();
    await started;

    const request = decodeClientFrame(socket.sent[0]);
    expect(request.header).toEqual([0x11, 0x10, 0x11, 0x00]);
    expect(JSON.parse(request.payload.toString('utf8'))).toMatchObject({
      user: { uid: 'xiaok-desktop' },
      audio: { format: 'pcm', codec: 'raw', rate: 16_000, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        show_utterances: true,
        result_type: 'full',
      },
    });
    const audio = decodeClientFrame(socket.sent[1]);
    expect(audio.header).toEqual([0x11, 0x20, 0x01, 0x00]);
    expect(audio.payload).toEqual(Buffer.alloc(6_400, 1));

    socket.serverFrame({
      result: {
        text: '今天讨论',
        utterances: [{ start_time: 180, end_time: 860, text: '今天讨论', definite: false }],
      },
    });
    socket.serverFrame({
      result: {
        text: '今天讨论销售方案。',
        utterances: [{ start_time: 40, end_time: 1320, text: '今天讨论销售方案。', definite: true }],
      },
    });

    expect(updates).toEqual([
      { sentenceId: '0', start: 0.18, end: 0.86, text: '今天讨论', final: false },
      { sentenceId: '0', start: 0.04, end: 1.32, text: '今天讨论销售方案。', final: true },
    ]);

    const finished = session.finish();
    const finalAudio = decodeClientFrame(socket.sent.at(-1)!);
    expect(finalAudio.header).toEqual([0x11, 0x22, 0x01, 0x00]);
    expect(finalAudio.payload).toHaveLength(0);
    socket.serverFrame({ result: { text: '今天讨论销售方案。' } }, 0b0011, -1);
    await expect(finished).resolves.toBeUndefined();
  });

  it('uses a single API key header for new-console credentials', async () => {
    const socket = new FakeWebSocket();
    const session = createVolcengineLiveTranscriptionSession({
      appKey: 'volc-api-key',
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      resourceId: 'volc.seedasr.sauc.duration',
      sampleRate: 16_000,
      websocketFactory: (_url, headers) => {
        expect(headers['X-Api-Key']).toBe('volc-api-key');
        expect(headers).not.toHaveProperty('X-Api-App-Key');
        expect(headers).not.toHaveProperty('X-Api-Access-Key');
        return socket;
      },
      onUpdate: () => undefined,
    });

    const started = session.start();
    socket.open();
    await started;
    session.cancel();
  });

  it('fails with a stable service code and isolates sessions by renderer owner', async () => {
    const socket = new FakeWebSocket();
    const session = createVolcengineLiveTranscriptionSession({
      appKey: 'volc-api-key',
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      resourceId: 'volc.seedasr.sauc.duration',
      sampleRate: 16_000,
      websocketFactory: () => socket,
      onUpdate: () => undefined,
    });
    const started = session.start();
    socket.open();
    await started;
    const finished = session.finish();
    socket.serverError(45000030, 'resource exhausted');
    await expect(finished).rejects.toThrow('volcengine_live_service_failed:45000030');

    const cancel = vi.fn();
    const registry = createVolcengineLiveTranscriptionRegistry({
      idFactory: () => 'volc-live-owned',
      sessionFactory: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        pushAudio: vi.fn(),
        finish: vi.fn().mockResolvedValue(undefined),
        cancel,
      }),
    });
    const sessionId = await registry.start(11, {
      appKey: 'volc-api-key',
      endpoint: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      resourceId: 'volc.seedasr.sauc.duration',
      sampleRate: 16_000,
    }, () => undefined);
    expect(() => registry.pushAudio(12, sessionId, Buffer.alloc(2))).toThrow('volcengine_live_session_not_found');
    registry.cancelOwner(11);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
