import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  evaluateNativeCompactionReadiness,
} from '../../src/ai/evals/openai-compaction-readiness.js';

export interface OpenAICompactionReadinessCliDependencies {
  now?: number;
  portableFallbackIntegrated?: boolean;
  readTextFile?: (path: string) => string;
}

export interface OpenAICompactionReadinessCliResult {
  exitCode: 0 | 1;
  output: string;
}

export function runOpenAICompactionReadinessCli(
  args: readonly string[],
  dependencies: OpenAICompactionReadinessCliDependencies = {},
): OpenAICompactionReadinessCliResult {
  if (args.length === 0) {
    return {
      exitCode: 1,
      output: 'NO-GO: evidence_missing',
    };
  }
  if (args.length !== 1) {
    return {
      exitCode: 1,
      output: 'NO-GO: evidence_invalid',
    };
  }

  const readTextFile = dependencies.readTextFile
    ?? ((path: string) => readFileSync(path, 'utf8'));
  let rawEvidence: string;
  try {
    rawEvidence = readTextFile(args[0]);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    return {
      exitCode: 1,
      output: code === 'ENOENT'
        || (error instanceof Error && error.message === 'ENOENT')
        ? 'NO-GO: evidence_missing'
        : 'NO-GO: evidence_invalid',
    };
  }

  let evidence: unknown;
  try {
    evidence = JSON.parse(rawEvidence) as unknown;
  } catch {
    return {
      exitCode: 1,
      output: 'NO-GO: evidence_invalid',
    };
  }

  const verdict = evaluateNativeCompactionReadiness(evidence, {
    now: dependencies.now,
    portableFallbackIntegrated: dependencies.portableFallbackIntegrated,
  });
  if (verdict.go) {
    return {
      exitCode: 0,
      output: 'GO',
    };
  }
  return {
    exitCode: 1,
    output: `NO-GO: ${verdict.reasons.join(',')}`,
  };
}

function main(): void {
  const result = runOpenAICompactionReadinessCli(process.argv.slice(2));
  console.log(result.output);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
