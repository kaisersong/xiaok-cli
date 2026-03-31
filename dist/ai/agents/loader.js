import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
export function parseAgentFile(name, raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const metadata = new Map();
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
        team: metadata.get('team') || undefined,
    };
}
function loadAgentsFromDir(dir, source) {
    if (!existsSync(dir)) {
        return [];
    }
    let entries;
    try {
        entries = readdirSync(dir).filter((entry) => entry.endsWith('.md'));
    }
    catch {
        return [];
    }
    const agents = [];
    for (const entry of entries) {
        try {
            const raw = readFileSync(join(dir, entry), 'utf-8');
            const parsed = parseAgentFile(entry.replace(/\.md$/i, ''), raw);
            agents.push({ ...parsed, source });
        }
        catch {
            console.warn(`[xiaok] Agents: 读取文件失败: ${entry}`);
        }
    }
    return agents;
}
export async function loadCustomAgents(xiaokConfigDir = join(homedir(), '.xiaok'), cwd = process.cwd(), extraDirs = []) {
    const globalAgents = loadAgentsFromDir(join(xiaokConfigDir, 'agents'), 'global');
    const projectAgents = loadAgentsFromDir(join(cwd, '.xiaok', 'agents'), 'project');
    const pluginAgents = extraDirs.flatMap((dir) => loadAgentsFromDir(dir, 'project'));
    const merged = new Map();
    for (const agent of globalAgents) {
        merged.set(agent.name, agent);
    }
    for (const agent of projectAgents) {
        merged.set(agent.name, agent);
    }
    for (const agent of pluginAgents) {
        merged.set(agent.name, agent);
    }
    return [...merged.values()];
}
