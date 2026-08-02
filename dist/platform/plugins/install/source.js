import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync, } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { GIT_MODE_GITLINK, GIT_MODE_SYMLINK, assertPluginRelativePath, assertSafeRelativePath, computeGitTreeSha256, detectPathConflicts, isSupportedGitMode, sha256Hex, } from './integrity.js';
export function resolveInstallPaths(pluginsDir) {
    return {
        pluginsDir,
        managedDir: join(pluginsDir, '.managed'),
        activeDir: join(pluginsDir, '.active'),
        locksDir: join(pluginsDir, '.locks'),
        runtimesDir: join(pluginsDir, '.runtimes'),
    };
}
export function resolveDefaultPluginsDir(env = process.env) {
    const home = env.HOME || env.USERPROFILE || homedir();
    return resolve(home, '.xiaok', 'plugins');
}
export const RESERVED_PLUGIN_DIR_NAMES = ['.managed', '.active', '.locks', '.runtimes'];
const DEFAULT_TIMEOUT_MS = 120_000;
const STDERR_LIMIT = 8192;
function spawnCollect(command, args, options, mode) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
        });
        const hash = mode === 'hash' ? createHash('sha256') : null;
        const chunks = [];
        let bytes = 0;
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            stderr = `${stderr}\n[timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms]`;
        }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        timer.unref?.();
        child.stdout.on('data', (chunk) => {
            bytes += chunk.byteLength;
            if (hash)
                hash.update(chunk);
            else
                chunks.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT);
        });
        child.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            rejectPromise(error);
        });
        child.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolvePromise({
                code: code ?? 1,
                stdout: mode === 'hash' ? Buffer.alloc(0) : Buffer.concat(chunks),
                stderr,
                sha256: hash ? hash.digest('hex') : '',
                bytes,
            });
        });
    });
}
export const defaultCommandRunner = {
    async run(command, args, options = {}) {
        const result = await spawnCollect(command, args, options, 'string');
        return { code: result.code, stdout: result.stdout.toString('utf8'), stderr: result.stderr };
    },
    async runBuffer(command, args, options = {}) {
        const result = await spawnCollect(command, args, options, 'buffer');
        return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    },
    async hashStdout(command, args, options = {}) {
        const result = await spawnCollect(command, args, options, 'hash');
        return { code: result.code, sha256: result.sha256, bytes: result.bytes, stderr: result.stderr };
    },
};
export function createRecordingRunner(inner) {
    const invocations = [];
    const record = (command, args, options) => {
        invocations.push({ command, args: [...args], cwd: options?.cwd, env: options?.env });
    };
    return {
        invocations,
        run(command, args, options) {
            record(command, args, options);
            return inner.run(command, args, options);
        },
        runBuffer(command, args, options) {
            record(command, args, options);
            return inner.runBuffer(command, args, options);
        },
        hashStdout(command, args, options) {
            record(command, args, options);
            return inner.hashStdout(command, args, options);
        },
    };
}
/**
 * Git reads credentials, proxies, hooks and rewrite rules from ambient config,
 * so the install transaction runs with those inputs stripped rather than trusted.
 */
