import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Pcm16WavInput {
  samples: Int16Array;
  sampleRate: number;
  channels?: number;
}

export interface Pcm16WavInfo {
  audioFormat: number;
  bitsPerSample: number;
  channels: number;
  dataBytes: number;
  durationSeconds: number;
  sampleRate: number;
  totalSamples: number;
}

export function encodePcm16Wav(input: Pcm16WavInput): Buffer {
  const channels = input.channels ?? 1;
  if (!Number.isInteger(channels) || channels < 1) {
    throw new Error('channels must be a positive integer');
  }
  if (!Number.isInteger(input.sampleRate) || input.sampleRate < 1) {
    throw new Error('sampleRate must be a positive integer');
  }

  const dataBytes = input.samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  const byteRate = input.sampleRate * channels * 2;
  const blockAlign = channels * 2;

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(input.sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < input.samples.length; i += 1) {
    wav.writeInt16LE(input.samples[i], 44 + i * 2);
  }

  return wav;
}

export function writePcm16WavFile(filePath: string, input: Pcm16WavInput): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, encodePcm16Wav(input));
}

export function parsePcm16WavInfo(buffer: Buffer): Pcm16WavInfo {
  if (buffer.length < 44 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error('Invalid WAV file');
  }

  let offset = 12;
  let audioFormat = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let dataBytes = 0;
  let sampleRate = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > buffer.length) break;

    if (chunkId === 'fmt ') {
      audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || channels < 1 || sampleRate < 1 || dataBytes < 0) {
    throw new Error('Unsupported WAV format');
  }

  const bytesPerSampleFrame = channels * 2;
  const totalSamples = dataBytes / bytesPerSampleFrame;
  return {
    audioFormat,
    bitsPerSample,
    channels,
    dataBytes,
    durationSeconds: dataBytes / (sampleRate * bytesPerSampleFrame),
    sampleRate,
    totalSamples,
  };
}
