import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  readlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNativeTestElectronCopy } from './helpers/electron-executable.mjs';
const xml = (value) =>
  `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleIdentifier</key><string>original.bundle</string>${value}</dict></plist>`;
async function fake(plist = xml('')) {
  const root = await mkdtemp(
      join(tmpdir(), 'xiaok-native-electron-helper-test-'),
    ),
    app = join(root, 'source', 'Electron.app'),
    cache = join(root, 'cache');
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
  await mkdir(
    join(app, 'Contents', 'Frameworks', 'Example.framework', 'Versions', 'A'),
    { recursive: true },
  );
  const exe = join(app, 'Contents', 'MacOS', 'Electron');
  await writeFile(exe, 'original-native-executable', { mode: 0o755 });
  await writeFile(
    join(
      app,
      'Contents',
      'Frameworks',
      'Example.framework',
      'Versions',
      'A',
      'Example',
    ),
    'original-framework',
  );
  await symlink(
    'A',
    join(
      app,
      'Contents',
      'Frameworks',
      'Example.framework',
      'Versions',
      'Current',
    ),
  );
  await writeFile(join(app, 'Contents', 'Info.plist'), plist);
  return { root, app, exe, cache, plist };
}
test(
  'private test copy does not share the original com.github.Electron bundle identity',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fake(
      xml('').replace('original.bundle', 'com.github.Electron'),
    );
    await prepareNativeTestElectronCopy({
      sourceExecutable: f.exe,
      cacheRoot: f.cache,
      platform: 'darwin',
    });
    const copied = await readFile(
      join(f.cache, 'ready', 'Electron.app', 'Contents', 'Info.plist'),
      'utf8',
    );
    assert.doesNotMatch(copied, /<string>com\.github\.Electron<\/string>/);
    assert.equal(
      await readFile(join(f.app, 'Contents', 'Info.plist'), 'utf8'),
      f.plist,
    );
  },
);
test(
  'different private test caches have different stable reverse-DNS bundle identities',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fake(
      xml('').replace('original.bundle', 'com.github.Electron'),
    );
    const caches = [f.cache, join(f.root, 'second-cache')];
    const identifiers = [];
    for (const cacheRoot of caches) {
      const options = {
        sourceExecutable: f.exe,
        cacheRoot,
        platform: 'darwin',
      };
      const first = prepareNativeTestElectronCopy(options);
      await first;
      assert.equal(prepareNativeTestElectronCopy(options), first);
      const copied = await readFile(
        join(cacheRoot, 'ready', 'Electron.app', 'Contents', 'Info.plist'),
        'utf8',
      );
      identifiers.push(
        /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(
          copied,
        )[1],
      );
    }
    assert.notEqual(identifiers[0], identifiers[1]);
    for (const identifier of identifiers) {
      assert.match(identifier, /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
      assert.ok(identifier.length < 255);
    }
  },
);
test(
  'test-only copy preserves source and every executable/framework byte while setting only copied plist',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fake(),
      out = await prepareNativeTestElectronCopy({
        sourceExecutable: f.exe,
        cacheRoot: f.cache,
        platform: 'darwin',
      });
    assert.notEqual(out, f.exe);
    assert.equal(await readFile(f.exe, 'utf8'), 'original-native-executable');
    assert.equal(
      await readFile(join(f.app, 'Contents', 'Info.plist'), 'utf8'),
      f.plist,
    );
    assert.equal(await readFile(out, 'utf8'), 'original-native-executable');
    assert.equal((await stat(out)).mode & 0o777, 0o755);
    const copy = join(f.cache, 'ready', 'Electron.app');
    assert.equal(
      await readFile(
        join(
          copy,
          'Contents',
          'Frameworks',
          'Example.framework',
          'Versions',
          'A',
          'Example',
        ),
        'utf8',
      ),
      'original-framework',
    );
    assert.equal(
      await readlink(
        join(
          copy,
          'Contents',
          'Frameworks',
          'Example.framework',
          'Versions',
          'Current',
        ),
      ),
      'A',
    );
    const changed = await readFile(
      join(copy, 'Contents', 'Info.plist'),
      'utf8',
    );
    const receipt = JSON.parse(
      await readFile(join(f.cache, 'ready', 'receipt.json'), 'utf8'),
    );
    assert.equal(
      changed
        .replace('\t<key>LSUIElement</key>\n\t<true/>\n', '')
        .replace(
          '<string>' + receipt.bundleIdentifier + '</string>',
          '<string>original.bundle</string>',
        ),
      f.plist,
    );
    assert.equal(receipt.onlyChangedPath, 'Contents/Info.plist');
    assert.deepEqual(receipt.changedTopLevelKeys, [
      'CFBundleIdentifier',
      'LSUIElement',
    ]);
    assert.match(
      receipt.bundleIdentifier,
      /^org\.xiaok\.native-test\.cache\.c[a-f0-9]{64}$/,
    );
    assert.equal(receipt.sourceUnchanged, true);
  },
);
test(
  'same copy concurrent requests singleflight to one atomically published directory',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fake(),
      options = {
        sourceExecutable: f.exe,
        cacheRoot: f.cache,
        platform: 'darwin',
      };
    const requests = Array.from({ length: 8 }, () =>
      prepareNativeTestElectronCopy(options),
    );
    assert.ok(requests.every((p) => p === requests[0]));
    const outputs = await Promise.all(requests);
    assert.ok(outputs.every((x) => x === outputs[0]));
    assert.equal(
      (await readdir(f.cache)).filter((x) => x === 'ready').length,
      1,
    );
  },
);
test(
  'only top-level test identity and LSUIElement change while nested keys stay byte exact',
  { skip: process.platform === 'win32' },
  async () => {
    const nested =
        '<key>Nested</key><dict><key>LSUIElement</key><false/><key>CFBundleIdentifier</key><string>nested.original</string></dict>',
      f = await fake(xml(nested + '<key>LSUIElement</key><false/>'));
    await prepareNativeTestElectronCopy({
      sourceExecutable: f.exe,
      cacheRoot: f.cache,
      platform: 'darwin',
    });
    const copy = await readFile(
      join(f.cache, 'ready', 'Electron.app', 'Contents', 'Info.plist'),
      'utf8',
    );
    const receipt = JSON.parse(
      await readFile(join(f.cache, 'ready', 'receipt.json'), 'utf8'),
    );
    assert.equal(
      copy.replace(
        '<string>' + receipt.bundleIdentifier + '</string>',
        '<string>original.bundle</string>',
      ),
      f.plist.replace(
        '</dict><key>LSUIElement</key><false/>',
        '</dict><key>LSUIElement</key><true/>',
      ),
    );
    assert.equal(
      await readFile(join(f.app, 'Contents', 'Info.plist'), 'utf8'),
      f.plist,
    );
  },
);
for (const plist of [
  'bplist00invalid',
  xml('<key>LSUIElement</key><string>NO</string>'),
  xml('<key>LSUIElement</key><false/><key>LSUIElement</key><true/>'),
  xml('').replace(
    '<key>CFBundleIdentifier</key><string>original.bundle</string>',
    '',
  ),
  xml('').replace('<string>original.bundle</string>', '<integer>123</integer>'),
  xml('<key>CFBundleIdentifier</key><string>duplicate.bundle</string>'),
]) {
  test(
    'malformed/ambiguous plist never publishes or retries as healthy ' +
      plist.slice(0, 30),
    { skip: process.platform === 'win32' },
    async () => {
      const f = await fake(plist),
        o = { sourceExecutable: f.exe, cacheRoot: f.cache, platform: 'darwin' },
        first = prepareNativeTestElectronCopy(o);
      await assert.rejects(first, /PLIST/);
      assert.equal(prepareNativeTestElectronCopy(o), first);
      await assert.rejects(stat(join(f.cache, 'ready')), /ENOENT/);
      assert.equal(
        await readFile(join(f.app, 'Contents', 'Info.plist'), 'utf8'),
        plist,
      );
    },
  );
}
for (const platform of ['win32', 'linux'])
  test(
    'unsupported platform rejects before copying or selecting a GUI fallback: ' +
      platform,
    async () => {
      const root = await mkdtemp(
          join(tmpdir(), 'xiaok-native-electron-platform-'),
        ),
        cache = join(root, 'cache');
      await assert.rejects(
        prepareNativeTestElectronCopy({
          sourceExecutable: join(
            root,
            'absent.app',
            'Contents',
            'MacOS',
            'Electron',
          ),
          cacheRoot: cache,
          platform,
        }),
        /PLATFORM/,
      );
      await assert.rejects(stat(cache), /ENOENT/);
    },
  );

