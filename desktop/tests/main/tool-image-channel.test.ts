import { describe, expect, it } from 'vitest';
import { InvocationToolImages } from '../../electron/tool-image-channel.js';
const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=' } };
describe('invocation media boundary', () => {
  it('drops queued bytes after cancellation or failure and rejects late emissions', () => {
    const controller = new AbortController();
    const channel = new InvocationToolImages(controller.signal, true);
    channel.emit(image); controller.abort(); expect(channel.finish(true)).toEqual([]);
    const failed = new InvocationToolImages(new AbortController().signal, true);
    failed.emit(image); expect(failed.finish(false)).toEqual([]); expect(() => failed.emit(image)).toThrow('closed');
  });
  it('rejects bad PNG checksums, arbitrary file paths and unbounded output', () => {
    const channel = new InvocationToolImages(new AbortController().signal, true);
    const bytes = Buffer.from(image.source.data, 'base64'); bytes[45] ^= 1;
    expect(() => channel.emit({ ...image, source: { ...image.source, data: bytes.toString('base64') } })).toThrow('tool_image_invalid');
    expect(() => channel.emit({ type: 'image', source: { type: 'file', filePath: 'secret' } } as never)).toThrow('tool_image_invalid');
    for (let i = 0; i < 4; i++) channel.emit(image);
    expect(() => channel.emit(image)).toThrow('tool_image_limit');
    channel.finish(false);
  });
});
