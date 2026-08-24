import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPagerArgv,
  isLessFamilyBinary,
  openTranscriptPager,
  parsePagerCommand,
  type TranscriptPagerHost,
} from '../../src/ui/transcript-pager.js';
import { TranscriptBuffer } from '../../src/ui/transcript-buffer.js';

function makeHost(overrides: Partial<TranscriptPagerHost> = {}): {
  host: TranscriptPagerHost;
  events: string[];
  writes: string[];
} {
  const events: string[] = [];
  const writes: string[] = [];
  const host: TranscriptPagerHost = {
    getStatus: () => 'idle',
    getPager: () => 'cat',
    getPlatform: () => 'darwin',
    lookupBinary: () => '/usr/bin/less',
    suspendInput: () => {
      events.push('suspend');
      return {
        resume: () => {
          events.push('resume-input');
        },
      };
    },
    endScrollRegion: () => {
      events.push('end-scroll');
    },
    resumeScrollRegion: () => {
      events.push('resume-scroll');
    },
    spawnPager: async () => ({ ok: true, exitCode: 0, signal: null }),
    writeStdout: (chunk) => {
      writes.push(chunk);
    },
    tempDir: undefined,
    logDebug: () => {},
    ...overrides,
  };
  return { host, events, writes };
}

function buildBuffer(): TranscriptBuffer {
  const buffer = new TranscriptBuffer();
  buffer.record({ kind: 'user', text: '看一下 notes.txt' });
  buffer.record({ kind: 'assistant', text: 'notes.txt 只有一行。' });
  return buffer;
}

describe('parsePagerCommand and isLessFamilyBinary (integration)', () => {
  it('feeds into buildPagerArgv correctly', () => {
    expect(parsePagerCommand('less -FX')).toEqual(['less', '-FX']);
    expect(isLessFamilyBinary('less')).toBe(true);
    expect(buildPagerArgv('less -FX', () => true)).toEqual(['less', '-FX', '-R']);
    expect(buildPagerArgv('cat', () => true)).toEqual(['cat']);
    expect(buildPagerArgv('less', (binary) => binary === 'less')).toEqual(['less', '-R']);
    expect(buildPagerArgv(undefined, () => false)).toEqual([]);
  });
});

describe('openTranscriptPager status gating', () => {
  it('does nothing while the runtime is busy', async () => {
    const { host, events } = makeHost({ getStatus: () => 'busy' });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('busy');
    expect(events).toEqual([]);
  });

  it('does nothing while a permission prompt is active', async () => {
    const { host } = makeHost({ getStatus: () => 'permission' });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('permission');
  });

  it('does nothing while content is streaming', async () => {
    const { host } = makeHost({ getStatus: () => 'streaming' });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('streaming');
  });

  it('does nothing when the buffer is empty', async () => {
    const { host, events } = makeHost();
    const result = await openTranscriptPager({ buffer: new TranscriptBuffer(), host });
    expect(result.action).toBe('skipped');
    expect(result.reason).toBe('empty');
    expect(events).toEqual([]);
  });
});

