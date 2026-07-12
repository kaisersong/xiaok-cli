import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decodePcm16WavToFloat32,
  encodePcm16Wav,
  parsePcm16WavInfo,
  writePcm16WavFile,
} from '../../electron/meeting-audio-format.js';

describe('Meeting audio format', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-meeting-audio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('encodes mono PCM samples as canonical 16-bit WAV', () => {
    const samples = new Int16Array([0, 32767, -32768, 1024]);
    const wav = encodePcm16Wav({ samples, sampleRate: 16_000, channels: 1 });
    const info = parsePcm16WavInfo(wav);

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(info).toEqual({
      audioFormat: 1,
      bitsPerSample: 16,
      channels: 1,
      dataBytes: 8,
      durationSeconds: 0.00025,
      sampleRate: 16_000,
      totalSamples: 4,
    });
  });

  it('writes WAV files that preserve duration metadata', () => {
    const samples = new Int16Array(16_000);
    const filePath = join(rootDir, 'meeting.wav');
    writePcm16WavFile(filePath, { samples, sampleRate: 16_000, channels: 1 });

    const info = parsePcm16WavInfo(readFileSync(filePath));
    expect(info.durationSeconds).toBe(1);
    expect(info.dataBytes).toBe(32_000);
  });

  it('decodes stereo PCM16 WAV to mono Float32 samples without external buffers', () => {
    const samples = new Int16Array([
      32767, 32767,
      -32768, -32768,
      16384, -16384,
    ]);
    const wav = encodePcm16Wav({ samples, sampleRate: 48_000, channels: 2 });

    const decoded = decodePcm16WavToFloat32(wav);

    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.durationSeconds).toBeCloseTo(3 / 48_000);
    expect(decoded.samples).toBeInstanceOf(Float32Array);
    expect(decoded.samples.buffer.constructor).toBe(ArrayBuffer);
    expect(Array.from(decoded.samples)).toEqual([
      32767 / 32768,
      -1,
      0,
    ]);
  });
});
