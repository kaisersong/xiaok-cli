/** Test artifact isolation only. Never launches Electron, signs an app, or
 * changes the installed/source bundle. True Main remains true Main. */
import { constants, createReadStream } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
const copies = new Map(),
  runners = new Map();
function fail(code) {
  throw Error('NATIVE_TEST_ELECTRON_' + code);
}
function accessoryPlist(raw, bundleIdentifier) {
  const xml = raw.toString('utf8');
  if (!xml.startsWith('<?xml') || !xml.includes('<plist'))
    fail('PLIST_UNSUPPORTED');
  const tokens =
    /<!--[\s\S]*?-->|<\/?(?:dict|array|plist)(?:\s[^<>]*?)?>|<key>[\s\S]*?<\/key>/g;
  const stack = [];
  let close = -1,
    target,
    identifier;
  for (const token of xml.matchAll(tokens)) {
    const value = token[0];
    if (value.startsWith('<!--')) continue;
    if (value.startsWith('<key>')) {
      if (stack.length === 2 && stack[0] === 'plist' && stack[1] === 'dict') {
        const key = value.slice(5, -6);
        if (key.includes('&')) fail('PLIST_UNSUPPORTED_KEY');
        if (key === 'LSUIElement') {
          if (target) fail('PLIST_DUPLICATE_KEY');
          const start = token.index + value.length;
          const bool = /^\s*(<(?:true|false)\s*\/\s*>)/.exec(xml.slice(start));
          if (!bool) fail('PLIST_BOOLEAN_REQUIRED');
          const at = start + bool[0].indexOf('<');
          target = { start: at, end: start + bool[0].length };
        } else if (key === 'CFBundleIdentifier') {
          if (identifier) fail('PLIST_DUPLICATE_KEY');
          const start = token.index + value.length;
          const text = /^\s*<string>[^<>]*<\/string>/.exec(xml.slice(start));
          if (!text) fail('PLIST_STRING_REQUIRED');
          identifier = {
            start: start + text[0].indexOf('<'),
            end: start + text[0].length,
          };
        }
      }
      continue;
    }
    const name = /^<\/?(dict|array|plist)/.exec(value)[1];
    if (value.startsWith('</')) {
      if (stack.length === 2 && name === 'dict') {
        if (close !== -1) fail('PLIST_MULTIPLE_ROOTS');
        close = token.index;
      }
      if (stack.pop() !== name) fail('PLIST_UNBALANCED');
    } else stack.push(name);
  }
  if (stack.length || close < 0) fail('PLIST_UNBALANCED');
  if (!identifier) fail('PLIST_BUNDLE_IDENTIFIER_REQUIRED');
  const changes = [
    { ...identifier, replacement: '<string>' + bundleIdentifier + '</string>' },
    target
      ? { ...target, replacement: '<true/>' }
      : {
          start: close,
          end: close,
          replacement: '\t<key>LSUIElement</key>\n\t<true/>\n',
        },
  ];
  let changed = xml;
  for (const row of changes.sort((a, b) => b.start - a.start))
    changed =
      changed.slice(0, row.start) + row.replacement + changed.slice(row.end);
  return Buffer.from(changed);
}
async function regularPlist(path) {
  const row = await lstat(path);
  if (!row.isFile() || row.isSymbolicLink() || row.nlink !== 1)
    fail('PLIST_REGULAR_SINGLE_FILE_REQUIRED');
  return row;
}
async function cacheLocation(path, source) {
  let cursor = resolve(path),
    parts = [];
  for (;;) {
    try {
      const row = await lstat(cursor);
      if (cursor === resolve(path) && row.isSymbolicLink())
        fail('CACHE_SYMLINK_REJECTED');
      if (!row.isDirectory() && !row.isSymbolicLink())
        fail('CACHE_DIRECTORY_REQUIRED');
      const actual = resolve(await realpath(cursor), ...parts.reverse());
      if (
        actual === source ||
        actual.startsWith(source + sep) ||
        source.startsWith(actual + sep)
      )
        fail('CACHE_SOURCE_OVERLAP');
      return actual;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      parts.push(basename(cursor));
      cursor = parent;
    }
  }
}
async function writeCopiedPlist(path, bytes) {
  const before = await regularPlist(path);
  let handle, first;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
    const actual = await handle.stat();
    if (
      !actual.isFile() ||
      actual.nlink !== 1 ||
      actual.dev !== before.dev ||
      actual.ino !== before.ino
    )
      fail('PLIST_FILE_CHANGED');
    await handle.truncate(0);
    await handle.writeFile(bytes);
  } catch (raw) {
    first = { raw };
  }
  try {
    if (handle) await handle.close();
  } catch (raw) {
    if (!first) first = { raw };
  }
  if (first) throw first.raw;
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function tree(root) {
  const rows = [];
  async function walk(path) {
    const info = await lstat(path),
      name = relative(root, path).split(sep).join('/'),
      row = { path: name, mode: info.mode & 0o7777 };
    if (info.isSymbolicLink()) {
      row.kind = 'symlink';
      row.target = await readlink(path);
    } else if (info.isDirectory()) row.kind = 'directory';
    else if (info.isFile()) {
      row.kind = 'file';
      row.bytes = info.size;
      row.sha256 = await digest(path);
    } else fail('UNSUPPORTED_FILE_KIND');
    rows.push(row);
    if (info.isDirectory())
      for (const child of (await readdir(path)).sort())
        await walk(join(path, child));
  }
  await walk(root);
  return rows;
}
export function prepareNativeTestElectronCopy({
  sourceExecutable,
  cacheRoot,
  platform = process.platform,
}) {
  const key = JSON.stringify([
    resolve(sourceExecutable),
    resolve(cacheRoot),
    platform,
  ]);
  if (copies.has(key)) return copies.get(key);
  const work = (async () => {
    if (platform !== 'darwin') fail('PLATFORM_UNAVAILABLE');
    const executable = await realpath(sourceExecutable),
      source = dirname(dirname(dirname(executable)));
    if (
      !source.endsWith('.app') ||
      relative(source, executable) !== join('Contents', 'MacOS', 'Electron') ||
      basename(executable) !== 'Electron'
    )
      fail('SOURCE_BUNDLE_REQUIRED');
    const cache = await cacheLocation(cacheRoot, source),
      plist = join(source, 'Contents', 'Info.plist'),
      bundleIdentifier =
        'org.xiaok.native-test.cache.c' +
        createHash('sha256').update(cache, 'utf8').digest('hex');
    await regularPlist(plist);
    const before = await tree(source),
      original = await readFile(plist),
      changed = accessoryPlist(original, bundleIdentifier);
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(cache, '.pending-')),
      target = join(staging, 'Electron.app');
    await cp(source, target, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
      mode: constants.COPYFILE_FICLONE,
    });
    await writeCopiedPlist(join(target, 'Contents', 'Info.plist'), changed);
    const after = await tree(source),
      copied = await tree(target);
    if (JSON.stringify(before) !== JSON.stringify(after))
      fail('SOURCE_CHANGED_DURING_COPY');
    const expected = before.map((row) =>
      row.path === 'Contents/Info.plist'
        ? {
            ...row,
            bytes: changed.length,
            sha256: createHash('sha256').update(changed).digest('hex'),
          }
        : row,
    );
    if (JSON.stringify(expected) !== JSON.stringify(copied))
      fail('COPY_BYTES_MISMATCH');
    const receipt = {
      schemaVersion: 1,
      source,
      sourceExecutable: executable,
      onlyChangedPath: 'Contents/Info.plist',
      changedTopLevelKeys: ['CFBundleIdentifier', 'LSUIElement'],
      bundleIdentifier,
      sourceUnchanged: true,
      sourceTree: before,
      copiedTree: copied,
      signatureBoundary:
        'Original binary/framework/signature bytes retained; plist resource seal may no longer verify. No codesign or installation qualification.',
    };
    await writeFile(
      join(staging, 'receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    // Nothing called ready exists until every source/copy verification succeeds.
    const ready = join(cache, 'ready');
    await rename(staging, ready);
    return join(ready, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  })();
  copies.set(key, work);
  return work;
}
export function getNativeTestElectronExecutable(repo) {
  const root = resolve(repo);
  if (runners.has(root)) return runners.get(root);
  const work = (async () => {
    if (process.platform !== 'darwin') fail('PLATFORM_UNAVAILABLE');
    const original = createRequire(join(root, 'desktop', 'package.json'))(
      'electron',
    );
    if (typeof original !== 'string') fail('SOURCE_EXECUTABLE_REQUIRED');
    const cache = await mkdtemp(
      join(tmpdir(), 'xiaok-native-electron-no-dock-'),
    );
    return prepareNativeTestElectronCopy({
      sourceExecutable: original,
      cacheRoot: cache,
    });
  })();
  runners.set(root, work);
  return work;
}
