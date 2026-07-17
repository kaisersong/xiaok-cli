import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, posix, relative, resolve } from 'node:path';

export const MAX_SINGLE_FILE_BYTES = 104_857_600;
export const MAX_PACKAGE_TOTAL_BYTES = 536_870_912;
export const MAX_PACKAGE_FILE_COUNT = 2_048;

export type ArtifactWorkspaceFileErrorCode =
  | 'invalid_target'
  | 'artifact_too_large'
  | 'artifact_package_invalid';

export class ArtifactWorkspaceFileError extends Error {
  constructor(
    readonly code: ArtifactWorkspaceFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactWorkspaceFileError';
  }
}

export interface IngestedWorkspaceArtifact {
  storageKind: 'single_file' | 'sealed_package';
  stagingId: string;
  stagingRef: string;
  finalRef: string;
  entryRef?: string;
  packageManifestRef?: string;
  checksum: string;
  byteSize: number;
  kind: string;
  mimeType?: string;
}

export interface FinalizedWorkspaceArtifact extends Omit<IngestedWorkspaceArtifact, 'stagingRef' | 'finalRef'> {
  fileRef: string;
}

interface PackageManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isOutside(rootPath: string, childPath: string): boolean {
  const rel = relative(rootPath, childPath);
  return rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel);
}

export function normalizeSourceIdentityPath(input: string, platform: 'win32' | 'posix'): string {
  const slashed = input.replace(/\\/g, '/');
  if (platform !== 'win32') return slashed;

  if (slashed.startsWith('//')) {
    return `//${slashed.slice(2).replace(/\/{2,}/g, '/').toLowerCase()}`;
  }
  return slashed.replace(/\/{2,}/g, '/').toLowerCase();
}

export function validatePackageRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.startsWith('//')
    || /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'package path must be relative');
  }
  const segments = normalized.split(/[\\/]+/);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'package path contains traversal');
  }
  const canonical = posix.normalize(normalized);
  if (canonical === '..' || canonical.startsWith('../')) {
    throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'package path escapes root');
  }
  return canonical;
}

export function assertSingleFileLimit(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SINGLE_FILE_BYTES) {
    throw new ArtifactWorkspaceFileError('artifact_too_large', 'single file exceeds workspace limit');
  }
}

export function assertPackageLimits(totalBytes: number, fileCount: number): void {
  if (
    !Number.isSafeInteger(totalBytes)
    || totalBytes < 0
    || totalBytes > MAX_PACKAGE_TOTAL_BYTES
    || !Number.isSafeInteger(fileCount)
    || fileCount < 0
    || fileCount > MAX_PACKAGE_FILE_COUNT
  ) {
    throw new ArtifactWorkspaceFileError('artifact_too_large', 'sealed package exceeds workspace limit');
  }
}

export class ArtifactWorkspaceFileManager {
  private readonly managedRoot: string;
  private readonly stagingRoot: string;
  private readonly versionsRoot: string;

  constructor(options: { managedRoot: string }) {
    this.managedRoot = resolve(options.managedRoot);
    this.stagingRoot = join(this.managedRoot, 'staging');
    this.versionsRoot = join(this.managedRoot, 'versions');
    mkdirSync(this.stagingRoot, { recursive: true });
    mkdirSync(this.versionsRoot, { recursive: true });
  }

