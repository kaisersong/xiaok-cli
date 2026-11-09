import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/** Build-time fixed assets, never a runtime executable/loader configuration. */
export async function buildReadonlyLeafAssets(directory, headerFile = join(directory, 'readonly-leaf-assets.h')) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  mkdirSync(directory, {recursive:true});
  mkdirSync(dirname(headerFile), {recursive:true});
  const entry = join(root, 'src/ai/tools/readonly-leaf-driver.mjs');
  const output = join(directory, 'readonly-leaf-driver.mjs');
  const result = await createRequire(import.meta.url)('esbuild').build({
    entryPoints:[entry], outfile:output, bundle:true, platform:'node', format:'esm', metafile:true,
    banner:{js:"import {createRequire as leafRequire} from 'node:module';const require=leafRequire(import.meta.url);"},
    logLevel:'silent',
  });
  const allowed = new Set(['events','fs','node:crypto','node:fs','node:path','node:util','node:v8','os','path','stream','util']);
  for (const output of Object.values(result.metafile.outputs))
    for (const imported of output.imports)
      if (imported.external && !allowed.has(imported.path))
        throw Error('READONLY_LEAF_UNEXPECTED_EXTERNAL_MODULE:' + imported.path);
  const bytes = readFileSync(output);
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(headerFile,
    '/* Generated from the complete bundled original readonly module graph. */\n' +
    '#define NR_READONLY_LEAF_ASSET_SHA256 ' + JSON.stringify(digest) + '\n' +
    '#define NR_READONLY_LEAF_ASSET_BYTES ' + bytes.length + '\n');
  writeFileSync(join(directory, 'readonly-leaf-assets.json'), JSON.stringify({
    schemaVersion:1, profile:'darwin_nofork_bounded_glob_js_v1', sha256:digest,
    bytes:bytes.length, inputs:result.metafile.inputs, fixedBannerImports:['node:module'],
    boundary:'Fixed asset identity only; not a VFS/old-writer isolation certificate.',
  }, null, 2));
  return headerFile;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await buildReadonlyLeafAssets(resolve(process.argv[2]), process.argv[3] && resolve(process.argv[3]));
