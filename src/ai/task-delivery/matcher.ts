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

function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = value.toLowerCase();

  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 2 || STOP_WORDS.has(word)) {
      continue;
    }
    tokens.add(word);
  }

  for (const hanChunk of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    if (hanChunk.length === 1) {
      tokens.add(hanChunk);
      continue;
    }

    for (let index = 0; index < hanChunk.length - 1; index += 1) {
      tokens.add(hanChunk.slice(index, index + 2));
    }
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
      if (queryTokens.has(token)) {
        score += weight;
        matched = true;
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
