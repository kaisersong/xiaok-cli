import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, copyFile, rename, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
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
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}
/** 加载全局 + 项目级 settings */
export async function loadSettings(cwd) {
    cwd = await resolveProjectPath(cwd);
    const [global, project] = await Promise.all([
        readSettings(getGlobalSettingsPath()),
        readSettings(getProjectSettingsPath(cwd)),
    ]);
    const state = await readLocalRules();
    const key = projectKey(cwd);
    const approvedProjectAllow = [
        ...(project.permissions?.allow ?? []).filter(rule => state.adoptions[key]?.includes(ruleHash(rule))),
        ...(state.localRules[key] ?? []),
    ];
    return { global, project, approvedProjectAllow };
}
/** 合并两层 settings 的 allow/deny 规则 */
export function mergeRules(settings) {
    const allowRules = [
        ...(settings.global.permissions?.allow ?? []),
        ...settings.approvedProjectAllow,
    ];
    const denyRules = [
        ...(settings.global.permissions?.deny ?? []),
        ...(settings.project.permissions?.deny ?? []),
    ];
    return { allowRules, denyRules };
}
/** 向指定层级添加一条 allow 规则（去重） */
export async function addAllowRule(scope, rule, cwd) {
    cwd = await resolveProjectPath(cwd);
    if (scope === 'project') {
        await updateLocalRules(state => {
            const key = projectKey(cwd);
            state.localRules[key] = [...new Set([...(state.localRules[key] ?? []), rule])];
        });
        return;
    }
    const path = getGlobalSettingsPath();
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
    cwd = await resolveProjectPath(cwd);
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
function projectKey(cwd) {
    const absolute = cwd;
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
function ruleHash(rule) { return createHash('sha256').update(rule).digest('hex'); }
function localRulesPath() { return join(dirname(getGlobalSettingsPath()), 'project-rule-adoptions.json'); }
export async function getProjectAdoptionRecord(cwd) {
    return { file: localRulesPath(), key: projectKey(await resolveProjectPath(cwd)) };
}
async function readLocalRules() {
    try {
        const parsed = JSON.parse(await readFile(localRulesPath(), 'utf8'));
        const cleanMap = (value) => {
            const result = Object.create(null);
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return result;
            for (const [key, items] of Object.entries(value)) {
                if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || !Array.isArray(items))
                    continue;
                result[key] = items.filter((item) => typeof item === 'string');
            }
            return result;
        };
        return { adoptions: cleanMap(parsed?.adoptions), localRules: cleanMap(parsed?.localRules) };
    }
    catch { }
    return { adoptions: {}, localRules: {} };
}
// Cross-process writes are unlocked: lost approvals fail closed and at most require confirmation again.
let localWrite = Promise.resolve();
function updateLocalRules(update) {
    const operation = localWrite.then(async () => {
        const state = await readLocalRules();
        await update(state);
        const file = localRulesPath();
        await mkdir(dirname(file), { recursive: true });
        let invalidShape = false;
        try {
            const parsed = JSON.parse(await readFile(file, 'utf8'));
            const isPlainMap = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
            invalidShape = !isPlainMap(parsed) || ['adoptions', 'localRules'].some(key => Object.hasOwn(parsed, key) && !isPlainMap(parsed[key]));
        }
        catch (error) {
            if (error instanceof SyntaxError)
                invalidShape = true;
            else if (error.code !== 'ENOENT')
                throw error;
        }
        if (invalidShape)
            await copyFile(file, `${file}.bak`);
        const temp = join(dirname(file), `.project-rule-adoptions-${process.pid}-${randomUUID()}.tmp`);
        try {
            await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await rename(temp, file);
        }
        finally {
            await unlink(temp).catch(() => { });
        }
    });
    localWrite = operation.catch(() => { });
    return operation;
}
export async function listPendingProjectRules(cwd) {
    const settings = await loadSettings(cwd);
    return [...new Set(settings.project.permissions?.allow ?? [])].filter(rule => !settings.approvedProjectAllow.includes(rule));
}
/** Record only a current, individually confirmed project rule. */
export async function adoptProjectRule(cwd, rule) {
    cwd = await resolveProjectPath(cwd);
    await updateLocalRules(async (state) => {
        const project = await readSettings(getProjectSettingsPath(cwd));
        if (!project.permissions?.allow?.includes(rule))
            throw new Error('Project rule is no longer present');
        const key = projectKey(cwd);
        state.adoptions[key] = [...new Set([...(state.adoptions[key] ?? []), ruleHash(rule)])];
    });
}
async function resolveProjectPath(cwd) {
    return realpath(cwd).catch(() => resolve(cwd));
}
