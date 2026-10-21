import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, win32 } from 'node:path';

const native = vi.hoisted(() => ({
  resolve: vi.fn(), require: vi.fn(), access: vi.fn(), load: vi.fn(), cut: vi.fn(),
}));
vi.mock('node:module', () => ({ createRequire: () => Object.assign(native.require, { resolve: native.resolve }) }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(), accessSync: native.access,
}));

const files = ['jieba.dict.utf8', 'hmm_model.utf8', 'user.dict.utf8', 'idf.utf8', 'stop_words.utf8'];
const base = join('/', 'fixture', 'node_modules', 'nodejieba');
function expectedLoad(prefix: string, moduleBase = base) {
  const dict = join(moduleBase, 'submodules', 'cppjieba', 'dict');
  return {
    dict: prefix + join(dict, files[0]!), hmmDict: prefix + join(dict, files[1]!),
    userDict: prefix + join(dict, files[2]!), idfDict: prefix + join(dict, files[3]!),
    stopWordDict: prefix + join(dict, files[4]!),
  };
}
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  native.resolve.mockReturnValue(join(base, 'index.js'));
  native.require.mockReturnValue({ load: native.load, cut: native.cut });
  native.load.mockReturnValue(true); native.cut.mockReturnValue(['南京市', '长江大桥']);
});
afterEach(() => vi.restoreAllMocks());

describe('native dictionary paths through the shared segmentation entry', () => {
  it('passes all five Windows dictionary namespace paths to readability checks and native load', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const namespace = vi.spyOn(win32, 'toNamespacedPath').mockImplementation(p => 'NAMESPACE:' + p);
    const segment = await import('../../../src/ai/memory/segment.js');
    expect(segment.segmentationAvailable()).toBe(true);
    const expected = expectedLoad('NAMESPACE:');
    expect(namespace.mock.calls).toEqual(Object.values(expectedLoad('')).map(p => [p]));
    expect(native.access.mock.calls.map(args => args[0])).toEqual(Object.values(expected));
    expect(native.load).toHaveBeenCalledExactlyOnceWith(expected);
    expect(segment.segmentChinese('南京市长江大桥')).toBe('南京市 长江大桥');
    expect(segment.segmentQuery('南京市长江大桥')).toBe('南京市 长江大桥');
    expect(native.load).toHaveBeenCalledTimes(1);
  });

  for (const name of ['app.asar', 'app.asar.unpacked', 'app.asar-cache']) {
    it(`resolves ${name} before converting each actual dictionary path`, async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      const namespace = vi.spyOn(win32, 'toNamespacedPath').mockImplementation(p => 'NAMESPACE:' + p);
      native.resolve.mockReturnValue(join('/', 'fixture', name, 'node_modules', 'nodejieba', 'index.js'));
      const segment = await import('../../../src/ai/memory/segment.js');
      expect(segment.segmentationAvailable()).toBe(true);
      const actualBase = join('/', 'fixture', name === 'app.asar' ? 'app.asar.unpacked' : name, 'node_modules', 'nodejieba');
      expect(namespace.mock.calls).toEqual(Object.values(expectedLoad('', actualBase)).map(p => [p]));
      expect(native.load).toHaveBeenCalledExactlyOnceWith(expectedLoad('NAMESPACE:', actualBase));
    });
  }

  for (const directory of ['中文', 'café', 'emoji-😀']) {
    it(`degrades before native loading for Windows ${directory} paths`, async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      const namespace = vi.spyOn(win32, 'toNamespacedPath');
      native.resolve.mockReturnValue(join('/', directory, 'node_modules', 'nodejieba', 'index.js'));
      const segment = await import('../../../src/ai/memory/segment.js');
      expect(segment.resolveJiebaDictPaths()).toBeNull();
      expect(segment.segmentationAvailable()).toBe(false);
      expect(segment.segmentChinese('南京市长江大桥')).toBe('南京市长江大桥');
      expect(segment.segmentQuery('自然语言处理')).toBe('自然语言处理');
      expect(namespace).not.toHaveBeenCalled(); expect(native.access).not.toHaveBeenCalled();
      expect(native.require).not.toHaveBeenCalled(); expect(native.load).not.toHaveBeenCalled();
    });
  }

  for (const platform of ['darwin', 'linux'] as const) {
    it(`keeps Unicode dictionary paths and native segmentation on ${platform}`, async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
      const namespace = vi.spyOn(win32, 'toNamespacedPath');
      const unicodeBase = join('/', '中文', 'node_modules', 'nodejieba');
      native.resolve.mockReturnValue(join(unicodeBase, 'index.js'));
      const segment = await import('../../../src/ai/memory/segment.js');
      expect(segment.segmentationAvailable()).toBe(true);
      expect(native.load).toHaveBeenCalledExactlyOnceWith(expectedLoad('', unicodeBase));
      expect(namespace).not.toHaveBeenCalled();
    });
  }

  it('keeps a missing optional module unavailable without touching native code', async () => {
    native.resolve.mockImplementation(() => { throw Error('MODULE_NOT_FOUND'); });
    const segment = await import('../../../src/ai/memory/segment.js');
    expect(segment.segmentationAvailable()).toBe(false);
    expect(segment.segmentChinese('南京市长江大桥')).toBe('南京市长江大桥');
    expect(native.access).not.toHaveBeenCalled(); expect(native.require).not.toHaveBeenCalled();
  });

  for (const missing of files) {
    it(`never calls native load when ${missing} cannot be read`, async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      native.access.mockImplementation((file: string) => { if (file.endsWith(missing)) throw Error('ENOENT'); });
      const segment = await import('../../../src/ai/memory/segment.js');
      expect(segment.segmentationAvailable()).toBe(false);
      expect(segment.segmentQuery('自然语言处理')).toBe('自然语言处理');
      expect(native.require).not.toHaveBeenCalled(); expect(native.load).not.toHaveBeenCalled();
    });
  }

  it('keeps the original fallback after a native load exception without retrying load', async () => {
    native.load.mockImplementation(() => { throw Error('native binding missing'); });
    const segment = await import('../../../src/ai/memory/segment.js');
    expect(segment.segmentationAvailable()).toBe(false);
    expect(segment.segmentChinese('南京市长江大桥')).toBe('南京市长江大桥');
    expect(segment.segmentQuery('自然语言处理')).toBe('自然语言处理');
    expect(native.load).toHaveBeenCalledTimes(1); expect(native.cut).not.toHaveBeenCalled();
  });

  it('does not pass an unconverted fallback path to native code when namespace conversion throws', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(win32, 'toNamespacedPath').mockImplementation(() => { throw Error('namespace failure'); });
    const segment = await import('../../../src/ai/memory/segment.js');
    expect(segment.segmentationAvailable()).toBe(false);
    expect(native.access).not.toHaveBeenCalled(); expect(native.require).not.toHaveBeenCalled();
  });
});
