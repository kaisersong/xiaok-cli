import { mkdir, lstat, open, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function fail(code) {
  throw new Error(code);
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function countMatches(bytes, needle) {
  let count = 0;
  let offset = 0;
  while (offset <= bytes.length - needle.length) {
    const found = bytes.indexOf(needle, offset);
    if (found === -1) break;
    count += 1;
    offset = found + Math.max(needle.length, 1);
  }
  return count;
}

export async function scanExactBytes(root, needles) {
  const rootRealpath = await realpath(resolve(root));
  if (
    !Array.isArray(needles)
    || needles.length === 0
    || needles.some((needle) => !Buffer.isBuffer(needle) || needle.length === 0)
  ) {
    fail('KIMI_D9_SCANNER_NEEDLE_INVALID');
  }
  const result = { objectsScanned: 0, bytesScanned: 0, matches: 0 };
  async function visit(path) {
    const stat = await lstat(path);
    result.objectsScanned += 1;
    if (stat.isSymbolicLink()) {
      fail('KIMI_D9_SCANNER_SYMLINK');
    }
    if (stat.isDirectory()) {
      const names = await readdir(path);
      names.sort();
      for (const name of names) {
        await visit(join(path, name));
      }
      return;
    }
    if (!stat.isFile()) {
      fail('KIMI_D9_SCANNER_OBJECT_UNSUPPORTED');
    }
    const handle = await open(path, 'r');
    try {
      const bytes = await handle.readFile();
      result.bytesScanned += bytes.length;
      for (const needle of needles) {
        result.matches += countMatches(bytes, needle);
      }
    } finally {
      await handle.close();
    }
  }
  await visit(rootRealpath);
  return Object.freeze(result);
}

export async function runPositiveControlScan({
  root,
  canary,
  probeRelativePath,
}) {
  const rootRealpath = await realpath(resolve(root));
  const probePath = resolve(rootRealpath, probeRelativePath);
  if (!isWithin(rootRealpath, probePath) || probePath === rootRealpath) {
    fail('KIMI_D9_SCANNER_PROBE_PATH_INVALID');
  }
  await mkdir(dirname(probePath), { recursive: true, mode: 0o700 });
  await writeFile(probePath, canary, { flag: 'wx', mode: 0o600 });
  const probeRealpath = await realpath(probePath);
  if (!isWithin(rootRealpath, probeRealpath)) {
    fail('KIMI_D9_SCANNER_PROBE_REALPATH_INVALID');
  }
  const positive = await scanExactBytes(rootRealpath, [canary]);
  if (positive.matches !== 1) {
    fail('KIMI_D9_SCANNER_POSITIVE_CONTROL_INVALID');
  }
  await rm(probeRealpath);
  const final = await scanExactBytes(rootRealpath, [canary]);
  if (final.matches !== 0) {
    fail('KIMI_D9_SCANNER_FINAL_MATCH');
  }
  let probeExistsAfter = true;
  try {
    await lstat(probePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      probeExistsAfter = false;
    } else {
      throw error;
    }
  }
  return Object.freeze({
    positiveControlMatches: positive.matches,
    finalMatches: final.matches,
    objectsScanned: final.objectsScanned,
    bytesScanned: final.bytesScanned,
    probeExistsAfter,
  });
}