export function createGitEnv(baseEnv = process.env, allowLocalSource = false) {
    const env = {};
    for (const [key, value] of Object.entries(baseEnv)) {
        if (value === undefined)
            continue;
        if (key.startsWith('GIT_'))
            continue;
        if (key === 'SSH_ASKPASS' || key === 'SSH_AUTH_SOCK')
            continue;
        env[key] = value;
    }
    env.GIT_CONFIG_NOSYSTEM = '1';
    env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_CONFIG_SYSTEM = process.platform === 'win32' ? 'NUL' : '/dev/null';
    env.GIT_ATTR_NOSYSTEM = '1';
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_ALLOW_PROTOCOL = allowLocalSource ? 'https:file' : 'https';
    env.GIT_PROTOCOL_FROM_USER = '0';
    env.GIT_ADVICE = '0';
    return env;
}
function resolveCloneUrl(entry, options) {
    const cloneUrl = options.cloneUrl ?? entry.repo.cloneUrl;
    if (cloneUrl.startsWith('https://')) {
        const url = new URL(cloneUrl);
        if (url.host !== 'github.com') {
            throw new Error(`Plugin source must be hosted on github.com, got "${url.host}"`);
        }
        if (!options.cloneUrl && cloneUrl !== entry.repo.cloneUrl) {
            throw new Error(`Plugin source URL does not match registry repo "${entry.repo.owner}/${entry.repo.name}"`);
        }
        return cloneUrl;
    }
    if (!options.allowLocalSource) {
        throw new Error(`Plugin source must be an https://github.com/... URL, got "${cloneUrl}"`);
    }
    if (!isAbsolute(cloneUrl) || !existsSync(cloneUrl)) {
        throw new Error(`Local plugin source "${cloneUrl}" must be an existing absolute path`);
    }
    return cloneUrl;
}
function parseTreeRecords(stdout, pluginPathPrefix) {
    const records = [];
    for (const raw of stdout.split('\0')) {
        if (!raw)
            continue;
        const tabIndex = raw.indexOf('\t');
        if (tabIndex === -1) {
            throw new Error(`Unparsable git tree record: ${JSON.stringify(raw)}`);
        }
        const meta = raw.slice(0, tabIndex).split(' ');
        if (meta.length !== 3) {
            throw new Error(`Unparsable git tree record: ${JSON.stringify(raw)}`);
        }
        const repoPath = raw.slice(tabIndex + 1);
        if (!repoPath.startsWith(pluginPathPrefix)) {
            throw new Error(`Git tree record "${repoPath}" is outside the plugin path`);
        }
        records.push({
            mode: meta[0],
            type: meta[1],
            oid: meta[2],
            repoPath,
            pluginPath: repoPath.slice(pluginPathPrefix.length),
        });
    }
    return records;
}
function assertSafeSymlinkTarget(pluginRelPath, target) {
    if (isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\')) {
        throw new Error(`Refusing absolute symlink "${pluginRelPath}" -> "${target}"`);
    }
    if (target.includes('\0')) {
        throw new Error(`Refusing symlink "${pluginRelPath}" with an invalid target`);
    }
    const linkDir = dirname(pluginRelPath);
    const resolved = resolve('/plugin-root', linkDir === '.' ? '' : linkDir, target);
    const rel = relative('/plugin-root', resolved);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(`Refusing symlink "${pluginRelPath}" -> "${target}" that escapes the plugin root`);
    }
}
function listActualPaths(root) {
    const found = [];
    const walk = (dir, prefix) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
            const relPath = prefix ? `${prefix}/${item.name}` : item.name;
            if (item.isDirectory() && !item.isSymbolicLink()) {
                walk(join(dir, item.name), relPath);
                continue;
            }
            found.push(relPath);
        }
    };
    walk(root, '');
    return found;
}
export async function stagePluginSource(options) {
    const { entry, paths } = options;
    const runner = options.runner ?? defaultCommandRunner;
    const platform = options.platform ?? process.platform;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const commit = entry.source.commit;
    const cloneUrl = resolveCloneUrl(entry, options);
    const env = createGitEnv(process.env, Boolean(options.allowLocalSource));
    const versionDir = join(paths.managedDir, entry.name, entry.source.treeSha256);
    const repoDir = join(versionDir, 'repo');
    const pluginDir = join(repoDir, ...entry.path.split('/'));
    const hooksDir = join(versionDir, 'no-hooks');
    const reuse = Boolean(options.reuseExistingCheckout) && existsSync(join(repoDir, '.git'));
    const gitConfigArgs = [
        '-c', 'credential.helper=',
        '-c', 'http.followRedirects=false',
        '-c', 'http.proxy=',
        '-c', 'https.proxy=',
        '-c', `core.hooksPath=${hooksDir}`,
        '-c', `core.symlinks=${platform === 'win32' ? 'false' : 'true'}`,
        '-c', 'core.autocrlf=false',
        '-c', 'core.fsmonitor=',
        '-c', 'protocol.version=2',
        '-c', 'submodule.recurse=false',
        '-c', 'fetch.recurseSubmodules=no',
        '-c', 'advice.detachedHead=false',
        '-c', 'gc.auto=0',
        '-c', 'uploadpack.allowAnySHA1InWant=true',
    ];
    const git = async (args) => {
        const result = await runner.run('git', [...gitConfigArgs, '-C', repoDir, ...args], {
            env,
            timeoutMs,
        });
        if (result.code !== 0) {
            throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr.trim()}`);
        }
        return result.stdout;
    };
    if (!reuse) {
        rmSync(versionDir, { recursive: true, force: true });
    }
    mkdirSync(hooksDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    try {
        if (!reuse) {
            const init = await runner.run('git', [...gitConfigArgs, 'init', '--quiet', '--initial-branch=xiaok-install', repoDir], { env, timeoutMs });
            if (init.code !== 0) {
                throw new Error(`git init failed (exit ${init.code}): ${init.stderr.trim()}`);
            }
            await git(['remote', 'add', 'origin', cloneUrl]);
            const fetch = await runner.run('git', [
                ...gitConfigArgs,
                '-C', repoDir,
                'fetch',
                '--quiet',
                '--depth', '1',
                '--no-tags',
                '--no-recurse-submodules',
                'origin',
                commit,
            ], { env, timeoutMs });
            if (fetch.code !== 0) {
                throw new Error(`git fetch of pinned commit ${commit} failed (exit ${fetch.code}): ${fetch.stderr.trim()}`);
            }
            const fetched = (await git(['rev-parse', 'FETCH_HEAD^{commit}'])).trim();
            if (fetched !== commit) {
                throw new Error(`Fetched commit ${fetched} does not match the pinned commit ${commit}`);
            }
        }
        const prefix = `${entry.path}/`;
        const treeStdout = await git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', entry.path]);
        const records = parseTreeRecords(treeStdout, prefix);
        if (records.length === 0) {
            throw new Error(`Plugin path "${entry.path}" is missing from commit ${commit}`);
        }
        const entries = [];
        const symlinkTargets = new Map();
        for (const record of records) {
            if (record.mode === GIT_MODE_GITLINK || record.type === 'commit') {
                throw new Error(`Refusing gitlink/submodule entry "${record.pluginPath}" in plugin source`);
            }
            if (!isSupportedGitMode(record.mode)) {
                throw new Error(`Unsupported git mode ${record.mode} for "${record.pluginPath}"`);
            }
            assertSafeRelativePath(record.pluginPath, `Plugin file "${record.pluginPath}"`);
            if (record.mode === GIT_MODE_SYMLINK) {
                const blob = await runner.runBuffer('git', [...gitConfigArgs, '-C', repoDir, 'cat-file', 'blob', record.oid], {
                    env,
                    timeoutMs,
                });
                if (blob.code !== 0) {
                    throw new Error(`Unable to read symlink blob for "${record.pluginPath}": ${blob.stderr.trim()}`);
                }
                const target = blob.stdout.toString('utf8');
                assertSafeSymlinkTarget(record.pluginPath, target);
                symlinkTargets.set(record.pluginPath, target);
                entries.push({ mode: record.mode, path: record.pluginPath, contentSha256: sha256Hex(blob.stdout) });
                continue;
            }
            const hashed = await runner.hashStdout('git', [...gitConfigArgs, '-C', repoDir, 'cat-file', 'blob', record.oid], { env, timeoutMs });
            if (hashed.code !== 0) {
                throw new Error(`Unable to read blob for "${record.pluginPath}": ${hashed.stderr.trim()}`);
            }
            entries.push({ mode: record.mode, path: record.pluginPath, contentSha256: hashed.sha256 });
        }
        const conflicts = detectPathConflicts(entries.map((item) => item.path));
        if (conflicts.length > 0) {
            throw new Error(`Plugin source has conflicting paths on case-insensitive filesystems: ${conflicts.join(', ')}`);
        }
        const digest = computeGitTreeSha256(entries);
        if (digest !== entry.source.treeSha256) {
            throw new Error(`Plugin source digest mismatch for "${entry.name}": registry declares treeSha256 ${entry.source.treeSha256} but commit ${commit} yields ${digest}`);
        }
        if (!reuse) {
            const sparseFile = join(repoDir, '.git', 'info', 'sparse-checkout');
            mkdirSync(dirname(sparseFile), { recursive: true });
            writeFileSync(sparseFile, `/${entry.path}/\n`, 'utf8');
            await git(['config', 'core.sparseCheckout', 'true']);
            await git(['checkout', '--quiet', '--detach', commit]);
        }
        if (!existsSync(pluginDir)) {
            throw new Error(`Plugin path "${entry.path}" was not materialized from commit ${commit}`);
        }
        const expected = new Map(entries.map((item) => [item.path, item]));
        for (const item of entries) {
            const absolute = assertPluginRelativePath(pluginDir, item.path, `Plugin file "${item.path}"`);
            if (item.mode === GIT_MODE_SYMLINK) {
                const target = symlinkTargets.get(item.path);
                materializeSymlink(pluginDir, absolute, item.path, target, expected, platform);
                continue;
            }
            if (!existsSync(absolute)) {
                throw new Error(`Verified file "${item.path}" is missing from the checkout`);
            }
            const stat = lstatSync(absolute);
            if (stat.isSymbolicLink() || !stat.isFile()) {
                throw new Error(`Checked-out "${item.path}" is not a regular file`);
            }
            const actual = sha256Hex(readFileSync(absolute));
            if (actual !== item.contentSha256) {
                throw new Error(`Checked-out bytes of "${item.path}" do not match the verified Git object (expected ${item.contentSha256}, got ${actual})`);
            }
        }
        const actualPaths = listActualPaths(pluginDir);
        for (const actualPath of actualPaths) {
            if (!expected.has(actualPath)) {
                throw new Error(`Unexpected file "${actualPath}" in the checked-out plugin directory`);
            }
        }
        return { versionDir, repoDir, pluginDir, digest, commit, entries };
    }
    catch (error) {
        if (!reuse) {
            rmSync(versionDir, { recursive: true, force: true });
        }
        throw error;
    }
}
function materializeSymlink(pluginDir, absolute, pluginRelPath, target, expected, platform) {
    const linkDir = dirname(pluginRelPath);
    const targetRel = relative(pluginDir, resolve(pluginDir, linkDir === '.' ? '' : linkDir, target))
        .split(sep)
        .join('/');
    const targetEntry = expected.get(targetRel);
    if (platform !== 'win32') {
        if (!lstatSafe(absolute)) {
            throw new Error(`Verified symlink "${pluginRelPath}" is missing from the checkout`);
        }
        const stat = lstatSync(absolute);
        if (!stat.isSymbolicLink()) {
            throw new Error(`Verified symlink "${pluginRelPath}" was checked out as a regular file`);
        }
        if (readlinkSync(absolute) !== target) {
            throw new Error(`Symlink "${pluginRelPath}" points at "${readlinkSync(absolute)}" instead of "${target}"`);
        }
        return;
    }
    if (!targetEntry || targetEntry.mode === GIT_MODE_SYMLINK) {
        throw new Error(`Symlink "${pluginRelPath}" cannot be materialized on Windows because "${targetRel}" is not a verified regular file`);
    }
    const targetAbsolute = assertPluginRelativePath(pluginDir, targetRel, `Symlink target "${targetRel}"`);
    const actual = sha256Hex(readFileSync(targetAbsolute));
    if (actual !== targetEntry.contentSha256) {
        throw new Error(`Symlink target "${targetRel}" does not match its verified Git object`);
    }
    rmSync(absolute, { force: true });
    copyFileSync(targetAbsolute, absolute);
}
function lstatSafe(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch {
        return false;
    }
}
