import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetSegmentationWorkerForTests, type SegmentationRuntimeInfo } from '../../../src/ai/memory/segment.js';
import {
  PACKAGED_SEGMENTATION_SAMPLE,
  packagedSegmentationErrors,
  runPackagedSegmentationSmoke,
  type PackagedAppLocation,
} from '../../electron/packaged-segmentation-smoke.js';

// #150 M6 (CTO ruling 2026-11-03): the packaged smoke asserts cut('南京市长江大桥') through the
// product worker path, loaded from app.asar(.unpacked). Expected literal kept here on purpose,
// independent of PACKAGED_SEGMENTATION_EXPECTED, so a wrong expectation in the module fails.
const EXPECTED = '南京市 长江大桥';

const posixApp: PackagedAppLocation = { resourcesPath: '/opt/xiaok/resources', isPackaged: true, platform: 'linux' };
const unpacked = '/opt/xiaok/resources/app.asar.unpacked/node_modules/nodejieba';
const dictDir = `${unpacked}/submodules/cppjieba/dict`;

function info(overrides: Partial<SegmentationRuntimeInfo> = {}): SegmentationRuntimeInfo {
  return {
    workerEntry: `${unpacked}/index.js`,
    dictionaryPaths: {
      dict: `${dictDir}/jieba.dict.utf8`,
      hmmDict: `${dictDir}/hmm_model.utf8`,
      userDict: `${dictDir}/user.dict.utf8`,
      idfDict: `${dictDir}/idf.utf8`,
      stopWordDict: `${dictDir}/stop_words.utf8`,
    },
    workerReady: true,
    failureReason: null,
    synchronousLoad: false,
    ...overrides,
  };
}

const exists = () => true;

