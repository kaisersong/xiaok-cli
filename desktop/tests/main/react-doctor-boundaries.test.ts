import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = join(__dirname, '..', '..');

function readDesktopFile(relativePath: string): string {
  return readFileSync(join(desktopRoot, relativePath), 'utf8');
}

describe('React Doctor component boundaries', () => {
  it('keeps artifact stream parsing helpers outside the component module', () => {
    const component = readDesktopFile('renderer/src/components/ArtifactStreamBlock.tsx');

    expect(component).not.toContain('export function extractPartialArtifactFields');
    expect(component).not.toContain('export function extractPartialWidgetFields');
    expect(existsSync(join(desktopRoot, 'renderer/src/components/artifact-stream-parser.ts'))).toBe(true);
  });

  it('keeps document preview helpers outside the component module', () => {
    const component = readDesktopFile('renderer/src/components/DocumentPanel.tsx');

    expect(component).not.toContain('export function canPreviewDocumentAsText');
    expect(existsSync(join(desktopRoot, 'renderer/src/components/document-preview.ts'))).toBe(true);
  });

  it('keeps citation source context outside the component module', () => {
    const component = readDesktopFile('renderer/src/components/CitationBadge.tsx');

    expect(component).not.toContain('export const WebSourcesContext');
    expect(existsSync(join(desktopRoot, 'renderer/src/contexts/web-sources.ts'))).toBe(true);
  });

  it('uses routerLocation for React Router locations instead of a global-looking local name', () => {
    const files = [
      'renderer/src/components/RunDetailPanel.tsx',
      'renderer/src/components/Sidebar.tsx',
      'renderer/src/contexts/app-ui.tsx',
    ];

    for (const file of files) {
      const source = readDesktopFile(file);
      expect(source).not.toContain('const location = useLocation()');
      expect(source).not.toContain('const location = useLocation();');
      expect(source).toContain('routerLocation');
    }
  });
});