test(
  'filesystem construction failure publishes no executable and stays the same rejected operation',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fake();
    await writeFile(f.cache, 'not-a-directory');
    const options = {
        sourceExecutable: f.exe,
        cacheRoot: f.cache,
        platform: 'darwin',
      },
      first = prepareNativeTestElectronCopy(options);
    await assert.rejects(first, /EEXIST|ENOTDIR|CACHE_DIRECTORY/);
    assert.equal(prepareNativeTestElectronCopy(options), first);
    await assert.rejects(stat(join(f.cache, 'ready')), /ENOTDIR|ENOENT/);
    assert.equal(await readFile(f.exe, 'utf8'), 'original-native-executable');
  },
);
test('Native Node drivers only obtain Electron executable through the prelaunch helper', async () => {
  const root = new URL('./', import.meta.url),
    files = [];
  async function visit(url) {
    for (const row of await readdir(url, { withFileTypes: true })) {
      if (row.name === 'fixtures') continue;
      const child = new URL(row.name + (row.isDirectory() ? '/' : ''), url);
      if (row.isDirectory()) await visit(child);
      else if (
        row.name.endsWith('.mjs') &&
        row.name !== 'electron-executable.mjs' &&
        row.name !== 'electron-executable.test.mjs'
      )
        files.push(child);
    }
  }
  await visit(root);
  let wired = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /createRequire\([\s\S]{0,100}desktop\/package\.json[\s\S]{0,60}\)\(\s*['"]electron['"]/,
      'direct original Electron path in ' + file,
    );
    assert.doesNotMatch(
      source,
      /require\(\s*['"]electron['"]\s*\)/,
      'direct Electron require in ' + file,
    );
    if (source.includes('getNativeTestElectronExecutable(repo)')) wired++;
  }
  assert.ok(
    wired >= 39,
    'all existing 39 executable driver/helper entry points remain wired',
  );
});

test(
  'symlink Info.plist cannot write through to external original bytes',
  { skip: process.platform === 'win32' },
  async () => {
    const f = await fake(),
      fs = await import('node:fs/promises'),
      external = join(f.root, 'external-original.plist'),
      plist = join(f.app, 'Contents', 'Info.plist');
    await writeFile(external, f.plist);
    await fs.unlink(plist);
    await symlink(external, plist);
    await assert.rejects(
      prepareNativeTestElectronCopy({
        sourceExecutable: f.exe,
        cacheRoot: f.cache,
        platform: 'darwin',
      }),
    );
    assert.equal(
      await readFile(external, 'utf8'),
      f.plist,
      'must reject BEFORE writing through copied symlink',
    );
    await assert.rejects(stat(join(f.cache, 'ready')), /ENOENT/);
  },
);
for (const parentAlias of [false, true])
  test(
    'cache alias cannot write inside the read-only source: ' + parentAlias,
    { skip: process.platform === 'win32' },
    async () => {
      const f = await fake(),
        alias = join(f.root, 'alias');
      await symlink(f.app, alias);
      const before = await readdir(f.app),
        cache = parentAlias ? join(alias, 'new-cache') : alias;
      await assert.rejects(
        prepareNativeTestElectronCopy({
          sourceExecutable: f.exe,
          cacheRoot: cache,
          platform: 'darwin',
        }),
      );
      assert.deepEqual(
        await readdir(f.app),
        before,
        'no source directory may be created before real cache-path validation',
      );
      assert.equal(
        await readFile(join(f.app, 'Contents', 'Info.plist'), 'utf8'),
        f.plist,
      );
    },
  );
