import { describe, it, expect } from 'vitest';
import { InvocationToolImages } from '../../../src/ai/runtime/tool-image-channel.js';
const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=' } };
describe('shared invocation image channel', () => {
  it('bounds images and rejects late, mismatched and corrupt payloads', () => {
    const channel = new InvocationToolImages(new AbortController().signal, true);
    expect(() => channel.emit({ ...image, source: { ...image.source, media_type: 'image/jpeg' } })).toThrow('invalid');
    for (let i = 0; i < 4; i++) channel.emit(image);
    expect(() => channel.emit(image)).toThrow('limit');
    expect(channel.finish(true)).toHaveLength(4);
    expect(() => channel.emit(image)).toThrow('closed');
  });
  it('discards failed and cancelled invocations without affecting another call', () => {
    const abort = new AbortController();
    const first = new InvocationToolImages(abort.signal, true);
    const second = new InvocationToolImages(new AbortController().signal, true);
    first.emit(image); second.emit(image); abort.abort();
    expect(first.finish(true)).toEqual([]);
    expect(second.finish(true)).toEqual([image]);
    const failed = new InvocationToolImages(new AbortController().signal, true); failed.emit(image);
    expect(failed.finish(false)).toEqual([]);
  });
});
