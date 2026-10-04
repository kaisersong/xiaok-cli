import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { deflateRawSync } from 'node:zlib';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { SENSITIVE_FILE_REDACTION } from '../../../src/shared/stream-safety/redact.js';

describe('readTool', () => {
  let dir: string;
  let readTool: ReturnType<typeof createReadTool>;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    readTool = createReadTool({ cwd: dir });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads file with line numbers', async () => {
    writeFileSync(join(dir, 'foo.txt'), 'line1\nline2\nline3');
    const result = await readTool.execute({ file_path: join(dir, 'foo.txt') });
    expect(result).toContain('1\tline1');
    expect(result).toContain('2\tline2');
  });

  it('returns error message for missing file', async () => {
    const result = await readTool.execute({ file_path: join(dir, 'missing.txt') });
    expect(result).toContain('Error');
  });

  it('fails closed for sensitive file types', async () => {
    writeFileSync(join(dir, '.env'), 'OPENAI_API_KEY=sk-live_abcdefghijklmnopqrstuvwxyz');

    const result = await readTool.execute({ file_path: join(dir, '.env') });

    expect(result).toBe(SENSITIVE_FILE_REDACTION);
    expect(result).not.toContain('sk-live');
  });

  it('redacts secrets from normal file output', async () => {
    writeFileSync(join(dir, 'notes.txt'), [
      'Authorization: Bearer sk-live_abcdefghijklmnopqrstuvwxyz',
      'commit 0123456789abcdef0123456789abcdef01234567',
    ].join('\n'));

    const result = await readTool.execute({ file_path: join(dir, 'notes.txt') });

    expect(result).toContain('Authorization: Bearer <redacted>');
    expect(result).toContain('0123456789abcdef0123456789abcdef01234567');
    expect(result).not.toContain('sk-live_abcdefghijklmnopqrstuvwxyz');
  });

  it('truncates oversized output when max_chars is provided', async () => {
    writeFileSync(join(dir, 'large.txt'), Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join('\n'));

    const result = await readTool.execute({
      file_path: join(dir, 'large.txt'),
      max_chars: 60,
    });

    expect(result).toContain('已截断');
  });

  describe('visual image reads', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
    function context() {
      return { signal: new AbortController().signal, modelSupportsImageInput: true, emitToolImage: vi.fn() };
    }

    it('emits actual PNG bytes with a text acknowledgment, without base64 in the tool response', async () => {
      const file = join(dir, 'screen.png'); writeFileSync(file, png);
      const ctx = context();
      const result = await readTool.execute({ file_path: file }, ctx as never);
      expect(result).not.toMatch(/^Error:/);
      expect(ctx.emitToolImage).toHaveBeenCalledWith({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } });
      expect(result).not.toContain(png.toString('base64'));
      expect(result).toMatch(/视觉|图片/);
    });

    it('identifies GIF bytes even if the extension says .txt', async () => {
      const data = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const file = join(dir, 'screen.txt'); writeFileSync(file, data);
      const ctx = context();
      await expect(readTool.execute({ file_path: file }, ctx as never)).resolves.not.toMatch(/^Error:/);
      expect(ctx.emitToolImage.mock.calls[0][0].source.media_type).toBe('image/gif');
    });

    it('reads a real JPEG whose EXIF/ICC segments put dimensions beyond the header sniff', async () => {
      const jpeg = readFileSync(join(process.cwd(), 'tests/fixtures/images/read-image.jpg'));
      expect(jpeg.length).toBeGreaterThan(4096);
      const file = join(dir, 'screen.jpg'); writeFileSync(file, jpeg);
      const ctx = context();
      expect(await readTool.execute({ file_path: file }, ctx as never)).not.toMatch(/^Error:/);
      expect(ctx.emitToolImage).toHaveBeenCalledWith({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } });
    });

    it.each([false, undefined])('does not pretend to read pixels when vision capability is %s', capability => {
      const file = join(dir, 'screen.png'); writeFileSync(file, png);
      const ctx = { ...context(), modelSupportsImageInput: capability };
      return readTool.execute({ file_path: file }, ctx as never).then(result => {
        expect(result).toMatch(/^Error:/);
        expect(result).toMatch(/图片输入|视觉/);
        expect(ctx.emitToolImage).not.toHaveBeenCalled();
      });
    });

    it('does not pretend success without a host media port', async () => {
      const file = join(dir, 'screen.png'); writeFileSync(file, png);
      expect(await readTool.execute({ file_path: file }, { modelSupportsImageInput: true } as never)).toMatch(/^Error:/);
    });

    it('refuses corrupted PNG chunks', async () => {
      const bad = Buffer.from(png); bad[45] ^= 1;
      const file = join(dir, 'bad.png'); writeFileSync(file, bad);
      const ctx = context();
      expect(await readTool.execute({ file_path: file }, ctx as never)).toMatch(/^Error:/);
      expect(ctx.emitToolImage).not.toHaveBeenCalled();
    });

    it('bounds image file size before emitting it', async () => {
      const file = join(dir, 'huge.png'); writeFileSync(file, Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]));
      const ctx = context();
      expect(await readTool.execute({ file_path: file }, ctx as never)).toMatch(/^Error:/);
      expect(ctx.emitToolImage).not.toHaveBeenCalled();
    });

    it('preserves sensitive-file and workspace checks ahead of image delivery', async () => {
      const ctx = context();
      const secret = join(dir, '.env.png'); writeFileSync(secret, png);
      expect(await readTool.execute({ file_path: secret }, ctx as never)).toBe(SENSITIVE_FILE_REDACTION);
      const outside = mkdtempSync(join(tmpdir(), 'xiaok-outside-image-'));
      try {
        const file = join(outside, 'screen.png'); writeFileSync(file, png);
        await expect(readTool.execute({ file_path: file }, ctx as never)).rejects.toThrow();
        expect(ctx.emitToolImage).not.toHaveBeenCalled();
      } finally { rmSync(outside, { recursive: true, force: true }); }
    });

    it('propagates cancellation without emitting an image', async () => {
      const file = join(dir, 'screen.png'); writeFileSync(file, png);
      const abort = new AbortController(); abort.abort(new DOMException('stop', 'AbortError'));
      const ctx = { ...context(), signal: abort.signal };
      await expect(readTool.execute({ file_path: file }, ctx as never)).rejects.toBe(abort.signal.reason);
      expect(ctx.emitToolImage).not.toHaveBeenCalled();
    });
  });

  // D1：以前对任何 Office / PDF 文件都直接 utf-8 解码，静默返回乱码且不报错。
  describe('D1 二进制路由', () => {
    it('reads a real-structure docx as text instead of mojibake', async () => {
      const filePath = join(dir, '董事会评审报告.docx');
      writeFileSync(filePath, createDocx(['这是一份董事会评审报告。', '请进行对抗性评审。']));

      const result = await readTool.execute({ file_path: filePath });

      expect(result).toContain('董事会评审报告');
      expect(result).toContain('对抗性评审');
      expect(result).not.toContain('PK\u0003\u0004');
      expect(result).not.toContain('\ufffd');
    });

    it('reports a clear error for PDF instead of returning bytes', async () => {
      const filePath = join(dir, '扫描合同.pdf');
      writeFileSync(filePath, '%PDF-1.7\n<< binary >>');

      const result = await readTool.execute({ file_path: filePath });

      expect(result).toMatch(/^Error:/);
      expect(result).toMatch(/PDF/i);
      expect(result).not.toContain('\ufffd');
    });

    it('reports a clear error for an unknown binary instead of returning bytes', async () => {
      const filePath = join(dir, 'logo.png');
      writeFileSync(filePath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));

      const result = await readTool.execute({ file_path: filePath });

      expect(result).toMatch(/^Error:/);
      expect(result).not.toContain('\ufffd');
    });

    it('applies offset and limit to the extracted lines', async () => {
      const filePath = join(dir, '多段.docx');
      writeFileSync(filePath, createDocx(['第一段', '第二段', '第三段', '第四段']));

      const result = await readTool.execute({ file_path: filePath, offset: 2, limit: 2 });

      expect(result).toContain('2\t第二段');
      expect(result).toContain('3\t第三段');
      expect(result).not.toContain('第一段');
      expect(result).not.toContain('第四段');
    });

    it('serves an offset past the extractor default budget instead of returning empty', async () => {
      // 每段 200 字，600 段 ≈ 120,000 字符，远超提取器 50,000 的默认上限。
      const paragraphs = Array.from({ length: 600 }, (_unused, index) => `${'段'.repeat(199)}${index % 10}`);
      const filePath = join(dir, '超长.docx');
      writeFileSync(filePath, createDocx([...paragraphs, '这是最后一段可辨识内容']));

      const result = await readTool.execute({ file_path: filePath, offset: 500, limit: 3 });

      expect(result).toContain('500\t');
      expect(result.trim()).not.toBe('');
      expect(result).not.toMatch(/^Error:/);
    });

    it('still redacts secrets found inside extracted text', async () => {
      const filePath = join(dir, '含密钥.docx');
      writeFileSync(filePath, createDocx(['Authorization: Bearer sk-live_abcdefghijklmnopqrstuvwxyz']));

      const result = await readTool.execute({ file_path: filePath });

      expect(result).toContain('Authorization: Bearer <redacted>');
      expect(result).not.toContain('sk-live_abcdefghijklmnopqrstuvwxyz');
    });

    it('keeps the sensitive-path check ahead of extraction', async () => {
      const filePath = join(dir, '.env.docx');
      writeFileSync(filePath, createDocx(['OPENAI_API_KEY=sk-live_abcdefghijklmnopqrstuvwxyz']));

      const result = await readTool.execute({ file_path: filePath });

      expect(result).toBe(SENSITIVE_FILE_REDACTION);
    });
  });
});

function createDocx(paragraphs: string[]): Buffer {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    ...paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`),
    '</w:body></w:document>',
  ].join('');
  return createZip([
    { name: '[Content_Types].xml', content: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />' },
    { name: 'word/document.xml', content: documentXml },
  ]);
}

function createZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
