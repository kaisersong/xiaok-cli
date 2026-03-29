export interface SkillMeta {
  name: string;
  description: string;
  content: string;
  source: 'global' | 'project';
}

export function formatSkillsContext(skills: SkillMeta[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map(s => `- /${s.name}: ${s.description}`).join('\n');
  return `## 可用 Skills\n\n通过 /skill-name 或工具调用方式使用：\n${lines}`;
}

export async function loadSkills(
  xiaokConfigDir?: string,
  cwd?: string
): Promise<SkillMeta[]> {
  return [];
}

export function parseSlashCommand(input: string): { skillName: string; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [token, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!token) return null;
  return { skillName: token, rest: rest.join(' ') };
}
