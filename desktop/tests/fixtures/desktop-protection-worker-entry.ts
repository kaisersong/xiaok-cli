import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import ts from 'typescript';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** Preserve the original emitted module's actual ESM URL when bundling. Only
 * lexical expressions are changed; strings, comments and all IO stay intact. */
export function preserveOriginalModuleUrls(contents: string, file: string) {
  const syntax = ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const spans: Array<{ start: number; end: number; value: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const parent = node.parent;
      if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node || !['url', 'dirname'].includes(parent.name.text) || parent.questionDotToken)
        throw Error('unsupported_worker_module_meta');
      spans.push({ start: parent.getStart(syntax), end: parent.getEnd(),
        value: parent.name.text === 'url' ? pathToFileURL(file).href : dirname(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  const originalUrl = pathToFileURL(file).href;
  let transformed = contents;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    transformed = transformed.slice(0, span.start) + JSON.stringify(span.value) + transformed.slice(span.end);
  }
  return { contents: transformed, originalUrl, replacements: spans.length };
}
const compilerInputAuditScript = String.raw`import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const original=fs.readFileSync,first=new Map();
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
fs.readFileSync=function(file,...args){const value=original.call(this,file,...args);if(typeof file==='string'&&path.isAbsolute(file)&&!first.has(file))first.set(file,digest(Buffer.isBuffer(value)?value:Buffer.from(value)));return value;};syncBuiltinESMExports();
process.once('exit',()=>{const configIndex=process.argv.indexOf('--project'),config=configIndex>=0?process.argv[configIndex+1]:undefined;if(!config)return;const drift=[];for(const [file,hash]of first)if(fs.existsSync(file)&&digest(original.call(fs,file))!==hash)drift.push(file);fs.writeFileSync(path.join(path.dirname(config),'compiler-input-audit.json'),JSON.stringify({firstReads:Object.fromEntries(first),drift,exitCode:process.exitCode??0},null,2)+'\n',{flag:'wx'});});
`;

function sourceTreeHash(): string {
  const digest = createHash('sha256');
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.ts')) digest.update(file).update(hash(file));
    }
  };
  visit(join(projectRoot, 'src'));
  return digest.digest('hex');
}

/** Fresh actual production JS, including every sibling dynamically imported by
 * the fixed Worker. No payload, result, exit or read implementation is replaced. */
export async function compileProtectionWorkerEntry(ownership: { onAcquired?: (root: string) => void } = {}) {
  const onAcquired = ownership.onAcquired;
  const artifacts = join(projectRoot, '.artifacts');
  mkdirSync(artifacts, { recursive: true });
  const root = mkdtempSync(join(artifacts, 'fresh-protection-worker-'));
  onAcquired?.(root);
  const source = join(projectRoot, 'src/runtime/task-host/protection-read-worker.ts');
  const sourceSha = hash(source);
  const treeSha = sourceTreeHash();
  try {
    const rootConfig = join(projectRoot, 'tsconfig.json');
    const rootConfigSha = hash(rootConfig);
    const rootConfigRead = ts.readConfigFile(rootConfig, ts.sys.readFile);
    if (rootConfigRead.error) throw Error('worker_root_config_invalid');
    const parsedRoot = ts.parseJsonConfigFileContent(rootConfigRead.config, ts.sys, projectRoot);
    if (parsedRoot.errors.length) throw Error('worker_root_config_invalid');
    const roots = [source, join(projectRoot, 'src/runtime/task-host/protection-read-worker-body.ts'),
      join(projectRoot, 'src/runtime/task-host/protected-observation-store.ts'), ...parsedRoot.fileNames.filter(file => file.endsWith('.d.ts'))];
    const config = join(root, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({
      extends: join(projectRoot, 'tsconfig.json'),
      compilerOptions: { rootDir: join(projectRoot, 'src'), outDir: root,
        incremental: false, tsBuildInfoFile: join(root, '.tsbuildinfo'),
        declaration: false, sourceMap: false, noEmit: false, noCheck: false },
      include: [], files: roots,
    }));
    const inputPreload = join(root, 'compiler-input-preload.mjs');
    writeFileSync(inputPreload, compilerInputAuditScript);
    await promisify(execFile)(process.execPath,
      ['--import', pathToFileURL(inputPreload).href, resolve(projectRoot, 'node_modules/typescript/bin/tsc'), '--project', config],
      { cwd: projectRoot, maxBuffer: 2 * 1024 * 1024 });
    writeFileSync(join(root, 'package.json'), readFileSync(join(projectRoot, 'package.json')));
    const storeEntry = join(root, 'runtime/task-host/protected-observation-store.js');
    const bundle = join(root, 'runtime/task-host/protected-observation-store.bundle.js');
    const moduleUrls = new Map<string, ReturnType<typeof preserveOriginalModuleUrls>>();
    const result = await build({ absWorkingDir: projectRoot, entryPoints: [storeEntry], outfile: bundle,
      bundle: true, platform: 'node', format: 'esm', packages: 'external', metafile: true,
      plugins: [{ name: 'preserve-fixed-emitted-module-urls', setup(context) {
        context.onLoad({ filter: /\.js$/ }, input => {
          const local = relative(root, input.path);
          if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep))
            throw Error('worker_bundle_source_outside_compilation');
          const preserved = preserveOriginalModuleUrls(readFileSync(input.path, 'utf8'), input.path);
          moduleUrls.set(input.path, preserved);
          return { contents: preserved.contents, loader: 'js' };
        });
      } }],
    });
    const metaInputs = Object.keys(result.metafile!.inputs).map(file => resolve(projectRoot, file));
    if (metaInputs.some(file => !moduleUrls.has(file))) throw Error('worker_bundle_input_not_audited');
    const audit = metaInputs.map(file => ({ file, originalUrl: moduleUrls.get(file)!.originalUrl,
      replacements: moduleUrls.get(file)!.replacements }));
    renameSync(bundle, storeEntry);
    const output = join(root, 'runtime/task-host/protection-read-worker.js');
    const compilerAudit = JSON.parse(readFileSync(join(root, 'compiler-input-audit.json'), 'utf8')) as { firstReads: Record<string, string>; drift: string[]; exitCode: number };
    const readDrift = Object.entries(compilerAudit.firstReads).filter(([file, sha]) => !existsSync(file) || hash(file) !== sha).map(([file]) => file);
    if (compilerAudit.exitCode !== 0 || compilerAudit.drift.length || readDrift.length) throw Error('fresh_protection_worker_input_changed');
    const emittedOutputs: Record<string, string> = {};
    const captureOutputs = (directory: string): void => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name); if (entry.isDirectory()) captureOutputs(file); else if (file.endsWith('.js')) emittedOutputs[file] = hash(file);
    } }; captureOutputs(root);
    if (!existsSync(output) || !existsSync(join(root, 'runtime/task-host/protection-read-worker-body.js'))
      || !existsSync(join(root, 'runtime/task-host/protected-observation-store.js'))
      || hash(source) !== sourceSha || sourceTreeHash() !== treeSha || hash(rootConfig) !== rootConfigSha) throw Error('fresh_protection_worker_compilation_changed');
    return { root, output, sourceSha, treeSha, emittedSha: hash(output), audit,
      compilation: { roots, noCheck: false as const, firstReadHashes: compilerAudit.firstReads, readDrift, emittedOutputs } };
  } catch (error) {
    if (!onAcquired) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
}
