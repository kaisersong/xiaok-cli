import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InputReader } from '../../src/ui/input.js';
import type { TranscriptLogger } from '../../src/ui/transcript.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { createTtyHarness } from '../support/tty.js';
import { clearPastedImagePaths, parseInputBlocks } from '../../src/ui/image-input.js';

const tempDirs: string[] = [];

describe('InputReader busy capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearPastedImagePaths();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('queues a busy draft without resolving a normal read', () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    const frames: Array<{ inputValue: string; overlayLines: string[]; overlayKind?: string }> = [];
    reader.setStatusLineProvider(() => ['  model · 0% · project']);
    reader.setScrollPromptRenderer((frame) => {
      frames.push({
        inputValue: frame.inputValue,
        overlayLines: frame.overlayLines,
        overlayKind: frame.overlayKind,
      });
      return true;
    });

    try {
      const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
      harness.send('更新了没');
      harness.send('\r');

      expect(capture.getSnapshot().queued?.text).toBe('更新了没');
      expect(capture.getSnapshot().draft).toBe('');
      expect(frames.at(-1)).toMatchObject({
        inputValue: '',
        overlayKind: 'queued',
      });
      expect(frames.at(-1)?.overlayLines.join('\n')).toContain('Queued (press ↑ to edit):');
      expect(frames.at(-1)?.overlayLines.join('\n')).toContain('更新了没');

      capture.stop();
    } finally {
      harness.restore();
    }
  });

  it('edits and replaces the single queued slot', () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));

    try {
      const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
      harness.send('第一条');
      harness.send('\r');
      harness.send('\x1b[A');
      harness.send('\x15');
      harness.send('第二条');
      harness.send('\r');

      expect(capture.consumeQueued()).toBe('第二条');
      expect(capture.consumeQueued()).toBeNull();
      capture.stop();
    } finally {
      harness.restore();
    }
  });

  it('pauses busy capture while read owns stdin and resumes afterward', async () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));

    try {
      const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
      harness.send('排队前');

      const pending = reader.read('> ');
      harness.send('prompt answer');
      harness.send('\r');
      await expect(pending).resolves.toBe('prompt answer');

      harness.send('继续排队');
      harness.send('\r');

      expect(capture.consumeQueued()).toBe('排队前继续排队');
      capture.stop();
      expect(harness.emitter.listenerCount('data')).toBe(0);
    } finally {
      harness.restore();
    }
  });

  it('records semantic queue transcript events without per-key queue events', () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    const events: Array<Record<string, unknown>> = [];
    const logger: TranscriptLogger = {
      record(event) {
        events.push(event as Record<string, unknown>);
      },
      recordOutput() {},
    };
    reader.setTranscriptLogger(logger);

    try {
      const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
      harness.send('A');
      harness.send('\r');
      harness.send('B');
      harness.send('\r');

      expect(events.map((event) => event.type)).toContain('input_queue_submit');
      expect(events.map((event) => event.type)).toContain('input_queue_replace');
      expect(events.map((event) => event.type)).not.toContain('input_queue_draft_key');
      capture.stop();
    } finally {
      harness.restore();
    }
  });

  it('queues OSC 1337 pasted image placeholders while busy', async () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));

    try {
      const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
      const imageBytes = Buffer.from('png-bytes').toString('base64');
      harness.send(`\x1b]1337;File=name=${Buffer.from('pasted.png').toString('base64')};inline=1:${imageBytes}\x07`);
      harness.send('文字');

      expect(capture.getSnapshot().draft).toBe('[image 0]文字');
      harness.send('\r');

      const queued = capture.consumeQueued();
      expect(queued).toBe('[image 0]文字');
      const blocks = await parseInputBlocks(queued ?? '', true);
      expect(blocks[0]).toMatchObject({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
        },
      });
      expect(blocks[1]).toEqual({ type: 'text', text: '文字' });
      capture.stop();
    } finally {
      harness.restore();
    }
  });

  it('imports a clipboard image placeholder while busy', async () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    const imageDir = mkdtempSync(join(tmpdir(), 'xiaok-busy-image-input-'));
    tempDirs.push(imageDir);
    const imagePath = join(imageDir, 'clipboard.png');
    writeFileSync(imagePath, Buffer.from('png-bytes'));
    reader.setClipboardImageSaver(() => imagePath);

    try {
      const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
      harness.send('\x16');
      harness.send(' explain this');

      expect(capture.getSnapshot().draft).toBe('[image 0] explain this');
      harness.send('\r');

      const queued = capture.consumeQueued();
      expect(queued).toBe('[image 0] explain this');
      const blocks = await parseInputBlocks(queued ?? '', true);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
        },
      });
      expect(blocks[1]).toEqual({ type: 'text', text: 'explain this' });
      capture.stop();
    } finally {
      harness.restore();
    }
  });
});
