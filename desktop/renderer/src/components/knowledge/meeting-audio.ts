

export interface ActiveMeetingRecording {
  analyser: AnalyserNode;
  audioLevelData: Float32Array<ArrayBuffer>;
  audioLevelFrameId: number | null;
  audioContext: AudioContext;
  capturedSamples: number;
  chunks: Float32Array[];
  gain: GainNode;
  liveTranscriptionSessionId: string | null;
  paused: boolean;
  previewChunkCursor: number;
  previewInFlight: boolean;
  previewPromise: Promise<void> | null;
  previewTimerId: number | null;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
}
const MEETING_AUDIO_LEVEL_BAR_COUNT = 24;
const EMPTY_MEETING_AUDIO_LEVELS = Array.from({ length: MEETING_AUDIO_LEVEL_BAR_COUNT }, () => 0);

export function createEmptyMeetingAudioLevels(): number[] {
  return [...EMPTY_MEETING_AUDIO_LEVELS];
}

export function calculateMeetingAudioLevels(samples: Float32Array, barCount = MEETING_AUDIO_LEVEL_BAR_COUNT): number[] {
  if (samples.length === 0) return createEmptyMeetingAudioLevels();
  return Array.from({ length: barCount }, (_, index) => {
    const start = Math.floor((index * samples.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * samples.length) / barCount));
    let peak = 0;
    let sumSquares = 0;
    for (let sampleIndex = start; sampleIndex < end && sampleIndex < samples.length; sampleIndex += 1) {
      const absolute = Math.abs(samples[sampleIndex] ?? 0);
      peak = Math.max(peak, absolute);
      sumSquares += absolute * absolute;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    return Math.min(1, Math.max(peak, rms * 1.6));
  });
}

export function countMeetingAudioSamples(chunks: Float32Array[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

export function stopActiveMeetingRecording(active: ActiveMeetingRecording): void {
  if (active.audioLevelFrameId !== null) {
    window.cancelAnimationFrame(active.audioLevelFrameId);
    active.audioLevelFrameId = null;
  }
  if (active.previewTimerId !== null) {
    window.clearTimeout(active.previewTimerId);
    active.previewTimerId = null;
  }
  active.processor.onaudioprocess = null;
  try { active.source.disconnect(); } catch { /* ignore */ }
  try { active.analyser.disconnect(); } catch { /* ignore */ }
  try { active.processor.disconnect(); } catch { /* ignore */ }
  try { active.gain.disconnect(); } catch { /* ignore */ }
  for (const track of active.stream.getTracks()) track.stop();
  void active.audioContext.close().catch(() => undefined);
}

export function encodeFloat32ChunksToWavBase64(chunks: Float32Array[], sampleRate: number): string {
  const sampleCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const wav = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(wav);
  let offset = 0;

  const writeAscii = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
    offset += value.length;
  };

  writeAscii('RIFF');
  view.setUint32(offset, 36 + sampleCount * 2, true); offset += 4;
  writeAscii('WAVE');
  writeAscii('fmt ');
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * 2, true); offset += 4;
  view.setUint16(offset, 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeAscii('data');
  view.setUint32(offset, sampleCount * 2, true); offset += 4;

  for (const chunk of chunks) {
    for (const value of chunk) {
      const sample = Math.max(-1, Math.min(1, value));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  const bytes = new Uint8Array(wav);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function encodeFloat32ChunkToPcmBase64(chunk: Float32Array): string {
  const bytes = new Uint8Array(chunk.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < chunk.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, chunk[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}