describe('packaged segmentation smoke (#150 M6)', () => {
  afterEach(async () => { await resetSegmentationWorkerForTests(); });

  it('passes for the expected cut through the worker from app.asar.unpacked', () => {
    expect(packagedSegmentationErrors({ output: EXPECTED, elapsedMs: 900, info: info(), app: posixApp, fileExists: exists })).toEqual([]);
  });

  it('fails when the cut result is wrong', () => {
    const errors = packagedSegmentationErrors({ output: '南京 市长 江大桥', elapsedMs: 900, info: info(), app: posixApp, fileExists: exists });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('expected "南京市 长江大桥"');
    // Unsegmented text (what a skipped segmentation returns) fails as well.
    expect(packagedSegmentationErrors({ output: PACKAGED_SEGMENTATION_SAMPLE, elapsedMs: 900, info: info(), app: posixApp, fileExists: exists })).not.toEqual([]);
  });

  it('fails when nodejieba or a dictionary comes from a development node_modules', () => {
    const dev = '/home/dev/xiaok-cli/node_modules/nodejieba';
    const errors = packagedSegmentationErrors({
      output: EXPECTED,
      elapsedMs: 900,
      info: info({ workerEntry: `${dev}/index.js`, dictionaryPaths: { dict: `${dev}/submodules/cppjieba/dict/jieba.dict.utf8` } }),
      app: posixApp,
      fileExists: exists,
    });
    expect(errors.join('\n')).toContain('nodejieba entry is outside the packaged app');
    expect(errors.join('\n')).toContain('dictionary dict is outside the packaged app');
    // A sibling directory whose name only starts with the resources path is outside too.
    expect(packagedSegmentationErrors({
      output: EXPECTED, elapsedMs: 900, app: posixApp, fileExists: exists,
      info: info({ workerEntry: '/opt/xiaok/resources/app.asar.unpacked-dev/node_modules/nodejieba/index.js' }),
    }).join('\n')).toContain('outside the packaged app');
  });

  it('fails on a fallback, a synchronous load, no worker, a missing binding, or an unpackaged app', () => {
    const run = (overrides: Partial<SegmentationRuntimeInfo>, app = posixApp, fileExists = exists) =>
      packagedSegmentationErrors({ output: EXPECTED, elapsedMs: 900, info: info(overrides), app, fileExists }).join('\n');
    expect(run({ failureReason: 'ready deadline exceeded', workerReady: false })).toContain('fell back: ready deadline exceeded');
    expect(run({ synchronousLoad: true })).toContain('synchronous fallback');
    expect(run({ workerEntry: null, dictionaryPaths: null, workerReady: false })).toContain('worker did not start');
    expect(run({}, posixApp, () => false)).toContain('native binding missing');
    expect(run({}, { ...posixApp, isPackaged: false })).toContain('app.isPackaged=false');
  });

  it('accepts Windows namespaced paths under app.asar.unpacked, case-insensitively', () => {
    const winApp: PackagedAppLocation = { resourcesPath: 'C:\\Users\\a\\xiaok\\resources', isPackaged: true, platform: 'win32' };
    const root = '\\\\?\\c:\\users\\a\\xiaok\\RESOURCES\\app.asar.unpacked\\node_modules\\nodejieba';
    expect(packagedSegmentationErrors({
      output: EXPECTED, elapsedMs: 900, app: winApp, fileExists: exists,
      info: info({ workerEntry: 'C:\\Users\\a\\xiaok\\resources\\app.asar.unpacked\\node_modules\\nodejieba\\index.js', dictionaryPaths: { dict: `${root}\\submodules\\cppjieba\\dict\\jieba.dict.utf8` } }),
    })).toEqual([]);
  });

  it('throws (failing the whole smoke) and logs path and timing when the step fails', async () => {
    const lines: string[] = [];
    let t = 1_000;
    await expect(runPackagedSegmentationSmoke(posixApp, {
      segment: async () => '南京 市长 江大桥',
      info: () => info(),
      now: () => (t += 250),
      log: (line) => lines.push(line),
    })).rejects.toThrow(/PACKAGED_SEGMENTATION_FAILED: .*expected "南京市 长江大桥"/);
    expect(lines.join('\n')).toMatch(/elapsedMs=250 workerEntry=\/opt\/xiaok\/resources\/app\.asar\.unpacked\/node_modules\/nodejieba\/index\.js/);
    await expect(runPackagedSegmentationSmoke(posixApp, {
      segment: async () => { throw new Error('dictionary load failed'); },
      info: () => info(),
      log: () => {},
    })).rejects.toThrow(/PACKAGED_SEGMENTATION_FAILED: segmentation threw: dictionary load failed/);
  });

  it('returns the load path and timing when the step passes', async () => {
    const result = await runPackagedSegmentationSmoke(posixApp, {
      segment: async () => EXPECTED,
      info: () => info(),
      now: (() => { let t = 0; return () => (t += 700); })(),
      log: () => {},
      fileExists: exists,
    });
    expect(result).toMatchObject({
      status: 'pass',
      output: EXPECTED,
      elapsedMs: 700,
      workerEntry: `${unpacked}/index.js`,
      nativeBinding: join(unpacked, 'build', 'Release', 'nodejieba.node'),
      dictionaryDir: dictDir,
    });
  });

  it('on the real product path segments correctly via the worker, and rejects the development node_modules', async () => {
    await resetSegmentationWorkerForTests();
    const lines: string[] = [];
    const devResources = join(process.cwd(), 'not-a-packaged-app', 'resources');
    const error = await runPackagedSegmentationSmoke({ resourcesPath: devResources, isPackaged: true }, { log: (line) => lines.push(line) })
      .then(() => null, (e: unknown) => e as Error);
    expect(lines[0]).toContain(`output="${EXPECTED}"`);
    expect(lines[0]).toContain('failureReason=none');
    expect(error?.message).toMatch(/^PACKAGED_SEGMENTATION_FAILED: nodejieba entry is outside the packaged app: .*node_modules[\\/]nodejieba/);
    expect(error?.message).not.toContain('fell back');
    expect(error?.message).not.toContain('expected "');
  });
});
