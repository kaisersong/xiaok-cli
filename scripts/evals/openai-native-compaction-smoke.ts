import {
  createDefaultOpenAINativeCompactionSmokeFixture,
  runOpenAINativeCompactionSmoke,
} from '../../src/ai/evals/openai-native-compaction-smoke.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() || undefined : undefined;
}

const evidence = await runOpenAINativeCompactionSmoke({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: 'https://api.openai.com/v1',
  model: readArg('--model')
    ?? process.env.OPENAI_NATIVE_COMPACTION_MODEL?.trim()
    ?? 'gpt-5.1',
  fixture: createDefaultOpenAINativeCompactionSmokeFixture(),
  accountProjectFingerprint: process.env.OPENAI_ACCOUNT_PROJECT_FINGERPRINT?.trim(),
  organization: process.env.OPENAI_ORGANIZATION?.trim() || undefined,
  project: process.env.OPENAI_PROJECT?.trim() || undefined,
});

console.log(JSON.stringify(evidence, null, 2));

if (evidence.status === 'failed') {
  process.exitCode = 1;
} else if (evidence.status === 'live_capability_smoke_missing') {
  process.exitCode = 2;
}
