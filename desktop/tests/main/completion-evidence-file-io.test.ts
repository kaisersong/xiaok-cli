// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const seam = vi.hoisted(() => ({
  mode: '',
  opened: 0,
  closed: 0,
  statsGetters: 0,
  rpc: 0,
  hold: null as Promise<void> | null,
  cause: undefined as unknown,
}));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    open(...args: any[]) {
      seam.opened++;
      const callback = args.pop();
      return (fs.open as Function)(...args, (...values: unknown[]) => {
        if (seam.mode === 'open_abort')
          setTimeout(() => callback(...values), 10);
        else {
          callback(...values);
          if (seam.mode === 'callback_tail')
            Object.defineProperty(callback, Symbol('held'), {
              value: seam.hold,
            });
        }
      });
    },
    lstat(...args: any[]) {
      const callback = args.pop();
      return (fs.lstat as Function)(
        ...args,
        (error: unknown, stats: object) => {
          if (!error && seam.mode === 'stats_tail')
            Object.defineProperty(stats, Symbol('held'), { value: seam.hold });
          if (!error && seam.mode === 'stats_unknown') {
            Object.defineProperty(stats, Symbol('held'), { value: seam.hold });
            Object.defineProperty(stats, 'mode', {
              get() {
                seam.statsGetters++;
                throw Error('must not read');
              },
            });
          }
          callback(error, stats);
        },
      );
    },
    read(...args: any[]) {
      const callback = args.pop();
      const raw = (fs.read as Function)(
        ...args,
        (error: unknown, ...values: unknown[]) => {
          if (seam.mode === 'read_error') callback(seam.cause, ...values);
          else callback(error, ...values);
        },
      );
      if (seam.mode === 'both_failure') throw undefined;
      return raw;
    },
    close(...args: any[]) {
      seam.closed++;
      const callback = args.pop();
      const raw = (fs.close as Function)(...args, (...values: unknown[]) =>
        callback(...values),
      );
      if (seam.mode === 'close_hold') return seam.hold;
      if (seam.mode === 'close_failure' || seam.mode === 'both_failure')
        throw seam.cause;
      return raw;
    },
  };
});
vi.mock(
  '../../../src/runtime/verification/installed-completion-observation.js',
  () => ({
    observeInstalledCompletion: async () => {
      seam.rpc++;
      return { kind: 'ordinary' };
    },
  }),
);
import { evaluateArtifactEvidenceGuardAsync } from '../../../src/runtime/guards/artifact-evidence-guard.js';
import {
  executeOriginalCompletionFileEffect,
  readOriginalCompletionFileOperation,
} from '../../../src/runtime/guards/original-completion-file-io.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'completion-file-'));
  seam.mode = '';
  seam.opened = seam.closed = seam.statsGetters = seam.rpc = 0;
  seam.hold = null;
  seam.cause = undefined;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function held() {
  let release!: () => void;
  const promise = new Promise<void>((yes) => {
    release = yes;
  });
  return { promise, release };
}
function observer(controller = new AbortController()) {
  const rows: Array<{ raw: Promise<unknown>; proof: object }> = [];
  const options = {
    signal: controller.signal,
    trackPending(raw: Promise<unknown>, proof?: object) {
      if (proof) rows.push({ raw, proof });
    },
  };
  return {
    rows,
    options,
    async wait() {
      for (const row of rows)
        await readOriginalCompletionFileOperation(
          row.raw,
          row.proof,
        ).waitKnown();
    },
  };
}
function evidence(path: string, local = false) {
  return {
    taskId: 'actual-task',
    status: 'completed',
    expectation: {
      ownerKind: 'task' as const,
      ownerId: 'actual-task',
      expectedKinds: ['file_artifact' as const],
      source: 'task_spec' as const,
      confidence: 'explicit' as const,
    },
    evidence: [
      {
        ownerKind: 'task' as const,
        ownerId: 'actual-task',
        kind: 'file_artifact' as const,
        summary: 'actual file',
        ...(local
          ? { metadata: { workspaceRoot: root, localPaths: [path] } }
          : { uri: pathToFileURL(path).href }),
      },
    ],
  };
}
describe('original completion filesystem producer', () => {
  it('retains a real open callback own tail added after its original invocation returns', async () => {
    const path = join(root, 'file.pdf');
    writeFileSync(path, '%PDF-1.4');
    const tail = held();
    seam.mode = 'callback_tail';
    seam.hold = tail.promise;
    const capture = observer();
    await evaluateArtifactEvidenceGuardAsync(evidence(path), capture.options);
    let settled = false;
    const fate = capture.wait().then(() => {
      settled = true;
    });
    await new Promise((yes) => setTimeout(yes, 20));
    expect(settled).toBe(false);
    tail.release();
    await fate;
  });
  it('runs real PDF/ZIP reads and local lstat/realpath/access through the original guard and RPC', async () => {
    const pdf = join(root, 'file.pdf'),
      pptx = join(root, 'file.pptx');
    writeFileSync(pdf, '%PDF-1.4\nbody');
    writeFileSync(pptx, Buffer.from([0x50, 0x4b, 3, 4, 0, 0]));
    const capture = observer();
    expect(
      (await evaluateArtifactEvidenceGuardAsync(evidence(pdf), capture.options))
        .ok,
    ).toBe(true);
    expect(
      (
        await evaluateArtifactEvidenceGuardAsync(
          evidence(pptx),
          capture.options,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await evaluateArtifactEvidenceGuardAsync(
          evidence(pdf, true),
          capture.options,
        )
      ).ok,
    ).toBe(true);
    await capture.wait();
    expect(seam.opened).toBe(3);
    expect(seam.closed).toBe(3);
    expect(seam.rpc).toBe(3);
  });
  it('joins an actual close wrapper raw tail before granting physical known', async () => {
    const path = join(root, 'file.pdf');
    writeFileSync(path, '%PDF-1.4');
    const tail = held();
    seam.mode = 'close_hold';
    seam.hold = tail.promise;
    const capture = observer();
    let settled = false;
    const result = evaluateArtifactEvidenceGuardAsync(
      evidence(path),
      capture.options,
    ).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((yes) => setTimeout(yes, 20));
    expect(seam.closed).toBe(1);
    expect(settled).toBe(false);
    expect(() =>
      readOriginalCompletionFileOperation(
        capture.rows[1]!.raw,
        capture.rows[1]!.proof,
      ).assertKnown(),
    ).toThrow();
    tail.release();
    expect((await result).ok).toBe(true);
    await capture.wait();
  });
  it.each(['stats_tail', 'stats_unknown'])(
    'inventories actual Stats own/symbol children without reading getters: %s',
    async (mode) => {
      const path = join(root, 'file.txt');
      writeFileSync(path, 'actual');
      const tail = held();
      seam.mode = mode;
      seam.hold = tail.promise;
      const capture = observer();
      await evaluateArtifactEvidenceGuardAsync(
        evidence(path, true),
        capture.options,
      );
      let settled = false;
      let rejected = false;
      const fate = capture.wait().then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
          rejected = true;
        },
      );
      await new Promise((yes) => setTimeout(yes, 20));
      expect(settled).toBe(false);
      expect(seam.statsGetters).toBe(0);
      tail.release();
      await fate;
      expect(rejected).toBe(mode === 'stats_unknown');
    },
  );
  it('checks active after the original observer before opening; foreign/copy/wrong raw never run getters', async () => {
    const controller = new AbortController();
    const capture = observer(controller);
    const before = capture.options.trackPending;
    capture.options.trackPending = (raw, proof) => {
      before(raw, proof);
      controller.abort('withdrawn');
    };
    await expect(
      executeOriginalCompletionFileEffect(
        {
          kind: 'structure',
          path: join(root, 'unused'),
          structuralKind: 'pdf',
        },
        capture.options,
      ),
    ).rejects.toBe('withdrawn');
    expect(seam.opened).toBe(0);
    await capture.wait();
    const { raw, proof } = capture.rows[0]!;
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('get');
        },
        ownKeys() {
          traps++;
          throw Error('keys');
        },
      },
    );
    expect(() => readOriginalCompletionFileOperation(raw, proxy)).toThrow(
      'ORIGINAL_OPERATION_REQUIRED',
    );
    expect(() =>
      readOriginalCompletionFileOperation(raw, { ...proof }),
    ).toThrow('ORIGINAL_OPERATION_REQUIRED');
    expect(() =>
      readOriginalCompletionFileOperation(Promise.resolve(), proof),
    ).toThrow('ORIGINAL_OPERATION_REQUIRED');
    expect(traps).toBe(0);
  });
  it('still closes an fd delivered after abort and does not claim a failed close known', async () => {
    const path = join(root, 'file.pdf');
    writeFileSync(path, '%PDF-1.4');
    const controller = new AbortController(),
      capture = observer(controller);
    seam.mode = 'open_abort';
    const result = executeOriginalCompletionFileEffect(
      { kind: 'structure', path, structuralKind: 'pdf' },
      capture.options,
    );
    controller.abort('stop');
    await expect(result).rejects.toBe('stop');
    await capture.wait();
    expect(seam.closed).toBe(1);
    seam.mode = 'close_failure';
    seam.cause = undefined;
    const second = observer();
    await executeOriginalCompletionFileEffect(
      { kind: 'structure', path, structuralKind: 'pdf' },
      second.options,
    );
    let failed = false,
      cause: unknown = 'sentinel';
    try {
      await second.wait();
    } catch (error) {
      failed = true;
      cause = error;
    }
    expect(failed).toBe(true);
    expect(cause).toBeUndefined();
  });
  it('retains the original callback Error stack/symbol tails across fail-open and real close', async () => {
    const path = join(root, 'file.pdf');
    writeFileSync(path, '%PDF-1.4');
    const tail = held(),
      error = new Error('actual callback wrapper fault');
    Object.defineProperty(error, 'stack', { value: tail.promise });
    Object.defineProperty(error, Symbol('tail'), { value: tail.promise });
    seam.mode = 'read_error';
    seam.cause = error;
    const capture = observer();
    expect(
      (
        await evaluateArtifactEvidenceGuardAsync(
          evidence(path),
          capture.options,
        )
      ).ok,
    ).toBe(true);
    expect(seam.closed).toBe(1);
    let settled = false;
    const fate = capture.wait().then(() => {
      settled = true;
    });
    await new Promise((yes) => setTimeout(yes, 20));
    expect(settled).toBe(false);
    tail.release();
    await fate;
    expect(settled).toBe(true);
  });
  it('keeps an undefined body failure before the actual close wrapper error and its child tail', async () => {
    const path = join(root, 'file.pdf');
    writeFileSync(path, '%PDF-1.4');
    const tail = held(),
      cleanup = new Error('close wrapper fault');
    Object.defineProperty(cleanup, Symbol('held'), { value: tail.promise });
    seam.mode = 'both_failure';
    seam.cause = cleanup;
    const capture = observer();
    await evaluateArtifactEvidenceGuardAsync(evidence(path), capture.options);
    let settled = false,
      failure: unknown;
    const fate = capture.wait().then(
      () => {
        settled = true;
      },
      (error) => {
        failure = error;
        settled = true;
      },
    );
    await new Promise((yes) => setTimeout(yes, 20));
    expect(settled).toBe(false);
    expect(seam.closed).toBe(1);
    tail.release();
    await fate;
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0]).toBeUndefined();
    expect((failure as AggregateError).errors[1]).toBe(cleanup);
  });
});
