import { describe, expect, it } from 'vitest';
import {
  OFFICE_EXTENSIONS,
  OOXML_FALLBACK_EXTENSIONS,
  getDocumentMimeType,
  isOfficeDocument,
  officeFormatForPath,
} from '../../../src/runtime/materials/document-formats.js';

describe('Office document format contract', () => {
  it('recognizes every supported Microsoft Office extension case-insensitively', () => {
    expect([...OFFICE_EXTENSIONS]).toEqual([
      '.doc', '.docx', '.docm',
      '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm',
      '.xls', '.xlsx', '.xlsm', '.xlsb',
    ]);
    expect(officeFormatForPath('预算.XLSB')).toBe('xlsb');
    expect(isOfficeDocument('deck.PPSM')).toBe(true);
    expect(isOfficeDocument('notes.rtf')).toBe(false);
  });

  it('provides canonical MIME types and limits lightweight fallback to OOXML', () => {
    expect(getDocumentMimeType('proposal.docm')).toBe('application/vnd.ms-word.document.macroEnabled.12');
    expect(getDocumentMimeType('.ppt')).toBe('application/vnd.ms-powerpoint');
    expect(getDocumentMimeType('ledger.xlsb')).toBe('application/vnd.ms-excel.sheet.binary.macroEnabled.12');
    expect(OOXML_FALLBACK_EXTENSIONS).toEqual(new Set(['.docx', '.pptx', '.xlsx']));
    expect(OOXML_FALLBACK_EXTENSIONS.has('.xls')).toBe(false);
  });
});
