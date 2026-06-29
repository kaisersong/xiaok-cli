import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const desktopRoot = join(__dirname, '..', '..');
const cacheRoot = join(
  tmpdir(),
  'xiaok-react-doctor-cache',
  createHash('sha1').update(desktopRoot).digest('hex'),
);
const cachePath = join(cacheRoot, 'diagnostics.json');
const lockPath = join(cacheRoot, 'diagnostics.lock');
const cacheWaitMs = 120_000;
const lockStaleMs = 180_000;

export type ReactDoctorDiagnostic = {
  severity: string;
  category: string;
  rule: string;
  filePath: string;
  line: number;
  message: string;
};

type ReactDoctorReport = {
  projects: Array<{
    diagnostics: ReactDoctorDiagnostic[];
  }>;
};

export async function readReactDoctorDiagnostics(maxBuffer = 80 * 1024 * 1024): Promise<ReactDoctorDiagnostic[]> {
  mkdirSync(cacheRoot, { recursive: true });
  const signature = sourceSignature();
  const cached = readCache(signature);
  if (cached) {
    return cached;
  }

  const lockFd = acquireLock();
  if (lockFd !== null) {
    return runAndCacheReactDoctor(signature, lockFd, maxBuffer);
  }

  return waitForCachedDiagnostics(signature, maxBuffer);
}

async function runReactDoctor(maxBuffer: number): Promise<ReactDoctorDiagnostic[]> {
  // On Windows the npm bin shim is `react-doctor.cmd`, and modern Node requires
  // a shell to launch .cmd files. POSIX uses the extensionless shim directly.
  const isWindows = process.platform === 'win32';
  const binPath = join(desktopRoot, 'node_modules', '.bin', isWindows ? 'react-doctor.cmd' : 'react-doctor');
  const { stdout } = await execFileAsync(
    binPath,
    ['--json', '--no-score', '--fail-on', 'none'],
    {
      cwd: desktopRoot,
      encoding: 'utf8',
      maxBuffer,
      shell: isWindows,
    },
  );
  const report = JSON.parse(stdout) as ReactDoctorReport;
  return report.projects.flatMap((project) => project.diagnostics);
}

async function waitForCachedDiagnostics(signature: string, maxBuffer: number): Promise<ReactDoctorDiagnostic[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < cacheWaitMs) {
    const cached = readCache(signature);
    if (cached) {
      return cached;
    }
    clearStaleLock();
    const lockFd = acquireLock();
    if (lockFd !== null) {
      return runAndCacheReactDoctor(signature, lockFd, maxBuffer);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for shared React Doctor diagnostics cache.');
}

async function runAndCacheReactDoctor(signature: string, lockFd: number, maxBuffer: number): Promise<ReactDoctorDiagnostic[]> {
  try {
    const diagnostics = await runReactDoctor(Math.max(maxBuffer, 120 * 1024 * 1024));
    writeFileSync(cachePath, JSON.stringify({ signature, diagnostics }), 'utf8');
    return diagnostics;
  } finally {
    closeSync(lockFd);
    rmSync(lockPath, { force: true });
  }
}

function acquireLock(): number | null {
  clearStaleLock();
  try {
    return openSync(lockPath, 'wx');
  } catch {
    return null;
  }
}

function clearStaleLock(): void {
  try {
    const stat = statSync(lockPath);
    if (Date.now() - stat.mtimeMs > lockStaleMs) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    // No lock, or it disappeared between checks.
  }
}

function readCache(signature: string): ReactDoctorDiagnostic[] | null {
  if (!existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      signature?: unknown;
      diagnostics?: unknown;
    };
    if (parsed.signature !== signature || !Array.isArray(parsed.diagnostics)) {
      return null;
    }
    return parsed.diagnostics as ReactDoctorDiagnostic[];
  } catch {
    return null;
  }
}

function sourceSignature(): string {
  const hash = createHash('sha1');
  for (const relativeRoot of ['electron', 'renderer', 'scripts']) {
    appendDirectorySignature(hash, join(desktopRoot, relativeRoot), relativeRoot);
  }
  for (const filename of ['package.json', 'vite.config.ts']) {
    appendFileSignature(hash, join(desktopRoot, filename), filename);
  }
  return hash.digest('hex');
}

function appendDirectorySignature(hash: ReturnType<typeof createHash>, absoluteDir: string, relativeDir: string): void {
  if (!existsSync(absoluteDir)) {
    return;
  }
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'release' || entry.name === '.generated') {
      continue;
    }
    const absolutePath = join(absoluteDir, entry.name);
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      appendDirectorySignature(hash, absolutePath, relativePath);
      continue;
    }
    appendFileSignature(hash, absolutePath, relativePath);
  }
}

function appendFileSignature(hash: ReturnType<typeof createHash>, absolutePath: string, relativePath: string): void {
  try {
    const stat = statSync(absolutePath);
    hash.update(`${relativePath}:${stat.size}:${stat.mtimeMs}\n`);
  } catch {
    hash.update(`${relativePath}:missing\n`);
  }
}
