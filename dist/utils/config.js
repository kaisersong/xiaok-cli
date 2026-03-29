import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DEFAULT_CONFIG, isValidProvider } from '../types.js';
export function getConfigDir() {
    return process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
}
export function getConfigPath() {
    return join(getConfigDir(), 'config.json');
}
/** Rename path to path+'.bak', removing any stale .bak first (Windows EPERM guard). */
function backupAndRemove(path) {
    const bak = path + '.bak';
    if (existsSync(bak))
        rmSync(bak, { force: true });
    renameSync(path, bak);
}
/** 深拷贝 DEFAULT_CONFIG，避免浅拷贝导致 models 引用共享 */
function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
export async function loadConfig() {
    const path = getConfigPath();
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
    if (obj.schemaVersion !== 1) {
        backupAndRemove(path);
        return cloneDefaultConfig();
    }
    // 校验 defaultModel，防止脏数据
    if (obj.defaultModel !== undefined && !isValidProvider(obj.defaultModel)) {
        backupAndRemove(path);
        return cloneDefaultConfig();
    }
    return { ...cloneDefaultConfig(), ...obj, schemaVersion: 1 };
}
export async function saveConfig(config) {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
