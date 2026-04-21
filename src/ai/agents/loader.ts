import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfigDir } from '../../utils/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_AGENTS_DIR = join(__dirname, '../../../data/agents');

export interface CustomAgentDef {
  name: string;
  systemPrompt: string;
  allowedTools?: string[];
  model?: string;
  maxIterations?: number;
  background?: boolean;
  isolation?: 'shared' | 'worktree';
  cleanup?: 'keep' | 'delete';
  team?: string;
  source?: 'builtin' | 'global' | 'project';
}

export function parseAgentFile(name: string, raw: string): CustomAgentDef {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const metadata = new Map<string, string>();

  if (match) {
    for (const line of match[1].split('\n')) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      metadata.set(key, value);
    }
  }

  return {
    name,
    systemPrompt: (match?.[2] ?? raw).trim(),
    allowedTools: metadata.get('tools')?.split(',').map((value) => value.trim()).filter(Boolean),
    model: metadata.get('model') || undefined,
    maxIterations: metadata.has('max_iterations')
      ? Number(metadata.get('max_iterations'))
      : undefined,
    background: metadata.get('background') === 'true',
    isolation: metadata.get('isolation') === 'worktree' ? 'worktree' : undefined,
    cleanup: metadata.get('cleanup') === 'delete' ? 'delete' : undefined,
    team: metadata.get('team') || undefined,
  };
}

function loadAgentsFromDir(dir: string, source: 'builtin' | 'global' | 'project'): CustomAgentDef[] {
  if (!existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith('.md'));
  } catch {
    return [];
  }

  const agents: CustomAgentDef[] = [];
  for (const entry of entries) {
    try {
      const raw = readFileSync(join(dir, entry), 'utf-8');
      const parsed = parseAgentFile(entry.replace(/\.md$/i, ''), raw);
      agents.push({ ...parsed, source });
    } catch {
      console.warn(`[xiaok] Agents: 读取文件失败: ${entry}`);
    }
  }

  return agents;
}

export async function loadCustomAgents(
  xiaokConfigDir = getConfigDir(),
  cwd = process.cwd(),
  extraDirs: string[] = [],
): Promise<CustomAgentDef[]> {
  const builtinAgents = loadAgentsFromDir(BUILTIN_AGENTS_DIR, 'builtin');
  const globalAgents = loadAgentsFromDir(join(xiaokConfigDir, 'agents'), 'global');
  const projectAgents = loadAgentsFromDir(join(cwd, '.xiaok', 'agents'), 'project');
  const pluginAgents = extraDirs.flatMap((dir) => loadAgentsFromDir(dir, 'project'));

  // Priority: project > global > builtin (later entries override earlier ones)
  const merged = new Map<string, CustomAgentDef>();
  for (const agent of builtinAgents) {
    merged.set(agent.name, agent);
  }
  for (const globalAgent of globalAgents) {
    merged.set(globalAgent.name, globalAgent);
  }
  for (const projectAgent of projectAgents) {
    merged.set(projectAgent.name, projectAgent);
  }
  for (const pluginAgent of pluginAgents) {
    merged.set(pluginAgent.name, pluginAgent);
  }

  return [...merged.values()];
}
