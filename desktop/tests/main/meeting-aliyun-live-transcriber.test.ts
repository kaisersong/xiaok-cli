// @vitest-environment node

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createAliyunLiveTranscriptionRegistry,
  createAliyunLiveTranscriptionSession,
} from '../../electron/meeting-aliyun-live-transcriber.js';

class FakeWebSocket extends EventEmitter {
  readonly sent: Array<string | Buffer> = [];
  close = vi.fn(() => this.emit('close', 1000, Buffer.alloc(0)));
  terminate = vi.fn();

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  open(): void {
    this.emit('open');
  }

  serverEvent(payload: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(payload)), false);
  }
}

describe('Aliyun FunASR realtime session', () => {
  it('waits for task-started, streams buffered PCM, and maps interim/final sentences', async () => {
    const socket = new FakeWebSocket();
    const updates: unknown[] = [];
    const session = createAliyunLiveTranscriptionSession({
      apiKey: 'sk-live-secret',
      baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com',
      sampleRate: 16_000,
      language: 'zh',
      taskId: 'task-live-1',
      websocketFactory: (url, headers) => {
        expect(url).toBe('wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference');
        expect(headers).toEqual({ Authorization: 'Bearer sk-live-secret' });
        return socket;
      },
      onUpdate: update => updates.push(update),
    });

    const started = session.start();
    socket.open();
    const runTask = JSON.parse(String(socket.sent[0]));
    expect(runTask).toMatchObject({
      header: { action: 'run-task', task_id: 'task-live-1', streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'fun-asr-realtime',
        parameters: {
          format: 'pcm',
          sample_rate: 16_000,
          language_hints: ['zh'],
          heartbeat: true,
        },
      },
    });

    session.pushAudio(Buffer.from([1, 0, 2, 0]));
    expect(socket.sent).toHaveLength(1);
    socket.serverEvent({ header: { event: 'task-started', task_id: 'task-live-1' }, payload: {} });
    await started;
    expect(socket.sent[1]).toEqual(Buffer.from([1, 0, 2, 0]));

    socket.serverEvent({
      header: { event: 'result-generated', task_id: 'task-live-1' },
      payload: { output: { sentence: { sentence_id: 7, begin_time: 120, end_time: 860, text: '今天讨论', sentence_end: false } } },
    });
    socket.serverEvent({
      header: { event: 'result-generated', task_id: 'task-live-1' },
      payload: { output: { sentence: { sentence_id: 7, begin_time: 120, end_time: 1320, text: '今天讨论销售方案。', sentence_end: true } } },
    });

    expect(updates).toEqual([
      { sentenceId: '7', start: 0.12, end: 0.86, text: '今天讨论', final: false },
      { sentenceId: '7', start: 0.12, end: 1.32, text: '今天讨论销售方案。', final: true },
    ]);

    const finished = session.finish();
    expect(JSON.parse(String(socket.sent.at(-1)))).toMatchObject({
      header: { action: 'finish-task', task_id: 'task-live-1', streaming: 'duplex' },
      payload: { input: {} },
    });
    socket.serverEvent({ header: { event: 'task-finished', task_id: 'task-live-1' }, payload: {} });
    await expect(finished).resolves.toBeUndefined();
  });

  it('fails closed when pre-start audio exceeds the bounded buffer', () => {
    const socket = new FakeWebSocket();
    const session = createAliyunLiveTranscriptionSession({
      apiKey: 'sk-live-secret',
      baseUrl: 'https://workspace.example.test',
      sampleRate: 16_000,
      maxBufferedAudioBytes: 4,
      websocketFactory: () => socket,
      onUpdate: () => undefined,
    });

    session.pushAudio(Buffer.alloc(4));
    expect(() => session.pushAudio(Buffer.alloc(2))).toThrow('aliyun_live_audio_buffer_overflow');
    expect(socket.terminate).toHaveBeenCalled();
  });

  it('binds sessions to their owning renderer and cancels them when the owner closes', async () => {
    const pushAudio = vi.fn();
    const finish = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    const registry = createAliyunLiveTranscriptionRegistry({
      idFactory: () => 'live-owned',
      sessionFactory: () => ({
        start: vi.fn().mockResolvedValue(undefined),
        pushAudio,
        finish,
        cancel,
      }),
    });

    const sessionId = await registry.start(11, {
      apiKey: 'sk-live-secret',
      baseUrl: 'https://workspace.example.test',
      sampleRate: 16_000,
    }, () => undefined);
    expect(sessionId).toBe('live-owned');
    expect(() => registry.pushAudio(12, sessionId, Buffer.alloc(2))).toThrow('aliyun_live_session_not_found');
    registry.pushAudio(11, sessionId, Buffer.from([1, 0]));
    expect(pushAudio).toHaveBeenCalledWith(Buffer.from([1, 0]));

    registry.cancelOwner(12);
    expect(cancel).not.toHaveBeenCalled();
    registry.cancelOwner(11);
    expect(cancel).toHaveBeenCalledOnce();
    await expect(registry.finish(11, sessionId)).rejects.toThrow('aliyun_live_session_not_found');
  });
});
