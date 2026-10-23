import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
/** Packaging diagnostic only. The service separately checks root ownership and installed identity. */
export function buildMacRuntimeProbe(releaseRoot, stateRoot) {
    if (!isAbsolute(releaseRoot) || !isAbsolute(stateRoot) || releaseRoot.includes('\0') || stateRoot.includes('\0'))
        throw Error('runtime_probe_path');
    const release = resolve(releaseRoot), state = resolve(stateRoot);
    const base = { PATH: '/usr/bin:/bin', HOME: state, LC_ALL: 'C' };
    return Object.freeze({
        qemu: Object.freeze({ executable: join(release, 'bin', 'qemu-system-aarch64'), argv: Object.freeze(['--version']), env: Object.freeze({ ...base,
                DYLD_LIBRARY_PATH: join(release, 'lib'), DYLD_FALLBACK_LIBRARY_PATH: '/var/empty', DYLD_PRINT_LIBRARIES: '1',
                GIO_MODULE_DIR: join(release, 'empty'), GIO_EXTRA_MODULES: join(release, 'empty'),
                QEMU_MODULE_DIR: join(release, 'lib', 'qemu'),
            }) }),
        lima: Object.freeze({ executable: join(release, 'bin', 'limactl'), argv: Object.freeze(['--version']), env: Object.freeze({ ...base, LIMA_HOME: join(state, 'lima') }) }),
    });
}
/** Admits only observed frozen images or the OS-owned shared-cache namespace, never arbitrary Homebrew. */
export function inspectMacRuntimeLoadTrace(releaseRoot, input, stderr) {
    const inventory = parseDeploymentPackageInventory(input);
    const root = resolve(releaseRoot), allowed = new Set(inventory.files.map(file => file.path));
    const paths = [...stderr.matchAll(/^dyld\[\d+\]: <[A-Fa-f0-9-]+> (\/[^\r\n]+)$/gm)].map(match => match[1]);
    if (!paths.length)
        throw Error('runtime_load_trace_missing');
    for (const path of paths) {
        const normalized = resolve(path);
        const rel = relative(root, normalized);
        if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && allowed.has(rel.split('\\').join('/')))
            continue;
        // A version trace is not proof of the contents of the OS. Installed qualification binds the OS build.
        if (normalized.startsWith('/usr/lib/') || normalized.startsWith('/System/Library/'))
            continue;
        throw Error('runtime_unfrozen_dependency');
    }
    if (!paths.includes(join(root, 'bin', 'qemu-system-aarch64')))
        throw Error('runtime_executable_not_observed');
    return Object.freeze([...new Set(paths)]);
}
/** Calls the actual packaged executables after full byte census, and verifies the census again afterwards. */
export function probeFrozenMacRuntime(input) {
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
        throw Error('runtime_probe_platform');
    verifyDeploymentPackage(input.releaseRoot, input.inventory);
    const plan = buildMacRuntimeProbe(input.releaseRoot, input.stateRoot);
    const run = (probe) => {
        const result = spawnSync(probe.executable, [...probe.argv], { cwd: input.stateRoot, env: { ...probe.env }, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 ** 2 });
        if (result.error || result.status !== 0 || result.signal)
            throw Error('runtime_probe_failed');
        return result;
    };
    const qemu = run(plan.qemu), lima = run(plan.lima);
    if (!/^QEMU emulator version \d+\.\d+\.\d+/m.test(qemu.stdout) || !/^limactl version \d+\.\d+\.\d+/m.test(lima.stdout))
        throw Error('runtime_probe_version');
    const loadedImages = inspectMacRuntimeLoadTrace(input.releaseRoot, input.inventory, qemu.stderr);
    verifyDeploymentPackage(input.releaseRoot, input.inventory);
    return Object.freeze({ qemuVersion: qemu.stdout.trim(), limaVersion: lima.stdout.trim(), loadedImages });
}
