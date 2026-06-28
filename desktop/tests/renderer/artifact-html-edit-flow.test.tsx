import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const { mockSaveFile, mockSelectHtmlEditMedia } = vi.hoisted(() => ({
  mockSaveFile: vi.fn(async () => ({ success: true })),
  mockSelectHtmlEditMedia: vi.fn(),
}));

vi.mock('../../renderer/src/shared/desktop', () => ({
  getDesktopApi: () => ({
    saveFile: mockSaveFile,
    selectHtmlEditMedia: mockSelectHtmlEditMedia,
  }),
}));

import { ArtifactEditableViewer } from '../../renderer/src/components/ArtifactEditableViewer';

describe('ArtifactEditableViewer HTML edit flow', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:artifact-viewer-test'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockSelectHtmlEditMedia.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockSaveFile.mockClear();
    mockSelectHtmlEditMedia.mockReset();
  });

  it('shows direct edit before revision in the toolbar', () => {
    const { container } = render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h1>Old</h1></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    const toolbar = container.querySelector('.artifact-toolbar');
    expect(toolbar).not.toBeNull();
    const buttons = within(toolbar as HTMLElement).getAllByRole('button');
    expect(buttons[0]).toHaveTextContent(/直接编辑|Edit HTML/i);
    expect(buttons[1]).toHaveTextContent(/修订|Revise/i);
  });

  it('starts in HTML edit mode when requested by the artifact card shortcut', () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h1>Old</h1></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          editModeRequest={{ id: 1, startInEditMode: true }}
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole('button', { name: /退出编辑|Stop editing/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/HTML 编辑|HTML edit/i)).toBeInTheDocument();
    expect(screen.getByText(/选择预览中的文字或链接|Select text or a link/i)).toBeInTheDocument();
  });

  it('edits selected text, saves through html-edit saveFile purpose, and keeps runtime ids out of source', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><head><title>R</title></head><body><h1>Old</h1><a href=&quot;/old&quot;>Old link</a></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
          onRefresh={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'h1-1',
          kind: 'text',
          tagName: 'h1',
          selector: 'h1',
          text: 'Old',
          outerHtml: '<h1>Old</h1>',
          sourceOccurrence: 0,
        },
      },
    }));

    const textarea = await screen.findByLabelText(/文本内容|Text content/i);
    fireEvent.change(textarea, { target: { value: 'New <Title>' } });
    fireEvent.click(screen.getByRole('button', { name: /^(应用|Apply)$/i }));
    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    const saved = mockSaveFile.mock.calls[0][0] as { filePath: string; content: string; purpose?: string };
    expect(saved.filePath).toBe('/tmp/xiaok/tasks/report.html');
    expect(saved.purpose).toBe('html-edit');
    expect(saved.content).toContain('<h1>New &lt;Title&gt;</h1>');
    expect(saved.content).toContain('name="xk-manual-edit"');
    expect(saved.content).not.toContain('data-xk-edit-id');
  });

  it('applies selected text when the browser outerHTML does not exactly match the file source', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent={[
            '<html><head><title>R</title></head><body>',
            '<section data-summary="Old summary">',
            '<p data-kind="intro" class="fade-in-up">Old summary</p>',
            '</section>',
            '</body></html>',
          ].join('')}
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
          onRefresh={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'p-1',
          kind: 'text',
          tagName: 'p',
          selector: 'section > p:nth-of-type(1)',
          text: 'Old summary',
          outerHtml: '<p class="fade-in-up" data-kind="intro">Old summary</p>',
          sourceOccurrence: 0,
        },
      },
    }));

    fireEvent.change(await screen.findByLabelText(/文本内容|Text content/i), { target: { value: 'New summary' } });
    fireEvent.click(screen.getByRole('button', { name: /^(应用|Apply)$/i }));

    expect(screen.queryByText(/保存失败|Save failed/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));
    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    const saved = mockSaveFile.mock.calls[0][0] as { content: string; purpose?: string };
    expect(saved.purpose).toBe('html-edit');
    expect(saved.content).toContain('<p data-kind="intro" class="fade-in-up">New summary</p>');
    expect(saved.content).toContain('data-summary="Old summary"');
  });

  it('shows an apply-specific error instead of a save permissions error when the selected source cannot be patched', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h1>Actual title</h1></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
          onRefresh={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'missing-h1',
          kind: 'text',
          tagName: 'h1',
          selector: 'h1',
          text: 'Old title',
          outerHtml: '<h1>Old title</h1>',
          sourceOccurrence: 0,
        },
      },
    }));

    fireEvent.change(await screen.findByLabelText(/文本内容|Text content/i), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: /^(应用|Apply)$/i }));

    expect(await screen.findByText(/应用失败|Could not apply/i)).toBeInTheDocument();
    expect(screen.queryByText(/保存失败|Save failed/i)).not.toBeInTheDocument();
    expect(mockSaveFile).not.toHaveBeenCalled();
  });

  it('blocks mode switches when dirty edits are not confirmed', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h1>Old</h1></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'h1-1',
          kind: 'text',
          tagName: 'h1',
          selector: 'h1',
          text: 'Old',
          outerHtml: '<h1>Old</h1>',
          sourceOccurrence: 0,
        },
      },
    }));

    fireEvent.change(await screen.findByLabelText(/文本内容|Text content/i), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: /^(应用|Apply)$/i }));
    fireEvent.click(screen.getByRole('button', { name: /修订|Revise/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText(/文本内容|Text content/i)).toBeInTheDocument();
  });

  it('deletes the selected component and saves the updated html', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><section><h2>Keep</h2></section><section><h2>Remove me</h2></section></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'section-2',
          kind: 'text',
          tagName: 'section',
          selector: 'body > section:nth-of-type(2)',
          text: 'Remove me',
          outerHtml: '<section><h2>Remove me</h2></section>',
          sourceOccurrence: 0,
        },
      },
    }));

    fireEvent.click(await screen.findByRole('button', { name: /删除组件|Delete component/i }));
    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    const saved = mockSaveFile.mock.calls[0][0] as { content: string; purpose?: string };
    expect(saved.purpose).toBe('html-edit');
    expect(saved.content).toContain('<section><h2>Keep</h2></section>');
    expect(saved.content).not.toContain('Remove me');
  });

  it('applies text style controls to the selected component before saving', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h2 style=&quot;margin:0&quot;>Title</h2></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'h2-1',
          kind: 'text',
          tagName: 'h2',
          selector: 'h2',
          text: 'Title',
          outerHtml: '<h2 style="margin:0">Title</h2>',
          sourceOccurrence: 0,
        },
      },
    }));

    fireEvent.change(await screen.findByLabelText(/文字颜色|Text color/i), { target: { value: '#e11d48' } });
    fireEvent.change(screen.getByLabelText(/字号|Font size/i), { target: { value: '28px' } });
    fireEvent.change(screen.getByLabelText(/字体|Font family/i), { target: { value: 'Inter' } });
    fireEvent.change(screen.getByLabelText(/粗细|Font weight/i), { target: { value: '700' } });
    fireEvent.click(screen.getByRole('button', { name: /应用样式|Apply style/i }));
    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    const saved = mockSaveFile.mock.calls[0][0] as { content: string };
    expect(saved.content).toContain('color: #e11d48');
    expect(saved.content).toContain('font-size: 28px');
    expect(saved.content).toContain('font-family: Inter');
    expect(saved.content).toContain('font-weight: 700');
  });

  it('inserts image and svg blocks after the selected component', async () => {
    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h2>Media anchor</h2><p>Next</p></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'h2-1',
          kind: 'text',
          tagName: 'h2',
          selector: 'h2',
          text: 'Media anchor',
          outerHtml: '<h2>Media anchor</h2>',
          sourceOccurrence: 0,
        },
      },
    }));

    fireEvent.change(await screen.findByLabelText(/图片地址|Image URL/i), { target: { value: 'https://example.com/chart.png' } });
    fireEvent.change(screen.getByLabelText(/图片说明|Image alt/i), { target: { value: 'Chart' } });
    fireEvent.click(screen.getByRole('button', { name: /插入图片|Insert image/i }));
    fireEvent.change(screen.getByLabelText(/SVG 源码|SVG source/i), { target: { value: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' } });
    fireEvent.click(screen.getByRole('button', { name: /插入 SVG|Insert SVG/i }));
    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    const saved = mockSaveFile.mock.calls[0][0] as { content: string };
    expect(saved.content).toContain('<figure class="xk-inserted-image">');
    expect(saved.content).toContain('src="https://example.com/chart.png"');
    expect(saved.content).toContain('<figure class="xk-inserted-svg">');
    expect(saved.content).toContain('<circle cx="5" cy="5" r="4"/>');
  });

  it('selects local image and svg files before inserting media blocks', async () => {
    mockSelectHtmlEditMedia
      .mockResolvedValueOnce({
        canceled: false,
        filePath: '/Users/song/Pictures/chart.png',
        content: 'data:image/png;base64,QUJD',
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePath: '/Users/song/Pictures/icon.svg',
        content: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
      });

    render(
      <LocaleProvider>
        <ArtifactEditableViewer
          htmlContent="<html><body><h2>Media anchor</h2><p>Next</p></body></html>"
          filePath="/tmp/xiaok/tasks/report.html"
          onAnnotation={vi.fn()}
          onRevert={vi.fn()}
          onFinish={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /直接编辑|Edit HTML/i }));
    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'xiaok:editSelect',
        payload: {
          id: 'h2-1',
          kind: 'text',
          tagName: 'h2',
          selector: 'h2',
          text: 'Media anchor',
          outerHtml: '<h2>Media anchor</h2>',
          sourceOccurrence: 0,
        },
      },
    }));

    const chooseImageButton = await screen.findByRole('button', { name: /选择本地图片|Choose image file/i });
    const insertImageButton = screen.getByRole('button', { name: /^插入图片$|^Insert image$/i });
    const chooseSvgButton = screen.getByRole('button', { name: /选择 SVG 文件|Choose SVG file/i });
    const insertSvgButton = screen.getByRole('button', { name: /^插入 SVG$|^Insert SVG$/i });

    expect(chooseImageButton).toHaveClass('html-edit-media-button');
    expect(insertImageButton).toHaveClass('html-edit-media-button');
    expect(chooseSvgButton).toHaveClass('html-edit-media-button');
    expect(insertSvgButton).toHaveClass('html-edit-media-button');

    fireEvent.click(chooseImageButton);
    await waitFor(() => expect(mockSelectHtmlEditMedia).toHaveBeenCalledWith({ kind: 'image' }));
    expect(await screen.findByDisplayValue('data:image/png;base64,QUJD')).toBeInTheDocument();
    fireEvent.click(insertImageButton);

    fireEvent.click(chooseSvgButton);
    await waitFor(() => expect(mockSelectHtmlEditMedia).toHaveBeenCalledWith({ kind: 'svg' }));
    expect(await screen.findByDisplayValue('<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>')).toBeInTheDocument();
    fireEvent.click(insertSvgButton);

    fireEvent.click(screen.getByRole('button', { name: /保存|Save/i }));

    await waitFor(() => expect(mockSaveFile).toHaveBeenCalledTimes(1));
    const saved = mockSaveFile.mock.calls[0][0] as { content: string };
    expect(saved.content).toContain('src="data:image/png;base64,QUJD"');
    expect(saved.content).toContain('<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>');
  });
});
