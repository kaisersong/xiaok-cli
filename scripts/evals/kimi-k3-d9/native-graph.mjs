import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

const CPU_TYPES = new Map([
  [0x0100000c, 'arm64'],
  [0x01000007, 'x64'],
]);

function fail(code, details = '') {
  throw new Error(details ? `${code}: ${details}` : code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function within(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export async function classifyNativeArtifact(path) {
  const bytes = await readFile(path);
  if (bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))) {
    return {
      format: 'macho',
      arch: CPU_TYPES.get(bytes.readUInt32LE(4)) ?? 'unknown',
    };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return { format: 'elf', arch: 'unknown' };
  }
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString('ascii') === 'MZ') {
    return { format: 'pe', arch: 'unknown' };
  }
  return { format: 'unknown', arch: 'unknown' };
}

function defaultInspectMachO(path) {
  if (process.platform !== 'darwin') {
    fail('KIMI_D9_NATIVE_OTOOL_UNAVAILABLE');
  }
  const output = execFileSync('/usr/bin/otool', ['-L', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const dependencies = output
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+\(/u)[0])
    .filter(Boolean);
  const loadCommands = execFileSync('/usr/bin/otool', ['-l', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rpaths = [];
  const lines = loadCommands.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === 'cmd LC_RPATH') {
      const pathLine = lines.slice(index + 1, index + 6)
        .find((line) => line.trim().startsWith('path '));
      if (pathLine) {
        rpaths.push(pathLine.trim().slice(5).split(' (offset ')[0]);
      }
    }
  }
  return { dependencies, rpaths };
}

function isSystemDependency(path) {
  return path.startsWith('/usr/lib/')
    || path.startsWith('/System/Library/');
}

async function resolveDependency({
  installName,
  owner,
  executable,
  rpaths,
  closureRoot,
}) {
  if (isSystemDependency(installName)) {
    return { system: true, installName };
  }
  let candidates = [];
  if (installName.startsWith('@loader_path/')) {
    candidates = [resolve(dirname(owner), installName.slice('@loader_path/'.length))];
  } else if (installName.startsWith('@executable_path/')) {
    candidates = [resolve(dirname(executable), installName.slice('@executable_path/'.length))];
  } else if (installName.startsWith('@rpath/')) {
    const suffix = installName.slice('@rpath/'.length);
    candidates = rpaths.map((rpath) => {
      if (rpath.startsWith('@loader_path/')) {
        return resolve(dirname(owner), rpath.slice('@loader_path/'.length), suffix);
      }
      if (rpath.startsWith('@executable_path/')) {
        return resolve(dirname(executable), rpath.slice('@executable_path/'.length), suffix);
      }
      return resolve(rpath, suffix);
    });
  } else if (isAbsolute(installName)) {
    candidates = [installName];
  } else {
    fail('KIMI_D9_NATIVE_DEPENDENCY_UNRESOLVED', installName);
  }

  for (const candidate of candidates) {
    if (!within(closureRoot, candidate)) {
      fail('KIMI_D9_NATIVE_DEPENDENCY_ESCAPE', candidate);
    }
    const resolved = await realpath(candidate).catch(() => null);
    if (resolved) {
      if (!within(closureRoot, resolved)) {
        fail('KIMI_D9_NATIVE_DEPENDENCY_ESCAPE', resolved);
      }
      return { system: false, installName, resolved };
    }
  }
  fail('KIMI_D9_NATIVE_DEPENDENCY_UNRESOLVED', installName);
}

export async function buildNativeDependencyGraph(input) {
  const closureRoot = await realpath(resolve(input.closureRoot)).catch(() =>
    fail('KIMI_D9_CLOSURE_MISSING'));
  const executable = await realpath(resolve(closureRoot, input.nodeExecutable)).catch(() =>
    fail('KIMI_D9_NATIVE_ROOT_MISSING', input.nodeExecutable));
  const inspectMachO = input.inspectMachO ?? defaultInspectMachO;
  const reachable = new Set(input.reachableNativeRoots ?? []);
  const classifications = [];

  for (const relativePath of input.allNativeArtifacts ?? []) {
    const absolutePath = resolve(closureRoot, relativePath);
    const classification = await classifyNativeArtifact(absolutePath);
    const isReachable = reachable.has(relativePath);
    classifications.push({
      relativePath: toPosix(relativePath),
      ...classification,
      reachable: isReachable,
    });
    if (isReachable && classification.format !== 'macho') {
      fail('KIMI_D9_NATIVE_FOREIGN', relativePath);
    }
    if (isReachable && classification.arch !== input.expectedArch) {
      fail('KIMI_D9_NATIVE_ARCH_MISMATCH', relativePath);
    }
    if (
      isReachable
      && (input.expectedModulesAbi !== undefined || input.expectedNodeApi !== undefined)
    ) {
      const compatibility = input.compatibilityByRelativePath?.[relativePath];
      if (!compatibility) {
        fail('KIMI_D9_NATIVE_COMPATIBILITY_MISSING', relativePath);
      }
      if (
        compatibility.kind === 'modules-abi'
        && String(compatibility.version) !== String(input.expectedModulesAbi)
      ) {
        fail('KIMI_D9_NATIVE_ABI_INCOMPATIBLE', relativePath);
      }
      if (
        compatibility.kind === 'node-api'
        && Number(compatibility.version) > Number(input.expectedNodeApi)
      ) {
        fail('KIMI_D9_NATIVE_NAPI_INCOMPATIBLE', relativePath);
      }
      if (!['modules-abi', 'node-api'].includes(compatibility.kind)) {
        fail('KIMI_D9_NATIVE_COMPATIBILITY_INVALID', relativePath);
      }
      classifications[classifications.length - 1].compatibility = compatibility;
    }
  }

  const executableClassification = await classifyNativeArtifact(executable);
  if (
    executableClassification.format !== 'macho'
    || executableClassification.arch !== input.expectedArch
  ) {
    fail('KIMI_D9_NATIVE_ARCH_MISMATCH', input.nodeExecutable);
  }

  const queue = [
    executable,
    ...[...reachable].map((path) => resolve(closureRoot, path)),
  ];
  const visited = new Set();
  const dependencies = [];
  while (queue.length > 0) {
    const owner = await realpath(queue.shift()).catch(() =>
      fail('KIMI_D9_NATIVE_ROOT_MISSING'));
    if (!within(closureRoot, owner)) {
      fail('KIMI_D9_NATIVE_DEPENDENCY_ESCAPE', owner);
    }
    if (visited.has(owner)) {
      continue;
    }
    visited.add(owner);
    const metadata = await inspectMachO(owner);
    for (const installName of metadata.dependencies ?? []) {
      const dependency = await resolveDependency({
        installName,
        owner,
        executable,
        rpaths: metadata.rpaths ?? [],
        closureRoot,
      });
      if (dependency.system) {
        dependencies.push({
          ownerRelativePath: toPosix(relative(closureRoot, owner)),
          installName,
          system: true,
        });
        continue;
      }
      const contentSha256 = sha256(await readFile(dependency.resolved));
      dependencies.push({
        ownerRelativePath: toPosix(relative(closureRoot, owner)),
        installName,
        system: false,
        resolvedRelativePath: toPosix(relative(closureRoot, dependency.resolved)),
        contentSha256,
      });
      if (!visited.has(dependency.resolved)) {
        queue.push(dependency.resolved);
      }
    }
  }

  return {
    nodeExecutable: toPosix(relative(closureRoot, executable)),
    roots: [...visited].map((path) => toPosix(relative(closureRoot, path))).sort(),
    classifications: classifications.sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath)),
    dependencies: dependencies.sort((a, b) =>
      `${a.ownerRelativePath}:${a.installName}`
        .localeCompare(`${b.ownerRelativePath}:${b.installName}`)),
  };
}
