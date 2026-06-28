import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveStructuralKind,
  validateArtifactStructure,
} from '../../../src/quality/artifact-structure.js';

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'artifact-structure-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('resolveStructuralKind', () => {
  it('returns pdf for .pdf extension', () => {
    expect(resolveStructuralKind('/path/to/report.pdf')).toBe('pdf');
  });

  it('returns pdf for .PDF (case insensitive)', () => {
    expect(resolveStructuralKind('/path/to/REPORT.PDF')).toBe('pdf');
  });

  it('returns pptx for .pptx extension', () => {
    expect(resolveStructuralKind('/path/to/slides.pptx')).toBe('pptx');
  });

  it('returns pptx for .PPTX (case insensitive)', () => {
    expect(resolveStructuralKind('/path/to/SLIDES.PPTX')).toBe('pptx');
  });

  it('returns undefined for .docx', () => {
    expect(resolveStructuralKind('/path/to/doc.docx')).toBeUndefined();
  });

  it('returns undefined for .xlsx', () => {
    expect(resolveStructuralKind('/path/to/sheet.xlsx')).toBeUndefined();
  });

  it('returns undefined for .html', () => {
    expect(resolveStructuralKind('/path/to/page.html')).toBeUndefined();
  });

  it('returns undefined for .md', () => {
    expect(resolveStructuralKind('/path/to/readme.md')).toBeUndefined();
  });

  it('returns undefined for unknown extension', () => {
    expect(resolveStructuralKind('/path/to/file.xyz')).toBeUndefined();
  });

  it('returns undefined for no extension', () => {
    expect(resolveStructuralKind('/path/to/file')).toBeUndefined();
  });
});

describe('validateArtifactStructure - PDF', () => {
  it('accepts file with valid %PDF- header', () => {
    const filePath = join(tempDir, 'valid.pdf');
    writeFileSync(filePath, '%PDF-1.4\n1 0 obj\n');
    expect(validateArtifactStructure(filePath, 'pdf')).toEqual({ ok: true });
  });

  it('rejects file without %PDF- header', () => {
    const filePath = join(tempDir, 'invalid.pdf');
    writeFileSync(filePath, 'hello world this is not a pdf');
    const result = validateArtifactStructure(filePath, 'pdf');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('%PDF-');
  });

  it('rejects file shorter than 5 bytes', () => {
    const filePath = join(tempDir, 'tiny.pdf');
    writeFileSync(filePath, '%PD');
    const result = validateArtifactStructure(filePath, 'pdf');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('%PDF-');
  });

  it('rejects empty file', () => {
    const filePath = join(tempDir, 'empty.pdf');
    writeFileSync(filePath, '');
    const result = validateArtifactStructure(filePath, 'pdf');
    expect(result.ok).toBe(false);
  });

  it('returns ok:true when file does not exist (TOCTOU)', () => {
    const result = validateArtifactStructure(join(tempDir, 'nonexistent.pdf'), 'pdf');
    expect(result.ok).toBe(true);
  });
});

describe('validateArtifactStructure - PPTX', () => {
  it('accepts valid ZIP with [Content_Types].xml in first 64KB', () => {
    const filePath = join(tempDir, 'valid.pptx');
    const header = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const content = Buffer.from('[Content_Types].xml some data here');
    writeFileSync(filePath, Buffer.concat([header, content]));
    expect(validateArtifactStructure(filePath, 'pptx')).toEqual({ ok: true });
  });

  it('rejects file without PK\\x03\\x04 header', () => {
    const filePath = join(tempDir, 'not-zip.pptx');
    writeFileSync(filePath, 'this is not a zip file at all');
    const result = validateArtifactStructure(filePath, 'pptx');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ZIP local file header');
  });

  it('rejects file with PK but wrong version bytes', () => {
    const filePath = join(tempDir, 'bad-pk.pptx');
    const header = Buffer.from([0x50, 0x4B, 0x00, 0x00]);
    writeFileSync(filePath, Buffer.concat([header, Buffer.from('some content')]));
    const result = validateArtifactStructure(filePath, 'pptx');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ZIP local file header');
  });

  it('rejects valid ZIP without [Content_Types].xml', () => {
    const filePath = join(tempDir, 'no-content-types.pptx');
    const header = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const content = Buffer.from('some random zip content without the required xml file');
    writeFileSync(filePath, Buffer.concat([header, content]));
    const result = validateArtifactStructure(filePath, 'pptx');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('[Content_Types].xml');
  });

  it('rejects file shorter than 4 bytes', () => {
    const filePath = join(tempDir, 'tiny.pptx');
    writeFileSync(filePath, 'PK');
    const result = validateArtifactStructure(filePath, 'pptx');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('too small');
  });

  it('handles file exactly 64KB (boundary)', () => {
    const filePath = join(tempDir, 'boundary.pptx');
    const header = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const filler = Buffer.alloc(65536 - 4 - 20);
    const contentTypes = Buffer.from('[Content_Types].xml');
    writeFileSync(filePath, Buffer.concat([header, contentTypes, filler]));
    expect(validateArtifactStructure(filePath, 'pptx')).toEqual({ ok: true });
  });

  it('handles file larger than 64KB (only reads first 64KB)', () => {
    const filePath = join(tempDir, 'large.pptx');
    const header = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    const contentTypes = Buffer.from('[Content_Types].xml');
    const bigFiller = Buffer.alloc(100000);
    writeFileSync(filePath, Buffer.concat([header, contentTypes, bigFiller]));
    expect(validateArtifactStructure(filePath, 'pptx')).toEqual({ ok: true });
  });

  it('returns ok:true when file does not exist (TOCTOU)', () => {
    const result = validateArtifactStructure(join(tempDir, 'nonexistent.pptx'), 'pptx');
    expect(result.ok).toBe(true);
  });
});
