import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLspManager } from '../../../src/platform/lsp/manager.js';

describe('lsp manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures diagnostics summaries by uri', () => {
    const manager = createLspManager();

    manager.applyMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [{ severity: 1, message: 'Type error' }],
      },
    });

    expect(manager.getDiagnostics('file:///repo/src/app.ts')).toEqual([
      expect.objectContaining({ message: 'Type error' }),
    ]);
    expect(manager.getSummary()).toContain('Type error');
  });

  it('returns sentinel string when no diagnostics have been applied', () => {
    const manager = createLspManager();
    expect(manager.getSummary()).toBe('[LSP: no diagnostics yet]');
  });

  it('appends staleness marker after diagnostics applied', () => {
    const manager = createLspManager();
    manager.applyMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [{ severity: 1, message: 'Type error' }],
      },
    });

    const summary = manager.getSummary();
    expect(summary).toContain('Type error');
    expect(summary).toMatch(/\[LSP last updated: just now\]$/);
  });

  it('reports 5 minutes old age when called later', () => {
    const manager = createLspManager();
    manager.applyMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [{ severity: 1, message: 'Type error' }],
      },
    });

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(manager.getSummary()).toMatch(/\[LSP last updated: 5m ago\]$/);
  });

  it('uses the latest applyMessage timestamp for staleness', () => {
    const manager = createLspManager();
    manager.applyMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/app.ts',
        diagnostics: [{ severity: 1, message: 'Old error' }],
      },
    });

    vi.advanceTimersByTime(10 * 60 * 1000);

    manager.applyMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: 'file:///repo/src/other.ts',
        diagnostics: [{ severity: 1, message: 'New error' }],
      },
    });

    vi.advanceTimersByTime(30 * 1000);
    expect(manager.getSummary()).toMatch(/\[LSP last updated: 30s ago\]$/);
  });
});
