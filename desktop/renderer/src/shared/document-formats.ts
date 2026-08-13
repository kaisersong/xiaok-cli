export {
  OFFICE_EXTENSIONS,
  OFFICE_FORMATS,
  OOXML_FALLBACK_EXTENSIONS,
  extensionFromPathLike,
  getDocumentMimeType,
  isOfficeDocument,
  officeFormatForPath,
} from '../../../../src/runtime/materials/document-formats';
export type { OfficeFormat } from '../../../../src/runtime/materials/document-formats';

import {
  extensionFromPathLike,
  getDocumentMimeType,
} from '../../../../src/runtime/materials/document-formats';

const DESKTOP_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
};

export function getDesktopDocumentMimeType(pathOrExtension: string): string | undefined {
  return getDocumentMimeType(pathOrExtension)
    ?? DESKTOP_MIME_BY_EXTENSION[extensionFromPathLike(pathOrExtension)];
}
