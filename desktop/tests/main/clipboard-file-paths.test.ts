import { describe, expect, it } from 'vitest';
import { readClipboardPathCandidates } from '../../electron/clipboard-file-paths.js';
const source = (values: Record<string, string | Buffer>) => ({
  read: (name: string) => String(values[name] ?? ''),
  readText: () => String(values.text ?? ''),
  readBuffer: (name: string) => values[name] instanceof Buffer ? values[name] as Buffer : Buffer.alloc(0),
});
describe('native clipboard paths', () => {
  it('reads Windows wide file paths and dedupes case and separators', () => {
    expect(readClipboardPathCandidates(source({ FileNameW: Buffer.from('C:\\项目\\a.txt\0c:/项目/a.txt\0', 'utf16le') }))).toEqual(['C:\\项目\\a.txt']);
  });
  it('reads a DROPFILES wide list and rejects invalid header offsets', () => {
    const buffer = Buffer.concat([Buffer.alloc(20), Buffer.from('\\\\server\\share\\a.txt\0\0', 'utf16le')]);
    buffer.writeUInt32LE(20, 0); buffer.writeUInt32LE(1, 16);
    expect(readClipboardPathCandidates(source({ CF_HDROP: buffer }))).toEqual(['\\\\server\\share\\a.txt']);
    buffer.writeUInt32LE(1, 0);
    expect(readClipboardPathCandidates(source({ CF_HDROP: buffer }))).toEqual([]);
  });
  it('decodes Finder XML once and ignores ordinary clipboard prose', () => {
    expect(readClipboardPathCandidates(source({ NSFilenamesPboardType: '<array><string>/tmp/a&amp;lt;.txt</string></array>', text: 'normal text' }))).toEqual(['/tmp/a&lt;.txt']);
  });
  it('reads file URLs and quoted paths without requiring availableFormats', () => {
    expect(readClipboardPathCandidates(source({ text: '"/tmp/a b.txt"\nfile:///tmp/c%20d.txt' }))).toEqual(['/tmp/a b.txt', '/tmp/c d.txt']);
  });
});
