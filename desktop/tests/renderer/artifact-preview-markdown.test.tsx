import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const { mockReadFileContent } = vi.hoisted(() => ({
  mockReadFileContent: vi.fn(async () => ''),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({ readFileContent: mockReadFileContent }),
}));

vi.mock('../../renderer/src/api', () => ({
  api: { kbAddSource: vi.fn(async () => ({ ok: true })) },
}));

import { ArtifactPreviewModal } from '../../renderer/src/components/projects/ArtifactPreviewModal';

const artifact = {
  id: 'artifact-1',
  filename: 'report.md',
  path: '/tmp/xiaok-test/report.md',
  mimeType: 'text/markdown',
} as never;

async function renderWithMarkdown(md: string): Promise<HTMLElement> {
  mockReadFileContent.mockResolvedValue(md as never);
  const { container } = render(
    <MemoryRouter>
      <LocaleProvider>
        <ArtifactPreviewModal artifact={artifact} onClose={() => {}} />
      </LocaleProvider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockReadFileContent).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText(/report\.md/)).toBeTruthy());
  return container;
}

afterEach(() => {
  cleanup();
  mockReadFileContent.mockReset();
});

describe('artifact markdown preview does not execute agent-controlled HTML', () => {
  // The .md body is agent-controlled and may carry prompt-injected text straight
  // from web_fetch / web_search. It is rendered into the top-level renderer
  // document where window.xiaokDesktop lives, and CSP is Report-Only, so an
  // executing sink here reaches the whole preload surface.
  it('renders <img onerror> as text, not as an element', async () => {
    const container = await renderWithMarkdown('## Title\n<img src=x onerror="window.__pwned=1">');

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.textContent).toContain('<img');
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
  });

  it('renders <svg onload> as text, not as an element', async () => {
    const container = await renderWithMarkdown('# T\n<svg onload="window.__pwned2=1"></svg>');

    // The modal chrome renders its own lucide icons as <svg>, so only an svg
    // carrying an injected handler proves the content was parsed as markup.
    expect(container.querySelectorAll('svg[onload]')).toHaveLength(0);
    expect(container.textContent).toContain('<svg');
  });

  it('does not emit an iframe for inline HTML', async () => {
    const container = await renderWithMarkdown('text\n<iframe src="javascript:alert(1)"></iframe>');

    expect(container.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('drops javascript: hrefs from markdown links', async () => {
    const container = await renderWithMarkdown('[click me](javascript:alert(1))');

    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href') ?? '');
    expect(hrefs.some(href => href.toLowerCase().startsWith('javascript:'))).toBe(false);
  });

  it('does not turn file paths in agent content into clickable targets', async () => {
    // MarkdownRenderer's linkifyFilePaths turns bare path text into a clickable
    // span whose fallback is window.open('file://...'), which main.ts's
    // setWindowOpenHandler forwards to shell.openPath with no path allowlist.
    const container = await renderWithMarkdown(
      'Open /Users/song/Downloads/payload.command for results, or C:\\Users\\song\\evil.bat',
    );

    expect(container.querySelectorAll('[role="link"]')).toHaveLength(0);
  });
});

describe('artifact markdown preview keeps rendering real markdown', () => {
  it('renders headings, emphasis, lists and inline code as elements', async () => {
    const container = await renderWithMarkdown(
      '## Heading two\n### Heading three\n\n**bold text**\n\n- first item\n- second item\n\n1. ordered one\n\n`inline code`',
    );

    expect(container.querySelector('h2')?.textContent).toContain('Heading two');
    expect(container.querySelector('h3')?.textContent).toContain('Heading three');
    expect(container.querySelector('strong')?.textContent).toContain('bold text');
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('code')?.textContent).toContain('inline code');
  });

  it('renders a mermaid fence without throwing', async () => {
    const container = await renderWithMarkdown('# Chart\n\n```mermaid\ngraph TD;\nA-->B;\n```\n');

    expect(container.textContent).toContain('Chart');
  });
});

describe('artifact preview source', () => {
  it('no longer hand-rolls markdown through dangerouslySetInnerHTML', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'renderer', 'src', 'components', 'projects', 'ArtifactPreviewModal.tsx'),
      'utf-8',
    );

    expect(source).not.toContain('renderMarkdown');
    // The HTML branch legitimately uses an iframe srcDoc; only the markdown
    // branch must stop injecting raw HTML into the top-level document.
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
});
