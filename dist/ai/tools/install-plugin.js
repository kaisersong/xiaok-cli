import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { getConfigDir } from '../../utils/config.js';
/**
 * 检查是否存在同名 skill 已安装
 */
function findConflictingSkill(pluginName, configDir) {
    const skillsDir = join(configDir, 'skills');
    if (!existsSync(skillsDir))
        return null;
    try {
        for (const entry of readdirSync(skillsDir)) {
            const skillPath = join(skillsDir, entry);
            // 检查目录中的 SKILL.md
            const skillMdPath = join(skillPath, 'SKILL.md');
            if (existsSync(skillMdPath)) {
                const raw = readFileSync(skillMdPath, 'utf8');
                const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (match) {
                    const nameMatch = match[1].match(/^name:\s*(.+)$/m);
                    if (nameMatch && nameMatch[1].trim() === pluginName) {
                        return skillPath;
                    }
                }
            }
            // 检查 .md 文件
            if (entry.endsWith('.md')) {
                const raw = readFileSync(skillPath, 'utf8');
                const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                if (match) {
                    const nameMatch = match[1].match(/^name:\s*(.+)$/m);
                    if (nameMatch && nameMatch[1].trim() === pluginName) {
                        return skillPath;
                    }
                }
            }
        }
    }
    catch {
        // 忽略读取错误
    }
    return null;
}
/**
 * 从 GitHub Release 下载并解压 plugin
 */
async function downloadAndExtractPlugin(releaseUrl, targetDir, pluginName, fetchFn) {
    const isWin = process.platform === 'win32';
    try {
        // 创建临时目录
        const tempDir = join(targetDir, `.xiaok-plugin-install-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });
        // 下载 ZIP
        const response = await fetchFn(releaseUrl);
        if (!response.ok) {
            return {
                success: false,
                message: `下载 plugin 失败: ${response.status} ${response.statusText}`,
            };
        }
        const zipPath = join(tempDir, 'plugin.zip');
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(zipPath, buffer);
        // 解压 ZIP
        if (isWin) {
            const result = spawnSync('powershell', [
                '-Command',
                `Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force`,
            ]);
            if (result.status !== 0) {
                rmSync(tempDir, { recursive: true, force: true });
                return {
                    success: false,
                    message: `解压 plugin 失败: ${result.stderr?.toString().trim() || '未知错误'}`,
                };
            }
        }
        else {
            const result = spawnSync('unzip', ['-o', zipPath, '-d', tempDir]);
            if (result.status !== 0) {
                rmSync(tempDir, { recursive: true, force: true });
                return {
                    success: false,
                    message: `解压 plugin 失败: ${result.stderr?.toString().trim() || '未知错误'}`,
                };
            }
        }
        // 查找解压后的目录（应该包含 plugin.json）
        let sourceDir = tempDir;
        for (const entry of readdirSync(tempDir)) {
            const entryPath = join(tempDir, entry);
            if (existsSync(join(entryPath, 'plugin.json'))) {
                sourceDir = entryPath;
                break;
            }
        }
        // 移动到目标位置
        const destDir = join(targetDir, pluginName);
        if (existsSync(destDir)) {
            rmSync(destDir, { recursive: true, force: true });
        }
        mkdirSync(targetDir, { recursive: true });
        // 使用 cpSync 或 spawnSync mv/cp
        if (isWin) {
            spawnSync('powershell', [
                '-Command',
                `Move-Item -Path '${sourceDir}\\*' -Destination '${destDir}' -Force`,
            ]);
        }
        else {
            spawnSync('cp', ['-r', `${sourceDir}/.`, destDir]);
        }
        // 清理临时目录
        rmSync(tempDir, { recursive: true, force: true });
        return {
            success: true,
            message: `已安装 plugin "${pluginName}" 到 ${destDir}`,
        };
    }
    catch (error) {
        return {
            success: false,
            message: `安装 plugin 失败: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
export function createInstallPluginTool(options = {}) {
    const configDir = options.configDir ?? getConfigDir();
    const fetchFn = options.fetchFn ?? fetch;
    return {
        permission: 'write',
        definition: {
            name: 'install_plugin',
            description: '安装 xiaok Desktop 插件到 ~/.xiaok/plugins/。支持从 GitHub Release 下载。',
            inputSchema: {
                type: 'object',
                properties: {
                    source: {
                        type: 'string',
                        description: '插件来源：GitHub Release ZIP 下载 URL',
                    },
                    name: {
                        type: 'string',
                        description: '插件名称（用于目标目录名）',
                    },
                },
                required: ['source', 'name'],
            },
        },
        async execute(input) {
            const { source, name } = input;
            const targetDir = join(configDir, 'plugins');
            // 检查是否存在同名 skill
            const conflict = findConflictingSkill(name, configDir);
            if (conflict) {
                console.warn(`⚠️ 检测到已安装的同名 skill: ${conflict}`);
                console.warn('  Plugin 版本将与 global skill 竞争生效（优先级：project > global > plugin/builtin）。');
            }
            const result = await downloadAndExtractPlugin(source, targetDir, name, fetchFn);
            if (!result.success) {
                return `Error: ${result.message}`;
            }
            return result.message;
        },
    };
}
export const installPluginTool = createInstallPluginTool();
