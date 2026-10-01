import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
type WindowsInstallationObservation = 'ordinary' | 'installed' | 'unavailable';
/** Fixed client-bundled read-only helper. This is not a protected Windows
 * controller or a qualification receipt. Missing build artifacts deny fallback. */
export function readWindowsInstallationAbsence(): WindowsInstallationObservation {
    if (arguments.length || process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch))
        return 'unavailable';
    try {
        const moduleDirectory = dirname(fileURLToPath(import.meta.url));
        // electron-builder explicitly unpacks this fixed native subtree. CLI and
        // Desktop development builds use the same relative tsc output location.
        const root = moduleDirectory.split(sep).map(part => part === 'app.asar' ? 'app.asar.unpacked' : part).join(sep);
        const helper = join(root, 'native', 'win32-' + process.arch, 'windows-installation-absence.exe'), manifestPath = join(root, 'native', 'win32-' + process.arch, 'windows-installation-absence.json');
        function read(path: string, limit: number): Buffer { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > limit)
            throw Error('windows_absence_file'); const b = readFileSync(path); if (b.length > limit)
            throw Error('windows_absence_file'); return b; }
        const manifestBytes = read(manifestPath, 4096), manifest = JSON.parse(manifestBytes.toString('utf8'));
        if (!manifest || Object.keys(manifest).sort().join(',') !== 'coreSha256,sha256,sourceSha256,target,version' || manifest.version !== 1 || manifest.target !== 'win32-' + process.arch || !['sourceSha256', 'coreSha256'].every(key => typeof manifest[key] === 'string' && /^[a-f0-9]{64}$/.test(manifest[key])) || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256))
            return 'unavailable';
        function helperCurrent(): void { if (!read(manifestPath, 4096).equals(manifestBytes) || createHash('sha256').update(read(helper, 2 * 1024 ** 2)).digest('hex') !== manifest.sha256)
            throw Error('windows_absence_changed'); }
        helperCurrent();
        const result = spawnSync(helper, [], { cwd: dirname(helper), env: {}, shell: false, windowsHide: true, timeout: 5000, maxBuffer: 4096 });
        if (result.error || result.status !== 0 || result.signal)
            return 'unavailable';
        helperCurrent();
        const answer = JSON.parse(result.stdout.toString('utf8'));
        if (!answer || Object.keys(answer).sort().join(',') !== 'kind,version' || answer.version !== 1 || !['ordinary', 'installed', 'unavailable'].includes(answer.kind))
            return 'unavailable';
        return answer.kind;
    }
    catch {
        return 'unavailable';
    }
}
