import { createLocalSourceWriterLifetime } from '../../src/runtime/verification/local-source-writer-lifetime.js';
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
  if (process.platform === 'win32' && segments.some(segment => /[:\0]/.test(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new ArtifactWorkspaceFileError('artifact_package_invalid', 'unsafe Windows package path');
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

const stagedArtifacts = new WeakMap<object, { owner: object; metadata: IngestedWorkspaceArtifact; dev: bigint; ino: bigint }>();
const sourceWriters = new WeakMap<object, ReturnType<typeof createLocalSourceWriterLifetime>>();
function sourceWriter(owner: object) {
  const writer = sourceWriters.get(owner);
  if (!writer) throw Error('artifact_workspace_source_owner');
  return writer;
}

export class ArtifactWorkspaceFileManager {
  private readonly managedRoot: string;
  private readonly stagingRoot: string;
  private readonly versionsRoot: string;
  private readonly rootIdentity: { dev: bigint; ino: bigint };

  constructor(options: { managedRoot: string }) {
    const configured = resolve(options.managedRoot);
    mkdirSync(configured, { recursive: true });
    this.managedRoot = realpathSync.native(configured);
    const identity = lstatSync(this.managedRoot, { bigint: true });
    this.rootIdentity = { dev: identity.dev, ino: identity.ino };
    this.stagingRoot = join(this.managedRoot, 'staging');
    this.versionsRoot = join(this.managedRoot, 'versions');
    for (const directory of [this.stagingRoot, this.versionsRoot]) {
      try { mkdirSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    this.assertNamespaces();
    sourceWriters.set(this, createLocalSourceWriterLifetime('artifact_workspace_source'));
  }

  sealAndDrainInstanceMutations(): Promise<void> { return sourceWriter(this).close(); }

  private assertNamespaces(): void {
    const root = lstatSync(this.managedRoot, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink() || root.dev !== this.rootIdentity.dev || root.ino !== this.rootIdentity.ino) {
      throw new ArtifactWorkspaceFileError('invalid_target', 'managed root identity changed');
    }
    for (const directory of [this.stagingRoot, this.versionsRoot]) {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ArtifactWorkspaceFileError('invalid_target', 'managed namespace is not a real directory');
    }
  }

  private registerStaged(metadata: IngestedWorkspaceArtifact): IngestedWorkspaceArtifact {
    const directory = lstatSync(join(this.stagingRoot, metadata.stagingId), { bigint: true });
    stagedArtifacts.set(metadata, { owner: this, metadata: structuredClone(metadata), dev: directory.dev, ino: directory.ino });
    return metadata;
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
    return sourceWriter(this).runSync(() => {
      this.assertNamespaces();
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

      const fileName = validatePackageRelativePath(basename(source));
      if (fileName.includes('/')) throw new ArtifactWorkspaceFileError('invalid_target', 'invalid source filename');
      const stagingDirectory = join(this.stagingRoot, stagingId);
      mkdirSync(stagingDirectory);
      const stagedPath = join(stagingDirectory, fileName);
      copyFileSync(source, stagedPath);
      chmodSync(stagedPath, 0o444);

      return this.registerStaged({
        storageKind: 'single_file',
        stagingId,
        stagingRef: posix.join('staging', stagingId, fileName),
        finalRef: posix.join('versions', stagingId, fileName),
        checksum: sha256Bytes(readFileSync(stagedPath)),
        byteSize: sourceStat.size,
        kind: input.kind,
        mimeType: input.mimeType,
      });
    });
  }

  ingestSealedPackage(input: {
    sourceDirectory: string;
    allowedRoot: string;
    stagingId: string;
    entryRef: string;
    kind: string;
    mimeType?: string;
  }): IngestedWorkspaceArtifact {
    return sourceWriter(this).runSync(() => {
      this.assertNamespaces();
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

      return this.registerStaged({
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
      });
    });
  }

  finalize(staged: IngestedWorkspaceArtifact): FinalizedWorkspaceArtifact {
    return sourceWriter(this).runSync(() => {
      this.assertNamespaces();
      const entry = stagedArtifacts.get(staged);
      if (!entry || entry.owner !== this) throw new ArtifactWorkspaceFileError('invalid_target', 'staging object is not owned by this instance');
      const original = entry.metadata;
      const descriptors = Object.getOwnPropertyDescriptors(staged), keys = Reflect.ownKeys(staged);
      if (keys.length !== Object.keys(original).length || keys.some(key => typeof key !== 'string'
        || !Object.hasOwn(original, key) || !Object.hasOwn(descriptors[key]!, 'value')
        || descriptors[key]!.value !== original[key as keyof IngestedWorkspaceArtifact])) {
        throw new ArtifactWorkspaceFileError('invalid_target', 'staging metadata changed');
      }
      const stagingId = validatePackageRelativePath(original.stagingId);
      if (stagingId.includes('/') || original.finalRef !== this.finalRefForStagingRef(original.stagingRef)) throw new ArtifactWorkspaceFileError('invalid_target', 'invalid staging relationship');
      const segments = original.stagingRef.split('/');
      if (segments[1] !== stagingId || segments.length !== (original.storageKind === 'single_file' ? 3 : 2)) throw new ArtifactWorkspaceFileError('invalid_target', 'invalid staging namespace');
      const stagingContainer = join(this.stagingRoot, stagingId);
      const finalContainer = join(this.versionsRoot, stagingId);
      const info = lstatSync(stagingContainer, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== entry.dev || info.ino !== entry.ino) throw new ArtifactWorkspaceFileError('invalid_target', 'staging directory changed');
      try { lstatSync(finalContainer); throw new ArtifactWorkspaceFileError('invalid_target', 'final artifact already exists'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      renameSync(stagingContainer, finalContainer);
      stagedArtifacts.delete(staged);
      const { stagingRef: _stagingRef, finalRef, ...metadata } = original;
      return { ...metadata, fileRef: finalRef };
    });
  }

  removeManagedRef(fileRef: string): void {
    return sourceWriter(this).runSync(() => {
      this.assertNamespaces();
      const canonical = validatePackageRelativePath(fileRef), segments = canonical.split('/');
      if (!['staging', 'versions'].includes(segments[0]!) || segments.length < 2) throw new ArtifactWorkspaceFileError('invalid_target', 'cannot remove a managed namespace');
      let resolved = this.managedRoot;
      for (let index = 0; index < segments.length; index += 1) {
        resolved = join(resolved, segments[index]!);
        let info;
        try { info = lstatSync(resolved); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
        if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) throw new ArtifactWorkspaceFileError('invalid_target', 'managed removal crosses an unsafe directory');
      }
      rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
    });
  }
}
