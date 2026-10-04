import type { ImageBlock } from './blocks.js';
import { readImageMetadata } from '../../shared/media/image.js';
import { validateComputerUsePng } from '../../platform/computer-use/cua-png.js';

export function validateToolImage(image: ImageBlock): { bytes: number; width: number; height: number } {
  if (image.type !== 'image' || image.source.type !== 'base64'
    || typeof image.source.data !== 'string') throw new Error('tool_image_invalid');
  if (image.source.data.length > 6 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.source.data)) throw new Error('tool_image_invalid');
  const data = Buffer.from(image.source.data, 'base64');
  const metadata = readImageMetadata(data);
  if (!metadata || metadata.mediaType !== image.source.media_type || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > 16 * 1024 * 1024) throw new Error('tool_image_invalid');
  if (metadata.mediaType === 'image/png') validateComputerUsePng(image.source.data);
  if (metadata.mediaType === 'image/jpeg' && !data.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) throw new Error('tool_image_invalid');
  if (metadata.mediaType === 'image/gif' && data[data.length - 1] !== 0x3b) throw new Error('tool_image_invalid');
  if (metadata.mediaType === 'image/webp' && data.readUInt32LE(4) + 8 !== data.length) throw new Error('tool_image_invalid');
  return { bytes: data.length, width: metadata.width, height: metadata.height };
}

/** A bounded port belongs to one invocation. No files, URLs or image bytes reach logs. */
export class InvocationToolImages {
  private images: ImageBlock[] = [];
  private bytes = 0;
  private open = true;
  private readonly abort = () => { this.images = []; this.open = false; };
  constructor(private readonly signal: AbortSignal, private readonly supportsImages: boolean) {
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  emit = (image: ImageBlock): void => {
    this.signal.throwIfAborted();
    if (!this.open) throw new Error('tool_image_invocation_closed');
    if (!this.supportsImages) throw new Error('COMPUTER_USE_MODEL_IMAGE_DISABLED');
    const dimensions = validateToolImage(image);
    if (this.images.length >= 4 || this.bytes + dimensions.bytes > 8 * 1024 * 1024) throw new Error('tool_image_limit');
    this.bytes += dimensions.bytes;
    this.images.push({ type: 'image', source: { type: 'base64', media_type: image.source.media_type, data: image.source.data } });
  };
  finish(ok: boolean): ImageBlock[] {
    this.signal.removeEventListener('abort', this.abort);
    const result = ok && this.open && !this.signal.aborted ? this.images : [];
    this.images = []; this.bytes = 0; this.open = false;
    return result;
  }
}
