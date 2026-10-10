// @vitest-environment node
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import type ts from 'typescript';

const desktopRoot = join(__dirname, '..', '..');
// Runtime worker/process URLs and relative dynamic imports used by Desktop.
// Office's .mjs worker is copied by build:main, covered by office-parser-packaging.test.ts.
const runtimeLoadedFiles = [
  'desktop/electron/artifact-editing.js',
  'desktop/electron/desktop-services.js',
  'desktop/electron/kb-chunker.js',
  'desktop/electron/kb-query-terms.js',
  'desktop/electron/kb-source-extractor.js',
  'desktop/electron/kb-store-sqlite.js',
  'desktop/electron/kimi-packaged-smoke.js',
  'desktop/electron/meeting-aliyun-live-transcriber.js',
  'desktop/electron/meeting-asr-config.js',
  'desktop/electron/meeting-audio-format.js',
  'desktop/electron/meeting-local-transcriber.js',
  'desktop/electron/meeting-model-service.js',
  'desktop/electron/meeting-online-asr-transcriber.js',
  'desktop/electron/meeting-punctuation-service.js',
  'desktop/electron/meeting-punctuation-worker.js',
  'desktop/electron/meeting-service.js',
  'desktop/electron/meeting-sherpa-onnx-transcriber.js',
  'desktop/electron/meeting-summary-service.js',
  'desktop/electron/meeting-volcengine-live-transcriber.js',
  'desktop/electron/memory-import-parser.js',
  'desktop/electron/pdf-text.js',
  'desktop/electron/principles-store.js',
  'desktop/electron/windows-computer-use-identity.js',
  'src/ai/memory/layered-store.js',
  'src/ai/memory/model-registry.js',
  'src/platform/computer-use/macos-cua-connection.js',
  'src/platform/computer-use/windows-cua-backend.js',
  'src/platform/mcp/cua-connection-manager.js',
  'src/runtime/conversation-activity/owner-entry.js',
  'src/runtime/conversation-activity/owner-pending-reader.js',
  'src/runtime/conversation-activity/store.js',
  'src/runtime/task-host/delivery-verifier-worker.js',
  'src/utils/config.js',
];

it('emits runtime string-path targets from the Desktop TypeScript build', () => {
  const require = createRequire(join(desktopRoot, 'package.json'));
  const typescript: typeof ts = require('typescript');
  const configPath = join(desktopRoot, 'tsconfig.electron.json');
  const config = typescript.readConfigFile(configPath, typescript.sys.readFile);
  expect(config.error).toBeUndefined();
  const outDir = resolve(desktopRoot, '.runtime-emission-test');
  const parsed = typescript.parseJsonConfigFileContent(config.config, typescript.sys, desktopRoot, {
    outDir, incremental: false, noEmitOnError: false,
  }, configPath);
  expect(parsed.errors).toEqual([]);
  const program = typescript.createProgram(parsed.fileNames, parsed.options);
  const emitted = new Set<string>();
  // Use the real compiler's write callback; no disk writes or subprocess are needed.
  const result = program.emit(undefined, file => { emitted.add(resolve(file)); });
  expect(result.emitSkipped).toBe(false);
  const missing = runtimeLoadedFiles.filter(file => !emitted.has(resolve(outDir, file)));
  expect(missing).toEqual([]);
}, 29_000);
