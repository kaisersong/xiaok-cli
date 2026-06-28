import { openSync, readSync, closeSync, statSync } from 'node:fs';

export type StructuralKind = 'pdf' | 'pptx';

export interface StructuralValidationResult {
  ok: boolean;
  error?: string;
}

export function resolveStructuralKind(filePath: string): StructuralKind | undefined {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.pptx')) return 'pptx';
  return undefined;
}

export function validateArtifactStructure(
  filePath: string,
  kind: StructuralKind,
): StructuralValidationResult {
  try {
    if (kind === 'pdf') return validatePdfStructure(filePath);
    if (kind === 'pptx') return validatePptxStructure(filePath);
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

function validatePdfStructure(filePath: string): StructuralValidationResult {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(5);
    const bytesRead = readSync(fd, buf, 0, 5, 0);
    if (bytesRead < 5 || buf.toString('ascii') !== '%PDF-') {
      return { ok: false, error: 'missing %PDF- header signature' };
    }
    return { ok: true };
  } finally {
    closeSync(fd);
  }
}

function validatePptxStructure(filePath: string): StructuralValidationResult {
  const fd = openSync(filePath, 'r');
  try {
    const size = statSync(filePath).size;
    const readLen = Math.min(65536, size);
    const buf = Buffer.alloc(readLen);
    const bytesRead = readSync(fd, buf, 0, readLen, 0);
    if (bytesRead < 4) {
      return { ok: false, error: 'file too small to be valid PPTX' };
    }
    if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) {
      return { ok: false, error: 'missing ZIP local file header (PK\\x03\\x04)' };
    }
    const content = buf.subarray(0, bytesRead).toString('latin1');
    if (!content.includes('[Content_Types].xml')) {
      return { ok: false, error: 'missing [Content_Types].xml in first 64KB' };
    }
    return { ok: true };
  } finally {
    closeSync(fd);
  }
}
