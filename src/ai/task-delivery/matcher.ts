import type { TaskSkillHints, TaskSkillMatch } from './types.js';

type TaskSkill = {
  name: string;
  description: string;
  taskHints: TaskSkillHints;
};

const FIELD_WEIGHTS = {
  description: 4,
  taskGoals: 6,
  inputKinds: 3,
  outputKinds: 3,
  examples: 2,
} as const;

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function isAsciiWord(value: string): boolean {
  return /^[a-z0-9]+$/u.test(value);
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function levenshteinWithin(left: string, right: string, maxDistance: number): boolean {
  const leftLength = left.length;
  const rightLength = right.length;
  if (Math.abs(leftLength - rightLength) > maxDistance) return false;
  if (left === right) return true;

  let previous = Array.from({ length: rightLength + 1 }, (_, index) => index);

  for (let i = 1; i <= leftLength; i += 1) {
    const current = [i];
    let rowMin = current[0]!;

    for (let j = 1; j <= rightLength; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      const insertion = current[j - 1]! + 1;
      const deletion = previous[j]! + 1;
      const substitution = previous[j - 1]! + substitutionCost;
      const value = Math.min(insertion, deletion, substitution);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > maxDistance) return false;
    previous = current;
  }

  return previous[rightLength]! <= maxDistance;
}

function wordsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (!isAsciiWord(left) || !isAsciiWord(right)) return false;

  const prefixLength = commonPrefixLength(left, right);
  if (prefixLength < 4) return false;
  if (Math.min(left.length, right.length) < 5) return false;

  const maxDistance = prefixLength >= 5 && Math.min(left.length, right.length) >= 6 ? 2 : 1;
  return levenshteinWithin(left, right, maxDistance);
}

function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = value.toLowerCase();

  for (const chunk of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(chunk)) {
      tokens.add(chunk);

      if (chunk.length === 1) {
        continue;
      }

      for (let index = 0; index < chunk.length - 1; index += 1) {
        tokens.add(chunk.slice(index, index + 2));
      }
      continue;
    }

    if (/^[a-z0-9]+$/u.test(chunk)) {
      if (chunk.length < 2 || STOP_WORDS.has(chunk)) {
        continue;
      }

      tokens.add(chunk);
      continue;
    }

    tokens.add(chunk);
  }

  return tokens;
}

function scoreField(
  queryTokens: Set<string>,
  values: string[],
  weight: number,
): { score: number; matched: boolean } {
  let score = 0;
  let matched = false;

  for (const value of values) {
    const valueTokens = tokenize(value);
    for (const token of valueTokens) {
      for (const queryToken of queryTokens) {
        if (!wordsMatch(queryToken, token)) {
          continue;
        }
        score += weight;
        matched = true;
        break;
      }
    }
  }

  return { score, matched };
}

function normalizeHints(hints: TaskSkillHints): TaskSkillHints {
  return {
    taskGoals: [...hints.taskGoals],
    inputKinds: [...hints.inputKinds],
    outputKinds: [...hints.outputKinds],
    examples: [...hints.examples],
  };
}

export function matchSkillsForTask(
  query: string,
  skills: TaskSkill[],
  limit = 5,
): TaskSkillMatch[] {
  const queryTokens = tokenize(query);
  const matches = skills.map((skill) => {
    let score = 0;
    const reasons: string[] = [];

    const descriptionResult = scoreField(queryTokens, [skill.description], FIELD_WEIGHTS.description);
    if (descriptionResult.matched) reasons.push('description');
    score += descriptionResult.score;

    const taskGoalsResult = scoreField(queryTokens, skill.taskHints.taskGoals, FIELD_WEIGHTS.taskGoals);
    if (taskGoalsResult.matched) reasons.push('task-goals');
    score += taskGoalsResult.score;

    const inputKindsResult = scoreField(queryTokens, skill.taskHints.inputKinds, FIELD_WEIGHTS.inputKinds);
    if (inputKindsResult.matched) reasons.push('input-kinds');
    score += inputKindsResult.score;

    const outputKindsResult = scoreField(queryTokens, skill.taskHints.outputKinds, FIELD_WEIGHTS.outputKinds);
    if (outputKindsResult.matched) reasons.push('output-kinds');
    score += outputKindsResult.score;

    const examplesResult = scoreField(queryTokens, skill.taskHints.examples, FIELD_WEIGHTS.examples);
    if (examplesResult.matched) reasons.push('examples');
    score += examplesResult.score;

    return {
      skill: {
        name: skill.name,
        description: skill.description,
        taskHints: normalizeHints(skill.taskHints),
      },
      score,
      reasons,
    };
  });

  return matches
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.skill.name.localeCompare(right.skill.name);
    })
    .slice(0, limit);
}