  resolveSourceIdentity(input: { sourcePath: string; allowedRoot: string }): {
    realPath: string;
    sourceLocatorHash: string;
  } {
    const allowedRoot = realpathSync.native(resolve(input.allowedRoot));
    const realPath = realpathSync.native(resolve(input.sourcePath));
    if (isOutside(allowedRoot, realPath)) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'artifact source is outside the allowed root');
    }
    const identity = normalizeSourceIdentityPath(realPath, process.platform === 'win32' ? 'win32' : 'posix');
    return { realPath, sourceLocatorHash: sha256Bytes(identity) };
  }

  resolveManagedRef(fileRef: string): string {
    const canonical = validatePackageRelativePath(fileRef);
    const resolved = resolve(this.managedRoot, ...canonical.split(/[\\/]+/));
    if (isOutside(this.managedRoot, resolved)) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'managed artifact ref escapes root');
    }
    return resolved;
  }

  verifyManagedArtifact(input: {
    fileRef: string;
    storageKind: 'single_file' | 'sealed_package';
    entryRef?: string;
    packageManifestRef?: string;
    checksum?: string;
    byteSize?: number;
  }, mode: 'stat' | 'checksum' = 'checksum'): boolean {
    try {
      const root = this.resolveManagedRef(input.fileRef);
      if (input.storageKind === 'single_file') {
        const fileStat = statSync(root);
        if (!fileStat.isFile() || (input.byteSize !== undefined && fileStat.size !== input.byteSize)) return false;
        return mode === 'stat' || !input.checksum || sha256Bytes(readFileSync(root)) === input.checksum;
      }
      if (!input.entryRef || !input.packageManifestRef || !statSync(root).isDirectory()) return false;
      const entryRef = validatePackageRelativePath(input.entryRef);
      const manifestRef = validatePackageRelativePath(input.packageManifestRef);
      const manifestBytes = readFileSync(join(root, ...manifestRef.split(/[\\/]+/)));
      if (input.checksum && sha256Bytes(manifestBytes) !== input.checksum) return false;
      const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
        schemaVersion?: unknown;
        files?: Array<{ path?: unknown; size?: unknown; sha256?: unknown }>;
      };
      if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) return false;
      const folded = new Set<string>();
      const files = manifest.files.map((entry) => ({
        path: validatePackageRelativePath(String(entry.path ?? '')),
        size: Number(entry.size),
        sha256: String(entry.sha256 ?? ''),
      }));
      for (const file of files) {
        const key = file.path.toLocaleLowerCase('en-US');
        if (file.path === manifestRef || folded.has(key) || !/^[a-f0-9]{64}$/.test(file.sha256)) return false;
        folded.add(key);
      }
      assertPackageLimits(files.reduce((sum, file) => sum + file.size, 0), files.length);
      if (!files.some(file => file.path === entryRef)) return false;
      if (!files.every((file) => {
        const filePath = join(root, ...file.path.split(/[\\/]+/));
        const fileStat = lstatSync(filePath);
        return fileStat.isFile()
          && Number.isSafeInteger(file.size)
          && file.size >= 0
          && fileStat.size === file.size
          && (mode === 'stat' || sha256Bytes(readFileSync(filePath)) === file.sha256);
      })) return false;
      if (mode === 'stat') return true;
      const actualPaths: string[] = [];
      const walk = (directory: string): boolean => {
        for (const dirent of readdirSync(directory, { withFileTypes: true })) {
          const absolutePath = join(directory, dirent.name);
          const relativePath = validatePackageRelativePath(relative(root, absolutePath).replace(/\\/g, '/'));
          const stat = lstatSync(absolutePath);
          if (stat.isSymbolicLink()) return false;
          if (stat.isDirectory()) {
            if (!walk(absolutePath)) return false;
          } else if (stat.isFile()) {
            if (relativePath !== manifestRef) actualPaths.push(relativePath);
          } else {
            return false;
          }
        }
        return true;
      };
      if (!walk(root)) return false;
      actualPaths.sort((left, right) => left.localeCompare(right));
      const expectedPaths = files.map(file => file.path).sort((left, right) => left.localeCompare(right));
      return actualPaths.length === expectedPaths.length
        && actualPaths.every((path, index) => path === expectedPaths[index]);
    } catch {
      return false;
    }
  }

  finalRefForStagingRef(fileRef: string): string {
    const canonical = validatePackageRelativePath(fileRef);
    const segments = canonical.split(/[\\/]+/);
    if (segments[0] !== 'staging' || segments.length < 2) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'managed ref is not a staging ref');
    }
    return posix.join('versions', ...segments.slice(1));
  }

  ingestSingleFile(input: {
    sourcePath: string;
    allowedRoot: string;
    stagingId: string;
    kind: string;
    mimeType?: string;
  }): IngestedWorkspaceArtifact {
    const stagingId = validatePackageRelativePath(input.stagingId);
    if (stagingId.includes('/')) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'staging id must be opaque');
    }
    const source = this.resolveSourceIdentity(input).realPath;
    const sourceStat = statSync(source);
    if (!sourceStat.isFile()) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'single-file source is not a regular file');
    }
    assertSingleFileLimit(sourceStat.size);

    const fileName = basename(source);
    const stagingDirectory = join(this.stagingRoot, stagingId);
    mkdirSync(stagingDirectory);
    const stagedPath = join(stagingDirectory, fileName);
    copyFileSync(source, stagedPath);
    chmodSync(stagedPath, 0o444);

    return {
      storageKind: 'single_file',
      stagingId,
      stagingRef: posix.join('staging', stagingId, fileName),
      finalRef: posix.join('versions', stagingId, fileName),
      checksum: sha256Bytes(readFileSync(stagedPath)),
      byteSize: sourceStat.size,
      kind: input.kind,
      mimeType: input.mimeType,
    };
  }

  ingestSealedPackage(input: {
    sourceDirectory: string;
    allowedRoot: string;
    stagingId: string;
    entryRef: string;
    kind: string;
    mimeType?: string;
  }): IngestedWorkspaceArtifact {
    const stagingId = validatePackageRelativePath(input.stagingId);
    if (stagingId.includes('/')) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'staging id must be opaque');
    }
    const entryRef = validatePackageRelativePath(input.entryRef);
    const sourceRoot = this.resolveSourceIdentity({
      sourcePath: input.sourceDirectory,
      allowedRoot: input.allowedRoot,
    }).realPath;
    if (!statSync(sourceRoot).isDirectory()) {
      throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package source is not a directory');
    }

    const entries: Array<{ sourcePath: string; relativePath: string; size: number }> = [];
    const caseFolded = new Set<string>();
    const walk = (directory: string): void => {
      for (const dirent of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = join(directory, dirent.name);
        const relativePath = validatePackageRelativePath(relative(sourceRoot, absolutePath).replace(/\\/g, '/'));
        const stat = lstatSync(absolutePath);
        if (stat.isSymbolicLink()) {
          throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package cannot contain symlinks');
        }
        if (stat.isDirectory()) {
          walk(absolutePath);
          continue;
        }
        if (!stat.isFile()) {
          throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package contains a non-file entry');
        }
        if (relativePath === '.xiaok-manifest.json') {
          throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package uses a reserved manifest path');
        }
        const folded = relativePath.toLocaleLowerCase('en-US');
        if (caseFolded.has(folded)) {
          throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package contains a case-fold collision');
        }
        caseFolded.add(folded);
        entries.push({ sourcePath: absolutePath, relativePath, size: stat.size });
      }
    };
    walk(sourceRoot);
    entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    assertPackageLimits(totalBytes, entries.length);
    if (!entries.some((entry) => entry.relativePath === entryRef)) {
      throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'sealed package entry file is missing');
    }

    const stagingDirectory = join(this.stagingRoot, stagingId);
    mkdirSync(stagingDirectory);
    const manifestEntries: PackageManifestEntry[] = [];
    for (const entry of entries) {
      const destination = join(stagingDirectory, ...entry.relativePath.split(/[\\/]+/));
      mkdirSync(resolve(destination, '..'), { recursive: true });
      copyFileSync(entry.sourcePath, destination);
      chmodSync(destination, 0o444);
      manifestEntries.push({
        path: entry.relativePath,
        size: entry.size,
        sha256: sha256Bytes(readFileSync(destination)),
      });
    }
    const manifestBytes = JSON.stringify({ schemaVersion: 1, files: manifestEntries });
    const manifestRef = '.xiaok-manifest.json';
    writeFileSync(join(stagingDirectory, manifestRef), manifestBytes, { mode: 0o444 });

    return {
      storageKind: 'sealed_package',
      stagingId,
      stagingRef: posix.join('staging', stagingId),
      finalRef: posix.join('versions', stagingId),
      entryRef,
      packageManifestRef: manifestRef,
      checksum: sha256Bytes(manifestBytes),
      byteSize: totalBytes,
      kind: input.kind,
      mimeType: input.mimeType,
    };
  }

  finalize(staged: IngestedWorkspaceArtifact): FinalizedWorkspaceArtifact {
    const stagingContainer = join(this.stagingRoot, staged.stagingId);
    const finalContainer = join(this.versionsRoot, staged.stagingId);
    renameSync(stagingContainer, finalContainer);
    const { stagingRef: _stagingRef, finalRef, ...metadata } = staged;
    return { ...metadata, fileRef: finalRef };
  }

  removeManagedRef(fileRef: string): void {
    const resolved = this.resolveManagedRef(fileRef);
    rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
}
