import type { ImageBlock } from '../../src/ai/runtime/blocks.js';
import { validateComputerUsePng } from '../../src/platform/computer-use/cua-png.js';

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
    if (image.type !== 'image' || image.source.type !== 'base64' || image.source.media_type !== 'image/png'
      || typeof image.source.data !== 'string') throw new Error('tool_image_invalid');
    const png = validateComputerUsePng(image.source.data);
    if (this.images.length >= 4 || this.bytes + png.bytes > 8 * 1024 * 1024) throw new Error('tool_image_limit');
    this.bytes += png.bytes;
    this.images.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.source.data } });
  };
  finish(ok: boolean): ImageBlock[] {
    this.signal.removeEventListener('abort', this.abort);
    const result = ok && this.open && !this.signal.aborted ? this.images : [];
    this.images = []; this.bytes = 0; this.open = false;
    return result;
  }
}