describe('openTranscriptPager pager spawn path', () => {
  it('spawns cat with a temp file and cleans it up', async () => {
    const spawned: { argv: string[]; file: string; hadFile: boolean }[] = [];
    const { host, events } = makeHost({
      getPager: () => 'cat',
      spawnPager: async (argv, filePath) => {
        spawned.push({ argv, file: filePath, hadFile: existsSync(filePath) });
        return { ok: true, exitCode: 0, signal: null };
      },
    });

    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('pager');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].argv).toEqual(['cat']);
    expect(spawned[0].hadFile).toBe(true);
    // Temp file removed after spawn.
    expect(existsSync(spawned[0].file)).toBe(false);
    expect(events).toEqual(['suspend', 'end-scroll', 'resume-scroll', 'resume-input']);
  });

  it('creates temp files with 0600 permissions on POSIX', async () => {
    if (process.platform === 'win32') {
      return;
    }
    let observedMode = -1;
    let observedContent = '';
    let observedPath = '';
    const { host } = makeHost({
      spawnPager: async (_argv, filePath) => {
        observedPath = filePath;
        observedMode = statSync(filePath).mode & 0o777;
        observedContent = readFileSync(filePath, 'utf8');
        return { ok: true, exitCode: 0, signal: null };
      },
    });

    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('pager');
    expect(observedMode).toBe(0o600);
    expect(observedContent).toContain('notes.txt');
    expect(existsSync(observedPath)).toBe(false);
  });

  it('parses multi-word $PAGER and only adds -R for less family', async () => {
    const captured: string[][] = [];
    const { host } = makeHost({
      getPager: () => 'less -FX',
      spawnPager: async (argv) => {
        captured.push(argv);
        return { ok: true, exitCode: 0, signal: null };
      },
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('pager');
    expect(captured[0]).toEqual(['less', '-FX', '-R']);
  });

  it('does not add -R for non-less pagers', async () => {
    const captured: string[][] = [];
    const { host } = makeHost({
      getPager: () => 'bat --paging=always',
      spawnPager: async (argv) => {
        captured.push(argv);
        return { ok: true, exitCode: 0, signal: null };
      },
    });
    await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(captured[0]).toEqual(['bat', '--paging=always']);
  });

  it('falls back to less when $PAGER is unset', async () => {
    const captured: string[][] = [];
    const { host } = makeHost({
      getPager: () => undefined,
      lookupBinary: (name) => (name === 'less' ? '/usr/bin/less' : null),
      spawnPager: async (argv) => {
        captured.push(argv);
        return { ok: true, exitCode: 0, signal: null };
      },
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('pager');
    expect(captured[0]).toEqual(['less', '-R']);
  });
});

describe('openTranscriptPager fallback path', () => {
  it('degrades to a scrollback print when no pager is available', async () => {
    const { host, writes, events } = makeHost({
      getPager: () => undefined,
      lookupBinary: () => null,
      spawnPager: async () => {
        throw new Error('spawn must not be called when no pager is available');
      },
    });

    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('printed');
    expect(events).toEqual([]);
    expect(writes.join('')).toContain('notes.txt');
  });

  it('degrades to print on win32 regardless of $PAGER', async () => {
    const { host, writes } = makeHost({
      getPlatform: () => 'win32',
      getPager: () => 'less -FX',
      lookupBinary: () => 'C:\\Tools\\less.exe',
      spawnPager: async () => {
        throw new Error('spawn must not be called on win32');
      },
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('printed');
    expect(writes.join('')).toContain('notes.txt');
  });

  it('degrades to print when spawn reports ENOENT', async () => {
    const { host, writes, events } = makeHost({
      spawnPager: async () => ({ ok: false, error: 'ENOENT' }),
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('printed');
    expect(writes.join('')).toContain('notes.txt');
    expect(events).toContain('resume-input');
    expect(events).toContain('resume-scroll');
  });

  it('runs the recovery sequence even when the pager exits non-zero', async () => {
    const { host, writes, events } = makeHost({
      spawnPager: async () => ({ ok: true, exitCode: 2, signal: null }),
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('pager');
    expect(result.exitCode).toBe(2);
    expect(events).toEqual(['suspend', 'end-scroll', 'resume-scroll', 'resume-input']);
    expect(writes.join('')).not.toContain('看一下 notes.txt');
  });

  it('runs the recovery sequence when the pager is killed by a signal', async () => {
    const { host, events } = makeHost({
      spawnPager: async () => ({ ok: true, exitCode: null, signal: 'SIGTERM' }),
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('pager');
    expect(result.signal).toBe('SIGTERM');
    expect(events).toContain('resume-input');
    expect(events).toContain('resume-scroll');
  });

  it('recovers when a step of the pager pipeline throws', async () => {
    const { host, events, writes } = makeHost({
      spawnPager: async () => {
        throw new Error('boom');
      },
    });
    const result = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(result.action).toBe('error');
    expect(events).toContain('resume-input');
    expect(events).toContain('resume-scroll');
    // Fallback text is not printed on hard errors; the recovery sequence still runs.
    expect(writes.join('')).not.toContain('看一下 notes.txt');
  });

  it('deletes the temp file even when spawn throws', async () => {
    const observed: string[] = [];
    const { host } = makeHost({
      spawnPager: async (_argv, filePath) => {
        observed.push(filePath);
        throw new Error('crashed');
      },
    });
    await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(observed).toHaveLength(1);
    expect(existsSync(observed[0])).toBe(false);
  });
});

describe('openTranscriptPager suspend/resume symmetry', () => {
  it('always calls resume() after suspend() even when spawn fails', async () => {
    const events: string[] = [];
    const host: TranscriptPagerHost = {
      getStatus: () => 'idle',
      getPager: () => 'cat',
      getPlatform: () => 'darwin',
      lookupBinary: () => null,
      suspendInput: () => {
        events.push('suspend');
        return { resume: () => events.push('resume-input') };
      },
      endScrollRegion: () => events.push('end-scroll'),
      resumeScrollRegion: () => events.push('resume-scroll'),
      spawnPager: async () => {
        throw new Error('spawn threw');
      },
      writeStdout: () => {},
      logDebug: () => {},
    };

    await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(events.filter((e) => e === 'suspend').length).toEqual(events.filter((e) => e === 'resume-input').length);
    expect(events.filter((e) => e === 'end-scroll').length).toEqual(events.filter((e) => e === 'resume-scroll').length);
  });

  it('remains idempotent for repeated open/close cycles', async () => {
    const events: string[] = [];
    const host: TranscriptPagerHost = {
      getStatus: () => 'idle',
      getPager: () => 'cat',
      getPlatform: () => 'darwin',
      lookupBinary: () => '/bin/cat',
      suspendInput: () => {
        events.push('suspend');
        return { resume: () => events.push('resume-input') };
      },
      endScrollRegion: () => events.push('end-scroll'),
      resumeScrollRegion: () => events.push('resume-scroll'),
      spawnPager: async () => ({ ok: true, exitCode: 0, signal: null }),
      writeStdout: () => {},
      logDebug: () => {},
    };

    const first = await openTranscriptPager({ buffer: buildBuffer(), host });
    const second = await openTranscriptPager({ buffer: buildBuffer(), host });
    expect(first.action).toBe('pager');
    expect(second.action).toBe('pager');
    expect(events.filter((e) => e === 'suspend').length).toBe(2);
    expect(events.filter((e) => e === 'resume-input').length).toBe(2);
  });
});
