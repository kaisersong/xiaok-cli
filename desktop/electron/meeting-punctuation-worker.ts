import { isMainThread, parentPort, workerData } from 'node:worker_threads';

export interface MeetingPunctuationWorkerRequest {
  text: string;
  modelPath: string;
  numThreads?: number;
}

export type MeetingPunctuationWorkerResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

interface SherpaPunctuationRuntime {
  OfflinePunctuation: new (config: {
    model: {
      ctTransformer: string;
      numThreads: number;
      provider: 'cpu';
    };
  }) => { addPunct(text: string): string };
}

export interface MeetingPunctuationWorkerDeps {
  loadRuntime?: () => Promise<SherpaPunctuationRuntime> | SherpaPunctuationRuntime;
}

export async function runPunctuationWorkerRequest(
  input: MeetingPunctuationWorkerRequest,
  deps: MeetingPunctuationWorkerDeps = {},
): Promise<MeetingPunctuationWorkerResponse> {
  try {
    const text = input.text.trim();
    if (!text) return { ok: true, text: '' };
    const runtime = await (deps.loadRuntime ?? loadSherpaPunctuationRuntime)();
    const punctuator = new runtime.OfflinePunctuation({
      model: {
        ctTransformer: input.modelPath,
        numThreads: input.numThreads ?? 1,
        provider: 'cpu',
      },
    });
    return { ok: true, text: punctuator.addPunct(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'punctuation_worker_failed' };
  }
}

async function loadSherpaPunctuationRuntime(): Promise<SherpaPunctuationRuntime> {
  const moduleName = 'sherpa-onnx-node';
  const loaded = await import(moduleName) as { default?: unknown };
  return (loaded.default ?? loaded) as SherpaPunctuationRuntime;
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  runPunctuationWorkerRequest(workerData as MeetingPunctuationWorkerRequest)
    .then(result => port.postMessage(result))
    .catch(error => {
      port.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'punctuation_worker_failed',
      } satisfies MeetingPunctuationWorkerResponse);
    });
}
