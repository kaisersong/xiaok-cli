import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../../utils/config.js';
function parseSkillName(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match)
        return null;
    for (const line of match[1].split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key === 'name' && value) {
            return value;
        }
    }
    return null;
}
function findSkillCandidates(dir, scope) {
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir)
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => {
        const path = join(dir, entry);
        const name = parseSkillName(readFileSync(path, 'utf8'));
        if (!name) {
            return null;
        }
        return { name, path, scope };
    })
        .filter((entry) => Boolean(entry));
}
export function createUninstallSkillTool(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const configDir = options.configDir ?? getConfigDir();
    return {
        permission: 'write',
        definition: {
            name: 'uninstall_skill',
            description: '按名称从 project/global scope 卸载已安装的 skill',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: '要卸载的 skill 名称（按 frontmatter 的 name 匹配）',
                    },
                    scope: {
                        type: 'string',
                        enum: ['project', 'global'],
                        description: '卸载范围。省略时按 project -> global 顺序查找',
                    },
                },
                required: ['name'],
            },
        },
        async execute(input) {
            const { name, scope } = input;
            const normalizedName = name.trim();
            if (!normalizedName) {
                return 'Error: 缺少 skill 名称';
            }
            const projectDir = join(cwd, '.xiaok', 'skills');
            const globalDir = join(configDir, 'skills');
            const searchOrder = scope
                ? [scope]
                : ['project', 'global'];
            const matches = searchOrder
                .flatMap((targetScope) => findSkillCandidates(targetScope === 'project' ? projectDir : globalDir, targetScope))
                .filter((candidate) => candidate.name === normalizedName);
            const match = matches[0];
            if (!match) {
                return `Error: 未找到 skill "${normalizedName}"`;
            }
            rmSync(match.path, { force: true });
            await options.onUninstall?.(match);
            options.capabilityRegistry?.unregister(match.name);
            return [
                `已卸载 skill "${match.name}"`,
                `范围: ${match.scope}`,
                `路径: ${match.path}`,
            ].join('\n');
        },
    };
}
export const uninstallSkillTool = createUninstallSkillTool();
