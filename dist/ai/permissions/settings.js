import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
function getGlobalSettingsPath() {
    const dir = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
    return join(dir, 'settings.json');
}
function getProjectSettingsPath(cwd) {
    return join(cwd, '.xiaok', 'settings.json');
}
async function readSettings(path) {
    if (!existsSync(path))
        return {};
    try {
        const raw = await readFile(path, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed ?? {};
    }
    catch {
        return {};
    }
}
async function writeSettings(path, settings) {
    const dir = join(path, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
/** 加载全局 + 项目级 settings */
export async function loadSettings(cwd) {
    const [global, project] = await Promise.all([
        readSettings(getGlobalSettingsPath()),
        readSettings(getProjectSettingsPath(cwd)),
    ]);
    return { global, project };
}
/** 合并两层 settings 的 allow/deny 规则 */
export function mergeRules(settings) {
    const allowRules = [
        ...(settings.global.permissions?.allow ?? []),
        ...(settings.project.permissions?.allow ?? []),
    ];
    const denyRules = [
        ...(settings.global.permissions?.deny ?? []),
        ...(settings.project.permissions?.deny ?? []),
    ];
    return { allowRules, denyRules };
}
/** 向指定层级添加一条 allow 规则（去重） */
export async function addAllowRule(scope, rule, cwd) {
    const path = scope === 'global' ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
    const settings = await readSettings(path);
    const allow = settings.permissions?.allow ?? [];
    if (allow.includes(rule))
        return; // 已存在，跳过
    settings.permissions = {
        ...settings.permissions,
        allow: [...allow, rule],
    };
    await writeSettings(path, settings);
}
/** 向指定层级添加一条 deny 规则（去重） */
export async function addDenyRule(scope, rule, cwd) {
    const path = scope === 'global' ? getGlobalSettingsPath() : getProjectSettingsPath(cwd);
    const settings = await readSettings(path);
    const deny = settings.permissions?.deny ?? [];
    if (deny.includes(rule))
        return;
    settings.permissions = {
        ...settings.permissions,
        deny: [...deny, rule],
    };
    await writeSettings(path, settings);
}
export { getGlobalSettingsPath, getProjectSettingsPath };
