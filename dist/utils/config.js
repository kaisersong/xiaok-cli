import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_CONFIG, isValidLegacyProvider } from '../types.js';
import { normalizeConfig } from '../ai/providers/normalize.js';
export function getConfigDir(subdir) {
    const base = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
    return subdir ? join(base, subdir) : base;
}
export function getConfigPath() {
    return join(getConfigDir(), 'config.json');
}
/** config.json 里有模型 API Key，只允许当前用户读写。只处理文件本身，不动整个配置目录。 */
const CONFIG_FILE_MODE = 0o600;
export class ConfigPermissionError extends Error {
    constructor(path, cause) {
        super(`无法把 ${path} 的权限收紧为仅本人可读写，为避免 API Key 被其他用户读到，已停止写入。请检查文件所有者和权限（Mac/Linux 可运行 chmod 600 ${path}）。`);
        this.name = 'ConfigPermissionError';
        this.cause = cause;
    }
}
/** 读取时尽力收紧老版本留下的 644 文件，失败不阻断读取。Windows 不使用 POSIX 权限位。 */
function tightenBestEffort(path) {
    if (process.platform === 'win32')
        return;
    try {
        if (existsSync(path) && (statSync(path).mode & 0o777) !== CONFIG_FILE_MODE)
            chmodSync(path, CONFIG_FILE_MODE);
    }
    catch {
        // 读取路径上不报错；真正写入 Key 前会严格检查
    }
}
/** 写入 Key 前必须把文件收紧到 600；做不到就抛错，绝不把 Key 写进别人可读的文件。 */
function tightenOrThrow(path) {
    if (process.platform === 'win32')
        return;
    try {
        if ((statSync(path).mode & 0o777) !== CONFIG_FILE_MODE)
            chmodSync(path, CONFIG_FILE_MODE);
        if ((statSync(path).mode & 0o777) !== CONFIG_FILE_MODE)
            throw new Error('mode unchanged after chmod');
    }
    catch (error) {
        throw new ConfigPermissionError(path, error);
    }
}
/** Rename path to path+'.bak', removing any stale .bak first (Windows EPERM guard). */
function backupAndRemove(path) {
    const bak = path + '.bak';
    if (existsSync(bak))
        rmSync(bak, { force: true });
    renameSync(path, bak);
    tightenBestEffort(bak);
}
/** 深拷贝 DEFAULT_CONFIG，避免浅拷贝导致 models 引用共享 */
function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
export async function loadConfig() {
    const path = getConfigPath();
    // 老版本写出的是 644：不管 config.json 是否存在，都顺手收紧它和 .bak，老用户升级后自动修复。
    tightenBestEffort(path);
    tightenBestEffort(path + '.bak');
    if (!existsSync(path))
        return cloneDefaultConfig();
    let raw;
    try {
        raw = readFileSync(path, 'utf-8');
    }
    catch {
        return cloneDefaultConfig();
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        backupAndRemove(path);
        return cloneDefaultConfig();
    }
    const obj = parsed;
    if (obj.schemaVersion !== 1 && obj.schemaVersion !== 2) {
        backupAndRemove(path);
        return cloneDefaultConfig();
    }
    if (obj.schemaVersion === 1 && obj.defaultModel !== undefined && !isValidLegacyProvider(obj.defaultModel)) {
        backupAndRemove(path);
        return cloneDefaultConfig();
    }
    return normalizeConfig(obj);
}
export async function saveConfig(config) {
    mkdirSync(getConfigDir(), { recursive: true });
    const path = getConfigPath();
    // 老文件可能是 644：先收紧再写入，收紧失败就中止，避免新 Key 写进别人可读的文件。
    if (existsSync(path))
        tightenOrThrow(path);
    // mode 只在新建文件时生效；写完再确认一次。
    writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: CONFIG_FILE_MODE });
    tightenOrThrow(path);
}
