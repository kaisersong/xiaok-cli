import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatInput } from '../../renderer/src/components/ChatInput';

vi.mock('../../renderer/src/api', () => ({
  api: {
    listSkills: vi.fn().mockResolvedValue([]),
    selectMaterials: vi.fn(),
  },
}));

function installClipboardApi(overrides: {
  readClipboardFilePaths?: () => Promise<string[]>;
  readClipboardImage?: () => Promise<string | null>;
}) {
  (window as unknown as { xiaokDesktop?: unknown }).xiaokDesktop = {
    readClipboardFilePaths: vi.fn(overrides.readClipboardFilePaths ?? (() => Promise.resolve([]))),
    readClipboardImage: vi.fn(overrides.readClipboardImage ?? (() => Promise.resolve(null))),
  };
}

function pasteClipboard(
  target: HTMLElement,
  options: {
    items: Array<{ kind: string; type: string }>;
    text?: string;
  }
) {
  const event = createEvent.paste(target, {
    clipboardData: {
      items: options.items,
      getData: (type: string) => (type === 'text/plain' ? options.text ?? '' : ''),
    },
  });
  fireEvent(target, event);
  return event;
}

describe('ChatInput clipboard attachments', () => {
  beforeEach(() => {
    installClipboardApi({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { xiaokDesktop?: unknown }).xiaokDesktop;
  });

  it('does not turn a Finder-copied image file preview into a screenshot attachment', async () => {
    const readClipboardFilePaths = vi.fn().mockResolvedValue(['/tmp/photo.png']);
    const readClipboardImage = vi.fn().mockResolvedValue('/tmp/screenshot.png');
    installClipboardApi({ readClipboardFilePaths, readClipboardImage });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'v', metaKey: true });
    const pasteEvent = pasteClipboard(input, {
      items: [{ kind: 'file', type: 'image/tiff' }],
    });

    expect(await screen.findByAltText('photo.png')).toBeInTheDocument();
    expect(screen.queryByAltText('screenshot.png')).not.toBeInTheDocument();
    expect(screen.getAllByAltText('photo.png')).toHaveLength(1);
    expect(readClipboardImage).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it('still attaches a raw clipboard screenshot when Cmd+V has no file paths', async () => {
    const readClipboardFilePaths = vi.fn().mockResolvedValue([]);
    const readClipboardImage = vi.fn().mockResolvedValue('/tmp/clipboard-image.png');
    installClipboardApi({ readClipboardFilePaths, readClipboardImage });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'v', metaKey: true });
    const pasteEvent = pasteClipboard(input, {
      items: [{ kind: 'file', type: 'image/png' }],
    });

    expect(await screen.findByAltText('clipboard-image.png')).toBeInTheDocument();
    expect(readClipboardFilePaths).toHaveBeenCalledTimes(1);
    expect(readClipboardImage).toHaveBeenCalledTimes(1);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(input).toHaveValue('');
  });

  it('keeps file-item paste working when no Cmd+V keydown preflight ran first', async () => {
    const readClipboardFilePaths = vi.fn().mockResolvedValue(['C:\\Users\\song\\Desktop\\spec.pdf']);
    installClipboardApi({ readClipboardFilePaths });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    const pasteEvent = pasteClipboard(input, {
      items: [{ kind: 'file', type: 'application/pdf' }],
    });

    expect(await screen.findByText('spec.pdf')).toBeInTheDocument();
    await waitFor(() => expect(readClipboardFilePaths).toHaveBeenCalledTimes(1));
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it('handles Windows Ctrl+V Explorer file copies even when Chromium exposes no file item', async () => {
    const readClipboardFilePaths = vi.fn().mockResolvedValue(['C:\\Users\\song\\Desktop\\photo.png']);
    const readClipboardImage = vi.fn().mockResolvedValue('C:\\Users\\song\\AppData\\Local\\Temp\\clipboard.png');
    installClipboardApi({ readClipboardFilePaths, readClipboardImage });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'v', ctrlKey: true });
    const pasteEvent = pasteClipboard(input, { items: [] });

    expect(await screen.findByAltText('photo.png')).toBeInTheDocument();
    expect(screen.queryByAltText('clipboard.png')).not.toBeInTheDocument();
    expect(screen.getAllByAltText('photo.png')).toHaveLength(1);
    expect(readClipboardFilePaths).toHaveBeenCalledTimes(1);
    expect(readClipboardImage).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it('handles Windows Ctrl+V raw image clipboard when Chromium exposes no paste item', async () => {
    const readClipboardFilePaths = vi.fn().mockResolvedValue([]);
    const readClipboardImage = vi.fn().mockResolvedValue('C:\\Users\\song\\AppData\\Local\\Temp\\clipboard-image.png');
    installClipboardApi({ readClipboardFilePaths, readClipboardImage });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'v', ctrlKey: true });
    const pasteEvent = pasteClipboard(input, { items: [] });

    expect(await screen.findByAltText('clipboard-image.png')).toBeInTheDocument();
    expect(readClipboardFilePaths).toHaveBeenCalledTimes(1);
    expect(readClipboardImage).toHaveBeenCalledTimes(1);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(input).toHaveValue('');
  });

  it('turns pasted Windows path text into a file chip instead of draft text', async () => {
    installClipboardApi({ readClipboardFilePaths: () => Promise.resolve([]) });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    pasteClipboard(input, {
      items: [{ kind: 'string', type: 'text/plain' }],
      text: '"C:\\Users\\song\\Desktop\\brief.txt"',
    });
    fireEvent.change(input, { target: { value: '"C:\\Users\\song\\Desktop\\brief.txt"' } });

    expect(await screen.findByText('brief.txt')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('falls back to raw image paste when a context-menu file-item paste has no file paths', async () => {
    const readClipboardFilePaths = vi.fn().mockResolvedValue([]);
    const readClipboardImage = vi.fn().mockResolvedValue('/tmp/context-menu-image.png');
    installClipboardApi({ readClipboardFilePaths, readClipboardImage });

    render(<ChatInput onSubmit={() => {}} />);
    const input = screen.getByRole('textbox');

    const pasteEvent = pasteClipboard(input, {
      items: [{ kind: 'file', type: 'image/png' }],
    });

    expect(await screen.findByAltText('context-menu-image.png')).toBeInTheDocument();
    await waitFor(() => expect(readClipboardFilePaths).toHaveBeenCalledTimes(1));
    expect(readClipboardImage).toHaveBeenCalledTimes(1);
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(input).toHaveValue('');
  });
});
