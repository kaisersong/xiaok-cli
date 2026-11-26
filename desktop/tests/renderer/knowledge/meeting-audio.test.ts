import { expect, it } from 'vitest';
import { encodeFloat32ChunksToWavBase64 } from '../../../renderer/src/components/knowledge/meeting-audio';

it('encodes ordered microphone chunks as mono 16-bit WAV with clipped samples', () => {
  const wav = Buffer.from(encodeFloat32ChunksToWavBase64([
    Float32Array.of(-2, -0.5),
    Float32Array.of(0, 0.5, 2),
  ], 16_000), 'base64');

  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.readUInt32LE(4)).toBe(46);
  expect(wav.subarray(8, 16).toString()).toBe('WAVEfmt ');
  expect(wav.readUInt16LE(20)).toBe(1);
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt32LE(24)).toBe(16_000);
  expect(wav.readUInt16LE(34)).toBe(16);
  expect(wav.subarray(36, 40).toString()).toBe('data');
  expect(wav.readUInt32LE(40)).toBe(10);
  expect(wav.subarray(44).toString('hex')).toBe('008000c00000ff3fff7f');
});
