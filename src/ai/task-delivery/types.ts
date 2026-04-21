export interface TaskSkillHints {
  taskGoals: string[];
  inputKinds: string[];
  outputKinds: string[];
  examples: string[];
}

export interface TaskSkillMatch {
  skill: {
    name: string;
    description: string;
    taskHints: TaskSkillHints;
  };
  score: number;
  reasons: string[];
}
