import { spawn } from 'node:child_process';
const PACKAGE_SPEC = 'xiaokcode@latest';
function parseSemver(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
    if (!match)
        return null;
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split('.') : [],
    };
}
export function compareSemver(left, right) {
    const a = parseSemver(left);
    const b = parseSemver(right);
    if (!a || !b)
        throw new Error(`无法比较版本：${left} / ${right}`);
    for (let index = 0; index < a.core.length; index += 1) {
        if (a.core[index] !== b.core[index])
            return a.core[index] - b.core[index];
    }
    if (a.prerelease.length === 0 && b.prerelease.length === 0)
        return 0;
    if (a.prerelease.length === 0)
        return 1;
    if (b.prerelease.length === 0)
        return -1;
    const length = Math.max(a.prerelease.length, b.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const aPart = a.prerelease[index];
        const bPart = b.prerelease[index];
        if (aPart === undefined)
            return -1;
        if (bPart === undefined)
            return 1;
        if (aPart === bPart)
            continue;
        const aNumeric = /^\d+$/.test(aPart);
        const bNumeric = /^\d+$/.test(bPart);
        if (aNumeric && bNumeric)
            return Number(aPart) - Number(bPart);
        if (aNumeric)
            return -1;
        if (bNumeric)
            return 1;
        return aPart.localeCompare(bPart);
    }
    return 0;
}
export function parseLatestVersion(output) {
    let parsed;
    try {
        parsed = JSON.parse(output.trim());
    }
    catch {
        throw new Error('npm registry 返回了无法解析的 JSON');
    }
    const version = typeof parsed === 'string'
        ? parsed
        : Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string'
            ? parsed[0]
            : null;
    if (!version || !parseSemver(version)) {
        throw new Error('npm registry 返回的版本无效');
    }
    return version;
}
export function buildNpmUpdateInvocation(kind, platform = process.platform) {
    const windows = platform === 'win32';
    return {
        command: windows ? 'npm.cmd' : 'npm',
        args: kind === 'view'
            ? ['view', PACKAGE_SPEC, 'version', '--json']
            : ['install', '--global', PACKAGE_SPEC],
        shell: windows,
        stdio: kind === 'view' ? 'pipe' : 'inherit',
    };
}
const defaultRunner = async (invocation) => new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
        shell: invocation.shell,
        stdio: invocation.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_update_notifier: 'false' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => reject(new Error(`无法启动 npm：${error.message}`)));
    child.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
});
export async function runUpdateCommand(currentVersion, dependencies = {}) {
    const run = dependencies.run ?? defaultRunner;
    const log = dependencies.log ?? console.log;
    const platform = dependencies.platform ?? process.platform;
    log(`正在检查 xiaok 更新（当前 ${currentVersion}）...`);
    const lookup = await run(buildNpmUpdateInvocation('view', platform));
    if (lookup.exitCode !== 0) {
        const detail = lookup.stderr.trim() || `npm exited with code ${lookup.exitCode}`;
        throw new Error(`查询 npm registry 失败：${detail}`);
    }
    const latestVersion = parseLatestVersion(lookup.stdout);
    const comparison = compareSemver(currentVersion, latestVersion);
    if (comparison === 0) {
        log(`xiaok ${currentVersion} 已经是最新版。`);
        return { status: 'current', currentVersion, latestVersion };
    }
    if (comparison > 0) {
        log(`当前版本 ${currentVersion} 高于 npm latest ${latestVersion}，不会自动降级。`);
        return { status: 'newer', currentVersion, latestVersion };
    }
    log(`发现新版本 ${latestVersion}，正在更新 xiaok...`);
    const install = await run(buildNpmUpdateInvocation('install', platform));
    if (install.exitCode !== 0) {
        const detail = install.stderr.trim() || `npm exited with code ${install.exitCode}`;
        if (/EACCES|EPERM|permission/i.test(detail)) {
            throw new Error(`更新失败：npm 全局目录无写权限。请修复 npm prefix 或目录权限后重试。${detail}`);
        }
        throw new Error(`更新失败：${detail}`);
    }
    log(`更新命令已完成：${currentVersion} → latest（查询时为 ${latestVersion}）。请运行 xiaok --version 验证。`);
    return { status: 'updated', currentVersion, latestVersion };
}
export function registerUpdateCommand(program, currentVersion, dependencies = {}) {
    program
        .command('update')
        .description('将 xiaok CLI 更新到 npm 上的最新版')
        .action(async () => {
        try {
            await runUpdateCommand(currentVersion, dependencies);
        }
        catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    });
}
