import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderInputSeparator, renderInputPrompt } from '../../src/ui/render.js';

describe('renderInputSeparator', () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
  });

  afterEach(() => {
    if (originalColumns !== undefined) {
      process.stdout.columns = originalColumns;
    }
  });

  it('should render separator with correct width for small terminal', () => {
    process.stdout.columns = 60;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputSeparator();

    process.stdout.write = originalWrite;

    // Width should be min(60 - 2, 100) = 58
    // Should contain 58 dashes plus newline
    expect(output).toContain('─'.repeat(58));
    expect(output).toMatch(/\n$/);
  });

  it('should render separator with correct width for large terminal', () => {
    process.stdout.columns = 120;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputSeparator();

    process.stdout.write = originalWrite;

    // Width should be min(120 - 2, 100) = 100
    expect(output).toContain('─'.repeat(100));
  });

  it('should cap separator width at 100', () => {
    process.stdout.columns = 200;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputSeparator();

    process.stdout.write = originalWrite;

    // Width should be capped at 100
    expect(output).toContain('─'.repeat(100));
    expect(output).not.toContain('─'.repeat(101));
  });
});

describe('renderInputPrompt', () => {
  it('should render only prompt without separator', () => {
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    renderInputPrompt();

    process.stdout.write = originalWrite;

    // Should only contain the > prompt, not the separator
    expect(output).toContain('>');
    expect(output).not.toContain('─');
    // Should NOT end with newline
    expect(output).not.toMatch(/\n$/);
  });
});
