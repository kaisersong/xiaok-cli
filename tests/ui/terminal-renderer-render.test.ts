import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import type { SurfaceState } from '../../src/ui/surface-state.js';

describe('TerminalRenderer', () => {
  let mockStream: { write: ReturnType<typeof vi.fn> };
  let renderer: TerminalRenderer;

  beforeEach(() => {
    mockStream = { write: vi.fn() };
    renderer = new TerminalRenderer(mockStream as unknown as NodeJS.WriteStream);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears the line before rendering when previousLineCount = 0', () => {
    const state: SurfaceState = {
      prompt: '> ',
      transcript: [],
      input: { value: 'test', cursorOffset: 4, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    };

    // First render (previousLineCount = 0)
    renderer.render(state);

    // Check that the first write is '\r' followed by '\x1b[2K' (clear line)
    const writes = mockStream.write.mock.calls.map(c => c[0]);

    // The first writes should be: '\r' (move to line start), '\x1b[2K' (clear line)
    expect(writes[0]).toBe('\r');
    expect(writes[1]).toBe('\x1b[2K');

    // The line should contain the input with background
    const lineWrites = writes.filter(w => w.includes('❯') || w.includes('test'));
    expect(lineWrites.length).toBeGreaterThan(0);
  });

  it('renders cursor at correct position for empty input', () => {
    const state: SurfaceState = {
      prompt: '> ',
      transcript: [],
      input: { value: '', cursorOffset: 0, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    };

    renderer.render(state);

    const writes = mockStream.write.mock.calls.map(c => c[0]);

    // Cursor should be positioned at column 2 (after "❯ ")
    // Look for cursor positioning sequence: '\x1b[2C' (move 2 columns right)
    expect(writes.some(w => w === '\x1b[2C')).toBe(true);
  });

  it('properly clears previous content before rendering new content', () => {
    // Simulate a render -> clearAll -> render cycle
    const state1: SurfaceState = {
      prompt: '> ',
      transcript: [],
      input: { value: 'old content', cursorOffset: 12, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    };

    const state2: SurfaceState = {
      prompt: '> ',
      transcript: [],
      input: { value: '', cursorOffset: 0, history: [] },
      overlay: null,
      modal: null,
      focusTarget: 'input',
      terminalSize: { columns: 80, rows: 24 },
    };

    // First render
    renderer.render(state1);
    mockStream.write.mockClear();

    // clearAll
    renderer.clearAll();
    mockStream.write.mockClear();

    // Second render (previousLineCount = 0 after clearAll)
    renderer.render(state2);

    const writes = mockStream.write.mock.calls.map(c => c[0]);

    // First write should be '\r', then clear the line
    expect(writes[0]).toBe('\r');
    expect(writes[1]).toBe('\x1b[2K');

    // Should render empty input (no "old content")
    const oldContentWrites = writes.filter(w => w.includes('old content'));
    expect(oldContentWrites.length).toBe(0);
  });
});