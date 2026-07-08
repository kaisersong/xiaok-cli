import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  endStreamingPhaseForInterruptInOrder,
  renderFooterChromeInOrder,
  type TerminalStreamingFooterState,
} from '../../src/commands/chat/terminal-streaming-boundary.js';

const footerState: TerminalStreamingFooterState = {
  inputPrompt: 'Type your message...',
  summaryLine: 'summary',
  statusLine: 'status',
};

describe('terminal streaming boundary ordering', () => {
  it('ends content streaming before preparing input and starts a fresh markdown segment', () => {
    const calls: string[] = [];

    renderFooterChromeInOrder({
      scrollRegion: {
        isActive: () => true,
        isContentStreaming: () => true,
        endContentStreaming: (options) => {
          calls.push(`endContentStreaming:${options.inputPrompt}`);
        },
        renderFooter: () => {
          calls.push('renderFooter');
        },
      },
      replRenderer: {
        prepareForInput: () => {
          calls.push('prepareForInput');
        },
      },
      mdRenderer: {
        beginNewSegment: () => {
          calls.push('beginNewSegment');
        },
      },
    }, footerState);

    expect(calls).toEqual([
      'endContentStreaming:Type your message...',
      'beginNewSegment',
      'prepareForInput',
    ]);
  });

  it('renders the footer without starting a markdown segment when content is not streaming', () => {
    const calls: string[] = [];

    renderFooterChromeInOrder({
      scrollRegion: {
        isActive: () => true,
        isContentStreaming: () => false,
        endContentStreaming: () => {
          calls.push('endContentStreaming');
        },
        renderFooter: (options) => {
          calls.push(`renderFooter:${options.statusLine}`);
        },
      },
      replRenderer: {
        prepareForInput: () => {
          calls.push('prepareForInput');
        },
      },
      mdRenderer: {
        beginNewSegment: () => {
          calls.push('beginNewSegment');
        },
      },
    }, footerState);

    expect(calls).toEqual([
      'renderFooter:status',
      'prepareForInput',
    ]);
  });

  it('does nothing when the scroll region is inactive', () => {
    const calls: string[] = [];

    renderFooterChromeInOrder({
      scrollRegion: {
        isActive: () => false,
        isContentStreaming: () => {
          calls.push('isContentStreaming');
          return true;
        },
        endContentStreaming: () => {
          calls.push('endContentStreaming');
        },
        renderFooter: () => {
          calls.push('renderFooter');
        },
      },
      replRenderer: {
        prepareForInput: () => {
          calls.push('prepareForInput');
        },
      },
      mdRenderer: {
        beginNewSegment: () => {
          calls.push('beginNewSegment');
        },
      },
    }, footerState);

    expect(calls).toEqual([]);
  });

  it('enters tool interrupt before ending content streaming and starting a fresh segment', () => {
    const calls: string[] = [];

    endStreamingPhaseForInterruptInOrder({
      scrollRegion: {
        isActive: () => true,
        isContentStreaming: () => true,
        endContentStreaming: (options) => {
          calls.push(`endContentStreaming:${options.summaryLine}`);
        },
      },
      runtimeState: {
        enterToolInterrupt: () => {
          calls.push('enterToolInterrupt');
        },
      },
      mdRenderer: {
        beginNewSegment: () => {
          calls.push('beginNewSegment');
        },
      },
    }, footerState);

    expect(calls).toEqual([
      'enterToolInterrupt',
      'endContentStreaming:summary',
      'beginNewSegment',
    ]);
  });

  it('keeps flush and reset ownership out of the helper module', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'commands', 'chat', 'terminal-streaming-boundary.ts'),
      'utf8',
    );

    expect(source).not.toContain('flushStreamingMarkdown');
    expect(source).not.toContain('resetStreamingSegment');
    expect(source).not.toContain('getFooterInputPrompt');
    expect(source).not.toContain('getCurrentIntentSummaryLine');
    expect(source).not.toContain('statusBar');
    expect(source).not.toContain('suspendInteractiveUi');
  });
});
