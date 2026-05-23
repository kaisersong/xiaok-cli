import { describe, expect, it, vi } from 'vitest';
import { createInputEngine, type InputEngineSnapshot } from '../../src/ui/input-engine.js';
import type { InputPasteController } from '../../src/ui/input-paste.js';

function createPasteController(placeholder: string | null = null): InputPasteController {
  return {
    handleChunk: vi.fn(() => ({ handled: false })),
    importClipboardImage: vi.fn(() => placeholder),
  };
}

describe('input engine', () => {
  it('mutates draft for printable text chunks', () => {
    const changes: InputEngineSnapshot[] = [];
    const engine = createInputEngine({
      pasteController: createPasteController(),
      policy: {
        onSubmit: () => {},
        onCancel: () => {},
        onChange: (snapshot) => changes.push(snapshot),
      },
    });

    expect(engine.handleChunk('abc')).toBe(true);

    expect(engine.getSnapshot()).toEqual({ draft: 'abc', cursor: 3 });
    expect(changes.at(-1)).toEqual({ draft: 'abc', cursor: 3 });
  });

  it('imports clipboard images through the paste controller', () => {
    const pasteController = createPasteController('[image 0]');
    const engine = createInputEngine({
      pasteController,
      policy: {
        onSubmit: () => {},
        onCancel: () => {},
        onChange: () => {},
      },
    });

    expect(engine.handleChunk('\x16')).toBe(true);

    expect(pasteController.importClipboardImage).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot()).toEqual({ draft: '[image 0]', cursor: 9 });
  });

  it('submits the current draft on Enter', () => {
    const submitted: string[] = [];
    const engine = createInputEngine({
      initialSnapshot: { draft: 'run it', cursor: 6 },
      pasteController: createPasteController(),
      policy: {
        onSubmit: (text) => submitted.push(text),
        onCancel: () => {},
        onChange: () => {},
      },
    });

    expect(engine.handleChunk('\r')).toBe(true);

    expect(submitted).toEqual(['run it']);
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    const engine = createInputEngine({
      pasteController: createPasteController(),
      policy: {
        onSubmit: () => {},
        onCancel,
        onChange: () => {},
      },
    });

    expect(engine.handleChunk('\x1b')).toBe(true);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('leaves policy-disabled slash menu actions to the caller', () => {
    const engine = createInputEngine({
      pasteController: createPasteController(),
      policy: {
        allowSlashMenu: false,
        onSubmit: () => {},
        onCancel: () => {},
        onChange: () => {},
      },
    });

    expect(engine.handleChunk('\t')).toBe(false);
    expect(engine.getSnapshot()).toEqual({ draft: '', cursor: 0 });
  });
});
