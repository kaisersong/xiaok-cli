import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import * as nodeFs from 'node:fs';
import { runDependencyProcess } from './dependency-task.js';
import type { ComputerUseAppIdentity } from './computer-use-capability-service.js';

/** electron-builder UUIDv5(appId=com.xiaok.desktop, namespace=50e065bc-3134-11e6-9bab-38c9862bdaf3). */
export const XIAOK_NSIS_GUID = 'e915e417-4c7f-5880-944a-980493960d29';
const equal = (a: string, b: string) => win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase();
function physicalFs(): typeof nodeFs {
  // Electron's ASAR virtual filesystem must not hash a directory listing.
  try { return createRequire(import.meta.url)('original-fs') as typeof nodeFs; } catch { return nodeFs; }
}
async function hashPhysicalAsar(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const bytes of physicalFs().createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
type IdentityInput = { platform: NodeJS.Platform; executablePath: string; resourcesPath: string; isPackaged: boolean; devServerUrl?: string; nodeEnv?: string };
export async function resolveWindowsComputerUseIdentity(input: IdentityInput, dependencies: {
  run?: typeof runDependencyProcess;
  hashAsar?: (path: string) => Promise<string>;
  isFile?: (path: string) => Promise<boolean>;
} = {}): Promise<ComputerUseAppIdentity> {
  const identity: ComputerUseAppIdentity = { platform: 'win32', isPackaged: input.isPackaged,
    ...(input.devServerUrl ? { devServerUrl: input.devServerUrl } : {}), ...(input.nodeEnv ? { nodeEnv: input.nodeEnv } : {}) };
  if (input.platform !== 'win32' || !input.isPackaged || input.devServerUrl || input.nodeEnv === 'development'
    || !win32.isAbsolute(input.executablePath) || !win32.isAbsolute(input.resourcesPath)) return identity;
  const root = win32.dirname(input.executablePath);
  if (!equal(input.resourcesPath, win32.join(root, 'resources')) || win32.basename(input.executablePath).toLowerCase() !== 'xiaok.exe') return identity;
  identity.appPath = root;
  const isFile = dependencies.isFile ?? (async path => { try { return (await physicalFs().promises.lstat(path)).isFile(); } catch { return false; } });
  const script = `$ProgressPreference='SilentlyContinue'; $records=@(); foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) { $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,[Microsoft.Win32.RegistryView]::Registry64); try { $install=$base.OpenSubKey('Software\\${XIAOK_NSIS_GUID}'); $uninstall=$base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${XIAOK_NSIS_GUID}'); if($install -and $uninstall) { $records+=@{installLocation=$install.GetValue('InstallLocation');uninstallString=$uninstall.GetValue('UninstallString')} }; if($install){$install.Dispose()}; if($uninstall){$uninstall.Dispose()} } finally { $base.Dispose() } }; ConvertTo-Json -InputObject @($records) -Compress`;
  try {
    const result = await (dependencies.run ?? runDependencyProcess)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeoutMs: 20_000, maxOutputBytes: 8192 });
    if (!result.success) return identity;
    const records: unknown = JSON.parse(result.output ?? '[]');
    if (!Array.isArray(records)) return identity;
    const uninstaller = win32.join(root, 'Uninstall xiaok.exe');
    const registered = records.some(value => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Record<string, unknown>;
      const quotedPath = typeof record.uninstallString === 'string' ? /^"([^"]+)"(?:\s|$)/.exec(record.uninstallString)?.[1] : undefined;
      return typeof record.installLocation === 'string' && win32.isAbsolute(record.installLocation)
        && equal(record.installLocation, root) && Boolean(quotedPath && equal(quotedPath, uninstaller));
    });
    const asar = win32.join(input.resourcesPath, 'app.asar');
    if (!registered || !(await isFile(input.executablePath)) || !(await isFile(uninstaller)) || !(await isFile(asar))) return identity;
    identity.appAsarSha256 = await (dependencies.hashAsar ?? hashPhysicalAsar)(asar);
    identity.installationSource = 'nsis';
  } catch { /* Portable, registry unavailable or invalid physical files: explicit activation only. */ }
  return identity;
}
