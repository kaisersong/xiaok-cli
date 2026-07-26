import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../../../src/types.js';
import type {
  CompactionApplyOutcome,
  CompactionPlan,
  CompactionRecord,
} from '../../../src/ai/runtime/session.js';
import {
  executePortableCompaction,
  type PortableCompactionPorts,
  type PortableCompactionTrigger,
} from '../../../src/ai/runtime/portable-compaction-executor.js';

const PREFIX: Message[] = [{
  role: 'user',
  content: [{
    type: 'text',
    text: `old request ${'a'.repeat(10_000)}`,
  }],
}];

const RETAINED: Message[] = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'recent request' }],
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'recent answer' }],
  },
];

function makePlan(
  overrides: Partial<CompactionPlan> = {},
): CompactionPlan {
  return {
    sourceRevision: 7,
    sourceMessageCount: 3,
    messagesToSummarize: structuredClone(PREFIX),
    messagesToRetain: structuredClone(RETAINED),
    replacedMessages: 1,
    ...overrides,
  };
}

function makeRecord(summary = 'portable summary'): CompactionRecord {
  return {
    id: 'cmp_test',
    createdAt: 1,
    summary,
    replacedMessages: 1,
  };
}

function compacted(summary = 'portable summary'): CompactionApplyOutcome {
  return {
    status: 'compacted',
    record: makeRecord(summary),
  };
}

function makePorts(
  overrides: Partial<PortableCompactionPorts> = {},
): PortableCompactionPorts {
  return {
    summarizePrefix: vi.fn(async () => 'portable summary'),
    applyPlan: vi.fn(() => compacted()),
    ...overrides,
  };
}

const THRESHOLD_TRIGGER = { kind: 'threshold' } as const;

