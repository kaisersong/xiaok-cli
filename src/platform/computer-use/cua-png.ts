import { crc32 } from 'node:zlib';

/** Bounded PNG structure shared by the host image port and Windows observations. */
export function validateComputerUsePng(data: string): { bytes: number; width: number; height: number } {
  const invalid = () => new Error('tool_image_invalid');
  if (typeof data !== 'string' || data.length > 6 * 1024 * 1024
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw invalid();
  const buffer = Buffer.from(data, 'base64');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR'
    || buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', buffer.length - 8, buffer.length - 4) !== 'IEND') throw invalid();
  const width = buffer.readUInt32BE(16); const height = buffer.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) throw invalid();
  let offset = 8; let hasImageData = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw invalid();
    const size = buffer.readUInt32BE(offset); const end = offset + 12 + size;
    if (end > buffer.length || crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) throw invalid();
    const kind = buffer.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT' && size) hasImageData = true;
    if (kind === 'IEND' && (size !== 0 || end !== buffer.length)) throw invalid();
    if (offset > 8 && kind === 'IHDR') throw invalid();
    offset = end;
  }
  if (!hasImageData) throw invalid();
  return { bytes: buffer.length, width, height };
}
