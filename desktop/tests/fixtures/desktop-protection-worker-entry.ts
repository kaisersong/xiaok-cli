import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  const spans: Array<{ start: number; end: number }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const parent = node.parent;
      if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node || parent.name.text !== 'url' || parent.questionDotToken)
        throw Error('unsupported_worker_module_meta');
      spans.push({ start: parent.getStart(syntax), end: parent.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  const originalUrl = pathToFileURL(file).href;
  let transformed = contents;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    transformed = transformed.slice(0, span.start) + JSON.stringify(originalUrl) + transformed.slice(span.end);
  }
  return { contents: transformed, originalUrl, replacements: spans.length };
}
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
export async function compileProtectionWorkerEntry() {
  const artifacts = join(projectRoot, '.artifacts');
  mkdirSync(artifacts, { recursive: true });
  const root = mkdtempSync(join(artifacts, 'fresh-protection-worker-'));
  const source = join(projectRoot, 'src/runtime/task-host/protection-read-worker.ts');
  const sourceSha = hash(source);
  const treeSha = sourceTreeHash();
  try {
    const config = join(root, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({
      extends: join(projectRoot, 'tsconfig.json'),
      compilerOptions: { rootDir: join(projectRoot, 'src'), outDir: root,
        incremental: false, tsBuildInfoFile: join(root, '.tsbuildinfo'),
        declaration: false, sourceMap: false, noEmit: false },
      include: [join(projectRoot, 'src/**/*.ts')],
    }));
    await promisify(execFile)(process.execPath,
      [resolve(projectRoot, 'node_modules/typescript/bin/tsc'), '--project', config],
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
    if (!existsSync(output) || !existsSync(join(root, 'runtime/task-host/protected-observation-store.js'))
      || hash(source) !== sourceSha || sourceTreeHash() !== treeSha) throw Error('fresh_protection_worker_compilation_changed');
    return { root, output, sourceSha, treeSha, emittedSha: hash(output), audit };
  } catch (error) {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
}
