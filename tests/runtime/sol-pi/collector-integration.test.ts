import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadTool } from '../../../src/ai/tools/read.js';
import { bashTool } from '../../../src/ai/tools/bash.js';
import { mcpTestContext } from '../../support/mcp-cancellation-context.js';

describe('production read/bash pre-cap observation collector', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
  const fixture = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'solpi-collector-')); roots.push(cwd);
    const texts: string[] = [];
    const finalize = vi.fn(); const append = vi.fn((text: string) => texts.push(text));
    const begin = vi.fn(() => ({ append, finalize }));
    const context = { ...mcpTestContext(new AbortController().signal), observationCollector: { begin } };
    return { cwd, texts, finalize, append, begin, context };
  };
  it('read collects requested selected lines before max_chars, excluding unrequested lines', async () => {
    const f = fixture(); const path = join(f.cwd, 'log.txt');
    writeFileSync(path, 'UNREQUESTED\n' + 'x'.repeat(1000) + '\nTAIL_SELECTED\nUNREQUESTED_END');
    const output = await createReadTool({ cwd: f.cwd }).execute({ file_path: path, offset: 2, limit: 2, max_chars: 80 }, f.context);
    expect(output).not.toContain('TAIL_SELECTED');
    expect(f.texts.join('')).toContain('TAIL_SELECTED'); expect(f.texts.join('')).not.toContain('UNREQUESTED');
    expect(f.begin).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'read', source: { filePath: path, offset: 2, limit: 2 } }));
    expect(f.finalize).toHaveBeenCalledWith({ executionState: 'terminal', outcome: 'success' });
  });
  it('sensitive read and blocked bash never begin capture', async () => {
    const f = fixture(); const path = join(f.cwd, '.env'); writeFileSync(path, 'SECRET');
    await createReadTool({ cwd: f.cwd }).execute({ file_path: path }, f.context);
    await bashTool.execute({ command: 'sudo echo forbidden', workdir: f.cwd }, f.context);
    expect(f.begin).not.toHaveBeenCalled();
  });
  it('real bash captures beyond preview cap and records completed error separately', async () => {
    const f = fixture();
    const output = await bashTool.execute({ command: "printf '%05000dTAIL' 0; exit 2", workdir: f.cwd, max_chars: 80 }, f.context);
    expect(output).toContain('Error (exit 2)'); expect(output).not.toContain('TAIL');
    expect(f.texts.join('')).toContain('TAIL');
    expect(f.finalize).toHaveBeenCalledWith({ executionState: 'terminal', outcome: 'error' });
  });
  it('timeout remains incomplete even when the killed process closes', async () => {
    const f = fixture();
    await bashTool.execute({ command: 'printf partial; sleep 5', workdir: f.cwd, timeout_ms: 30 }, f.context);
    expect(f.finalize).toHaveBeenCalledWith({ executionState: 'terminal', outcome: 'timeout', incompleteReason: 'timeout' });
  });
  it('collector append failure does not replay or change tool outcome', async () => {
    const f = fixture(); f.append.mockImplementation(() => { throw new Error('private backend detail'); });
    const output = await bashTool.execute({ command: 'printf once', workdir: f.cwd }, f.context);
    expect(output).toBe('once'); expect(output).not.toContain('private');
    expect(f.finalize).toHaveBeenCalledWith(expect.objectContaining({ incompleteReason: 'collector_unavailable' }));
  });
  it('decodes split UTF-8 independently on actual stdout and stderr pipes', async () => {
    const f = fixture();
    await bashTool.execute({ command: "printf '\\344'; printf '\\345' >&2; sleep 0.03; printf '\\275\\240'; printf '\\245\\275' >&2", workdir: f.cwd }, f.context);
    const collected = f.texts.join('');
    expect(collected).toContain('你'); expect(collected).toContain('好'); expect(collected).not.toContain('\uFFFD');
    expect(f.finalize).toHaveBeenCalledWith({ executionState: 'terminal', outcome: 'success' });
  });
});
