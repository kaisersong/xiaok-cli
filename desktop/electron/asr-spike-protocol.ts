export interface CharacterErrorRateInput {
  hypothesis: string;
  reference: string;
}

export interface AsrSpikeHarnessReadinessInput {
  env?: Record<string, string | undefined>;
}

export type AsrSpikeHarnessReadiness =
  | { ready: true; skip: false; fixtureDir: string }
  | { ready: false; skip: true; reason: string };

const CER_PUNCTUATION_PATTERN = /[\s\u3000，。！？、；：,.!?;:'"“”‘’（）()【】\[\]《》<>-]+/g;

export function normalizeTextForCer(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(CER_PUNCTUATION_PATTERN, '')
    .trim();
}

export function calculateCharacterErrorRate(input: CharacterErrorRateInput): number {
  const reference = Array.from(normalizeTextForCer(input.reference));
  const hypothesis = Array.from(normalizeTextForCer(input.hypothesis));
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return levenshteinDistance(reference, hypothesis) / reference.length;
}

export function resolveAsrSpikeHarnessReadiness(
  input: AsrSpikeHarnessReadinessInput = {},
): AsrSpikeHarnessReadiness {
  const fixtureDir = input.env?.ASR_FIXTURE_DIR?.trim();
  if (!fixtureDir) {
    return { ready: false, skip: true, reason: 'ASR_FIXTURE_DIR not set' };
  }
  return { ready: true, skip: false, fixtureDir };
}

function levenshteinDistance(a: string[], b: string[]): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let col = 1; col <= b.length; col += 1) {
      current[col] = Math.min(
        previous[col] + 1,
        current[col - 1] + 1,
        previous[col - 1] + (a[row - 1] === b[col - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}
