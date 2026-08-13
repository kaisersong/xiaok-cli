import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDesktopDocumentMimeType } from '../../renderer/src/shared/document-formats';

describe('Desktop document format routing', () => {
  it.each([
    ['brief.doc', 'application/msword'],
    ['brief.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
    ['deck.ppt', 'application/vnd.ms-powerpoint'],
    ['deck.pptm', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
    ['budget.xls', 'application/vnd.ms-excel'],
    ['budget.xlsb', 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'],
    ['notes.md', 'text/markdown'],
    ['scan.pdf', 'application/pdf'],
  ])('maps %s through the shared renderer helper', (fileName, expected) => {
    expect(getDesktopDocumentMimeType(fileName)).toBe(expected);
  });

  it('keeps Knowledge and Chat wired to the shared helper without local Office MIME tables', () => {
    const sourceRoot = join(__dirname, '..', '..', 'renderer', 'src', 'components');
    for (const fileName of ['KnowledgePage.tsx', 'ChatView.tsx']) {
      const source = readFileSync(join(sourceRoot, fileName), 'utf8');
      expect(source).toContain('getDesktopDocumentMimeType');
      expect(source).not.toMatch(/mimeMap[^\n]*(?:docx|pptx|xlsx)/);
    }
    const knowledgeSource = readFileSync(join(sourceRoot, 'KnowledgePage.tsx'), 'utf8');
    expect(knowledgeSource).toContain('fileBasename');
    expect(knowledgeSource).not.toContain("fp.split('/')");
  });
});
