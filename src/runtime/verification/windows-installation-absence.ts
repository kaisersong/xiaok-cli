import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { machine } from 'node:os';
type WindowsInstallationObservation = 'ordinary' | 'installed' | 'unavailable';
type IntegrityMemo = { helper: string; manifestPath: string; key: string | undefined; manifestBytes: Buffer; manifest: { sha256: string } };
/** Process-lifetime memo of the helper integrity check only (manifest parse and
 * helper sha256), bound to both files' identity. Never holds a helper answer. */
let integrityMemo: IntegrityMemo | undefined;
/** One write job's absence observation, opened and closed by that job. The
 * object is opaque: only this module fills or reads its answer. */
export type WindowsAbsenceJobScope = Readonly<{ close(): void }>;
const jobScopes = new WeakMap<object, { open: boolean; ordinary: boolean }>();
export function openWindowsAbsenceJobScope(): WindowsAbsenceJobScope {
    const state = { open: true, ordinary: false };
    const scope: WindowsAbsenceJobScope = Object.freeze({ close(): void { state.open = false; state.ordinary = false; } });
    jobScopes.set(scope, state);
    return scope;
}
/** Test-only invert for the documented reverse-control run. Default stays enabled. */
let ordinaryRouteJobScopeReuse = true;
export function setOrdinaryRouteJobScopeReuse(enabled: boolean): void { ordinaryRouteJobScopeReuse = enabled; }
export function isOrdinaryRouteJobScopeReuseEnabled(): boolean { return ordinaryRouteJobScopeReuse; }
/** True only while this still-open job already stored its own ordinary-route answer. */
export function ordinaryRouteCachedInJob(scope: WindowsAbsenceJobScope): boolean {
    const state = jobScopes.get(scope);
    return !!(state?.open && state.ordinary);
}
/** Remember an ordinary-route answer only if this scope is still open and known. */
export function rememberOrdinaryRouteInJob(scope: WindowsAbsenceJobScope): void {
    const state = jobScopes.get(scope);
    if (state?.open) state.ordinary = true;
}
/** Reuses only an 'ordinary' answer spawned inside the same still-open job
 * scope. A closed, foreign or missing scope, and every non-ordinary answer,
 * spawn the helper again; nothing crosses jobs. */
export function readWindowsInstallationAbsenceInJob(scope: WindowsAbsenceJobScope): WindowsInstallationObservation {
    const state = jobScopes.get(scope);
    if (state?.open && state.ordinary) return 'ordinary';
    const answer = readWindowsInstallationAbsence();
    if (state?.open && answer === 'ordinary') state.ordinary = true;
    return answer;
}
/** Fixed client-bundled read-only helper. This is not a protected Windows
 * controller or a qualification receipt. Missing build artifacts deny fallback. */
export function readWindowsInstallationAbsence(): WindowsInstallationObservation {
    if (arguments.length || process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch))
        return 'unavailable';
    try {
        const system = machine().toLowerCase();
        const nativeArch = ['amd64', 'x86_64'].includes(system) ? 'x64' : ['arm64', 'aarch64'].includes(system) ? 'arm64' : undefined;
        if (nativeArch !== process.arch) return 'unavailable';
        const moduleDirectory = dirname(fileURLToPath(import.meta.url));
        // electron-builder explicitly unpacks this fixed native subtree. CLI and
        // Desktop development builds use the same relative tsc output location.
        const root = moduleDirectory.split(sep).map(part => part === 'app.asar' ? 'app.asar.unpacked' : part).join(sep);
        const helper = join(root, 'native', 'win32-' + process.arch, 'windows-installation-absence.exe'), manifestPath = join(root, 'native', 'win32-' + process.arch, 'windows-installation-absence.json');
        function read(path: string, limit: number): Buffer { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > limit)
            throw Error('windows_absence_file'); const b = readFileSync(path); if (b.length > limit)
            throw Error('windows_absence_file'); return b; }
        /** File identity for the integrity memo only. Same file-shape refusals as
         * read(); an unreadable identity is never a memo hit. */
        function identity(path: string, limit: number): string | undefined { const s = lstatSync(path, { bigint: true });
            if (!s.isFile() || s.isSymbolicLink() || Number(s.nlink) !== 1 || Number(s.size) > limit)
                throw Error('windows_absence_file');
            const fields = [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs];
            return fields.every(field => typeof field === 'bigint') ? fields.join(':') : undefined; }
        const currentKey = (): string | undefined => { const h = identity(helper, 2 * 1024 ** 2), m = identity(manifestPath, 4096); return h && m ? h + '|' + m : undefined; };
        function helperCurrent(manifestBytes: Buffer, manifest: { sha256: string }): void { if (!read(manifestPath, 4096).equals(manifestBytes) || createHash('sha256').update(read(helper, 2 * 1024 ** 2)).digest('hex') !== manifest.sha256)
            throw Error('windows_absence_changed'); }
        // Integrity memo: only the manifest parse and the helper sha256 are reused,
        // and only while both files keep the identity observed around that check.
        // The helper's answer reads system state and is never reused.
        const key = currentKey();
        let verified: IntegrityMemo | undefined = integrityMemo && key !== undefined && integrityMemo.helper === helper && integrityMemo.manifestPath === manifestPath && integrityMemo.key === key ? integrityMemo : undefined;
        if (!verified) {
            integrityMemo = undefined;
            const manifestBytes = read(manifestPath, 4096), manifest = JSON.parse(manifestBytes.toString('utf8'));
            if (!manifest || Object.keys(manifest).sort().join(',') !== 'coreSha256,sha256,sourceSha256,target,version' || manifest.version !== 1 || manifest.target !== 'win32-' + process.arch || !['sourceSha256', 'coreSha256'].every(key => typeof manifest[key] === 'string' && /^[a-f0-9]{64}$/.test(manifest[key])) || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256))
                return 'unavailable';
            helperCurrent(manifestBytes, manifest);
            const stable = key !== undefined && currentKey() === key;
            verified = { helper, manifestPath, key: stable ? key : undefined, manifestBytes, manifest };
            if (stable) integrityMemo = verified;
        }
        const result = spawnSync(win32.toNamespacedPath(helper), [], { cwd: win32.toNamespacedPath(dirname(helper)), env: {}, shell: false, windowsHide: true, timeout: 5000, maxBuffer: 4096 });
        if (result.error || result.status !== 0 || result.signal) {
            integrityMemo = undefined;
            return 'unavailable';
        }
        // After the process: unchanged identity keeps the verified bytes; any
        // change (or no readable identity) runs the full original re-check.
        if (verified.key === undefined || currentKey() !== verified.key) {
            integrityMemo = undefined;
            helperCurrent(verified.manifestBytes, verified.manifest);
        }
        const answer = JSON.parse(result.stdout.toString('utf8'));
        if (!answer || Object.keys(answer).sort().join(',') !== 'kind,version' || answer.version !== 1 || !['ordinary', 'installed', 'unavailable'].includes(answer.kind)) {
            integrityMemo = undefined;
            return 'unavailable';
        }
        if (answer.kind === 'unavailable') integrityMemo = undefined;
        return answer.kind;
    }
    catch {
        integrityMemo = undefined;
        return 'unavailable';
    }
}
