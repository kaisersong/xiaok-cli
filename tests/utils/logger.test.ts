import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/utils/logger.js';
import * as fs from 'node:fs';
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  appendFileSync: vi.fn(),
  existsSync: () => true,
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('logger output sinks', () => {
  it('file-only logger and its children never write to a broken stderr', () => {
    vi.stubEnv('XIAOK_CONFIG_DIR', process.cwd());
    const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('EPIPE'); });
    const logger = createLogger('pty-test', { stderr: false });
    expect(() => logger.error('node-pty unavailable')).not.toThrow();
    expect(() => logger.child('load').warn('original cause')).not.toThrow();
    expect(stderr).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(4);
    expect(String(append.mock.calls[0]?.[0])).toContain(process.cwd());
  });
  it('persists before terminal writes and tolerates synchronous terminal failure', () => {
    const events: string[] = [];
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { events.push('file'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => { events.push('stderr'); throw new Error('EPIPE'); });
    expect(() => createLogger('test').error('test')).not.toThrow();
    expect(events).toEqual(['file', 'file', 'stderr']);
  });
});
