import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertInstalledControllerLifetime } from './installed-controller-lifetime.js';
import { assertRootProtectedFile, assertRootProtectedExecutable } from './installed-identity.js';
import { parseDeploymentPackageInventory, verifyDeploymentPackage } from './deployment-package.js';
import { readExistingEngineBootstrap } from './engine-bootstrap-journal.js';
import { buildPrivateMacEnginePlan } from './macos-engine-bootstrap.js';
import { runInstallationCommand, assertInstallationCommandIdle } from './installation-command.js';
import { verifyEngineBinaryCensus, ENGINE_BINARY_CENSUS_SCRIPT } from './engine-binary-census.js';
import { canonicalVerificationJson as json } from './protocol.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const attachments = new WeakMap();
export function readMaintenanceEngineAttachment(handle, lifetime) { const known = attachments.get(handle); if (!known || known.lifetime !== lifetime)
    throw Error('maintenance_engine_identity'); known.current(); return known.facts; }
/** Fixed, read-only attachment. No normal installed-engine registration is made,
 * and no create/start/load/qualification port is reachable from this factory. */
export async function attachInstalledMacEngineForMaintenance(input) {
    const { lifetime, signal } = input;
    assertInstalledControllerLifetime(lifetime);
    if (process.platform !== 'darwin' || process.arch !== 'arm64')
        throw Error('installed_engine_platform');
    const { database: db, state, release, manifest } = lifetime;
    if (db.inTransaction)
        throw Error('engine_bootstrap_outer_transaction');
    assertInstallationCommandIdle(state);
    const baseline = readExistingEngineBootstrap(db), baselineJson = json(baseline);
    if (baseline.proposal.deploymentHash !== manifest.packageHash || baseline.observation.processUid !== manifest.serviceUid)
        throw Error('maintenance_engine_deployment');
    const inventoryPath = join(lifetime.base, 'releases', manifest.packageHash + '.json');
    assertRootProtectedFile(inventoryPath);
    if (lstatSync(inventoryPath).size > 8 * 1024 ** 2)
        throw Error('maintenance_engine_inventory');
    const inventory = parseDeploymentPackageInventory(JSON.parse(readFileSync(inventoryPath, 'utf8')));
    if (inventory.packageHash !== manifest.packageHash)
        throw Error('maintenance_engine_inventory');
    verifyDeploymentPackage(release, inventory);
    const sources = JSON.parse(readFileSync(join(release, 'runtime-sources.json'), 'utf8'));
    for (const key of ['baseImage', 'engine', 'workerImage'])
        if (!/^[a-f0-9]{64}$/.test(sources[key]?.sha256))
            throw Error('installed_engine_sources');
    if (!/^sha256:[a-f0-9]{64}$/.test(sources.workerImage.imageId))
        throw Error('installed_engine_image');
    const binaries = JSON.parse(readFileSync(join(release, 'vm/engine-files.json'), 'utf8')), plan = buildPrivateMacEnginePlan({ releaseRoot: release, stateRoot: state, baseImageSha256: sources.baseImage.sha256, dockerArchiveSha256: sources.engine.sha256, creationNonce: baseline.proposal.creationNonce });
    for (const [name, digest] of [['copy-engine', sources.engine.sha256], ['install-engine', hash(plan.bootstrapScript)], ['load-worker', sources.workerImage.sha256]])
        if (baseline.phases[name]?.digest !== digest)
            throw Error('maintenance_engine_phase_changed');
    const observer = join(release, 'bin/process-observation');
    assertRootProtectedExecutable(observer);
    assertRootProtectedExecutable(plan.executable);
    const admission = new AbortController(), activeSignal = signal ? AbortSignal.any([signal, admission.signal]) : admission.signal;
    let closed = false, invalidated = false, pending;
    function privateText(path, max = 2 * 1024 ** 2) { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== manifest.serviceUid || (stat.mode & 0o022) || stat.size > max)
        throw Error('maintenance_engine_private_file'); return readFileSync(path, 'utf8'); }
    function current() { if (closed)
        throw Error('maintenance_engine_closed'); if (invalidated)
        throw Error('maintenance_engine_invalidated'); activeSignal.throwIfAborted(); assertInstalledControllerLifetime(lifetime); if (json(readExistingEngineBootstrap(db)) !== baselineJson || privateText(plan.configPath) !== plan.configJson)
        throw Error('maintenance_engine_changed'); const socket = lstatSync(plan.hostSocket); if (!socket.isSocket() || socket.uid !== manifest.serviceUid || socket.nlink !== 1)
        throw Error('maintenance_engine_socket'); }
    async function run(executable, argv, stdin = '') { current(); const output = await runInstallationCommand({ scope: state, executable, argv, cwd: state, env: plan.env, stdin, timeoutMs: 30000, signal: activeSignal, assertCurrent: current }); current(); return output.toString('utf8'); }
    const shell = (script) => run(plan.executable, ['shell', plan.name, 'sudo', '-n', '/bin/sh', '-s'], script);
    async function census() {
        current();
        if (hash(await run(plan.executable, ['validate', '--fill', plan.configPath])) !== baseline.proposal.configHash)
            throw Error('maintenance_engine_config');
        const directory = join(state, 'lima', plan.name), pid = privateText(join(directory, 'qemu.pid'), 64).trim();
        if (!/^[1-9][0-9]{0,9}$/.test(pid))
            throw Error('installed_engine_pid');
        const before = JSON.parse(await run(observer, [pid]));
        if (before.uid !== manifest.serviceUid || before.realUid !== manifest.serviceUid || before.executable !== join(release, 'bin/qemu-system-aarch64') || before.startIdentity !== baseline.observation.processStartIdentity)
            throw Error('maintenance_engine_process');
        if (hash(await run(plan.executable, ['validate', '--fill', join(directory, 'lima.yaml')])) !== baseline.proposal.configHash)
            throw Error('maintenance_engine_config');
        const ids = (await shell('set -eu\ncat /etc/machine-id\ncat /proc/sys/kernel/random/boot_id\ncat /etc/xiaok-controller-creation-nonce\n')).trim().split('\n');
        if (ids.length !== 3 || ids[0] !== baseline.observation.machineId || ids[1] !== baseline.observation.bootId || ids[2] !== baseline.proposal.creationNonce)
            throw Error('maintenance_engine_guest');
        const docker = '/usr/local/lib/xiaok-engine/docker --host unix:///run/xiaok-engine/docker.sock';
        const engine = JSON.parse(await shell(`${docker} info --format '{{json .}}'\n`));
        if (engine.ID !== baseline.observation.engineId || engine.OSType !== 'linux' || !['aarch64', 'arm64'].includes(engine.Architecture))
            throw Error('maintenance_engine_identity_changed');
        await shell(`set -eu\n[ ! -L /etc/systemd/system/xiaok-engine.service ]\nprintf '%s  %s\\n' '${hash(plan.unit)}' '/etc/systemd/system/xiaok-engine.service' | sha256sum -c - >/dev/null\nsystemctl is-active --quiet xiaok-engine.service\n`);
        verifyEngineBinaryCensus(binaries, await shell(ENGINE_BINARY_CENSUS_SCRIPT));
        if ((await shell(`${docker} image inspect '${sources.workerImage.imageId}' --format '{{.Id}}'\n`)).trim() !== sources.workerImage.imageId)
            throw Error('maintenance_engine_image');
        const after = JSON.parse(await run(observer, [pid]));
        if (json(before) !== json(after))
            throw Error('maintenance_engine_process_changed');
        current();
    }
    function inspect() { if (pending)
        throw Error('maintenance_engine_busy'); current(); const work = census().catch(error => { invalidated = true; throw error; }); pending = work; void work.then(() => { if (pending === work)
        pending = undefined; }, () => { if (pending === work)
        pending = undefined; }); return work; }
    await inspect();
    const handle = Object.freeze({ inspect, async close() { admission.abort(); const work = pending; try {
            if (work)
                await work;
        }
        finally {
            closed = true;
            attachments.delete(handle);
        } } });
    attachments.set(handle, { lifetime, current, facts: Object.freeze({ hostSocket: plan.hostSocket, imageDigest: sources.workerImage.imageId, engineBinding: Object.freeze({ engineId: baseline.observation.engineId, incarnation: hash(json(baseline.observation)), epoch: 1 }) }) });
    return handle;
}