describe('executePortableCompaction', () => {
  it('throws the existing abort reason before summary or apply', async () => {
    const controller = new AbortController();
    const reason = new DOMException('user stopped', 'AbortError');
    controller.abort(reason);
    const ports = makePorts();

    await expect(executePortableCompaction({
      plan: makePlan(),
      signal: controller.signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports)).rejects.toBe(reason);

    expect(ports.summarizePrefix).not.toHaveBeenCalled();
    expect(ports.applyPlan).not.toHaveBeenCalled();
  });

  it('returns invalid_plan without calling summary or apply', async () => {
    const ports = makePorts();

    const outcome = await executePortableCompaction({
      plan: makePlan({
        messagesToSummarize: [],
        replacedMessages: 0,
        invalidReason: 'unpaired_tool_result',
      }),
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports);

    expect(outcome).toEqual({
      status: 'invalid_plan',
      record: null,
      trigger: THRESHOLD_TRIGGER,
      summaryAttempted: false,
      summaryModelFailed: false,
    });
    expect(ports.summarizePrefix).not.toHaveBeenCalled();
    expect(ports.applyPlan).not.toHaveBeenCalled();
  });

  it('returns no_replacement without calling summary or apply', async () => {
    const ports = makePorts();

    const outcome = await executePortableCompaction({
      plan: makePlan({
        messagesToSummarize: [],
        replacedMessages: 0,
      }),
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports);

    expect(outcome).toEqual({
      status: 'no_replacement',
      record: null,
      trigger: THRESHOLD_TRIGGER,
      summaryAttempted: false,
      summaryModelFailed: false,
    });
    expect(ports.summarizePrefix).not.toHaveBeenCalled();
    expect(ports.applyPlan).not.toHaveBeenCalled();
  });

  it('summarizes only a defensive clone and applies the same plan once', async () => {
    const plan = makePlan();
    const before = structuredClone(plan);
    let receivedBeforeMutation: readonly Message[] | undefined;
    const applyPlan = vi.fn((
      receivedPlan: CompactionPlan,
      summaryText?: string,
    ) => compacted(summaryText));
    const ports = makePorts({
      summarizePrefix: vi.fn(async (messages) => {
        receivedBeforeMutation = structuredClone(messages);
        const mutable = messages as Message[];
        const firstBlock = mutable[0]!.content[0]!;
        if (firstBlock.type === 'text') firstBlock.text = 'mutated inside port';
        return 'LLM summary: preserve /tmp/report.html';
      }),
      applyPlan,
    });

    const outcome = await executePortableCompaction({
      plan,
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports);

    expect(receivedBeforeMutation).toEqual(before.messagesToSummarize);
    expect(JSON.stringify(receivedBeforeMutation)).not.toContain('recent request');
    expect(plan).toEqual(before);
    expect(applyPlan).toHaveBeenCalledOnce();
    expect(applyPlan).toHaveBeenCalledWith(
      plan,
      'LLM summary: preserve /tmp/report.html',
    );
    expect(outcome).toEqual({
      status: 'compacted',
      record: makeRecord('LLM summary: preserve /tmp/report.html'),
      trigger: THRESHOLD_TRIGGER,
      summaryAttempted: true,
      summaryModelFailed: false,
    });
  });

  it.each([
    'stale_plan',
    'invalid_plan',
    'no_gain',
  ] as const)('preserves the %s apply outcome', async (status) => {
    const applyOutcome: CompactionApplyOutcome = {
      status,
      record: null,
    };
    const ports = makePorts({
      applyPlan: vi.fn(() => applyOutcome),
    });

    const outcome = await executePortableCompaction({
      plan: makePlan(),
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports);

    expect(outcome).toEqual({
      ...applyOutcome,
      trigger: THRESHOLD_TRIGGER,
      summaryAttempted: true,
      summaryModelFailed: false,
    });
    expect(ports.applyPlan).toHaveBeenCalledOnce();
  });

  it('uses deterministic fallback once without reading an arbitrary thrown value', async () => {
    let toStringCalls = 0;
    let sensitiveGetterReads = 0;
    const opaque = Object.defineProperties({}, {
      toString: {
        value: () => {
          toStringCalls += 1;
          return 'Authorization: Bearer sk-must-not-leak';
        },
      },
      body: {
        get: () => {
          sensitiveGetterReads += 1;
          return 'RAW_RESPONSE_BODY';
        },
      },
      cause: {
        get: () => {
          sensitiveGetterReads += 1;
          return new Error('opaque-canonical-output');
        },
      },
    });
    const applyPlan = vi.fn((
      _plan: CompactionPlan,
      summaryText?: string,
    ) => compacted(summaryText ?? '[context compacted summary]'));
    const ports = makePorts({
      summarizePrefix: vi.fn(async () => {
        throw opaque;
      }),
      applyPlan,
    });

    const outcome = await executePortableCompaction({
      plan: makePlan(),
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports);

    expect(applyPlan).toHaveBeenCalledOnce();
    expect(applyPlan).toHaveBeenCalledWith(expect.any(Object), undefined);
    expect(outcome).toMatchObject({
      status: 'compacted',
      summaryAttempted: true,
      summaryModelFailed: true,
      summaryFailureCode: 'portable_summary_failed',
    });
    expect(toStringCalls).toBe(0);
    expect(sensitiveGetterReads).toBe(0);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('sk-must-not-leak');
    expect(serialized).not.toContain('RAW_RESPONSE_BODY');
    expect(serialized).not.toContain('opaque-canonical-output');
  });

  it('drops secret text already present in Error.message', async () => {
    const error = new Error(
      '500 Authorization: Bearer sk-secret RAW_RESPONSE_BODY',
    );
    const ports = makePorts({
      summarizePrefix: vi.fn(async () => {
        throw error;
      }),
    });

    const outcome = await executePortableCompaction({
      plan: makePlan(),
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports);

    expect(outcome.summaryModelFailed).toBe(true);
    expect(JSON.stringify(outcome)).toBe(JSON.stringify({
      status: 'compacted',
      record: makeRecord(),
      trigger: THRESHOLD_TRIGGER,
      summaryAttempted: true,
      summaryModelFailed: true,
      summaryFailureCode: 'portable_summary_failed',
    }));
  });

  it('rethrows a summary AbortError without applying', async () => {
    const reason = new DOMException('user stopped', 'AbortError');
    const ports = makePorts({
      summarizePrefix: vi.fn(async () => {
        throw reason;
      }),
    });

    await expect(executePortableCompaction({
      plan: makePlan(),
      signal: new AbortController().signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports)).rejects.toBe(reason);

    expect(ports.applyPlan).not.toHaveBeenCalled();
  });

  it('does not apply when the signal aborts after summary resolves', async () => {
    const controller = new AbortController();
    const reason = new DOMException('user stopped', 'AbortError');
    const ports = makePorts({
      summarizePrefix: vi.fn(async () => {
        controller.abort(reason);
        return 'summary that must not commit';
      }),
    });

    await expect(executePortableCompaction({
      plan: makePlan(),
      signal: controller.signal,
      trigger: THRESHOLD_TRIGGER,
    }, ports)).rejects.toBe(reason);

    expect(ports.applyPlan).not.toHaveBeenCalled();
  });

  const triggers = [
    { kind: 'threshold' },
    { kind: 'native_failure', failureClass: 'http400' },
    { kind: 'native_failure', failureClass: 'http429' },
    { kind: 'native_failure', failureClass: 'http500' },
    { kind: 'native_failure', failureClass: 'network' },
    { kind: 'native_failure', failureClass: 'timeout' },
    { kind: 'native_failure', failureClass: 'corruptResponse' },
    { kind: 'native_failure', failureClass: 'providerModelMismatch' },
    { kind: 'native_failure', failureClass: 'unknown' },
  ] satisfies PortableCompactionTrigger[];

  it.each(triggers)(
    'treats $kind/$failureClass as metadata only',
    async (trigger) => {
      const ports = makePorts();

      const outcome = await executePortableCompaction({
        plan: makePlan(),
        signal: new AbortController().signal,
        trigger,
      }, ports);

      expect(ports.summarizePrefix).toHaveBeenCalledOnce();
      expect(ports.applyPlan).toHaveBeenCalledOnce();
      expect(outcome).toMatchObject({
        status: 'compacted',
        trigger,
        summaryAttempted: true,
        summaryModelFailed: false,
      });
    },
  );
});
