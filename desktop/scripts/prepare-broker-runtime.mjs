import {createRequire} from 'node:module';
import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {targetEntry, verifyRuntimeDirectory} = require('../electron/broker-runtime-package.cjs');
const {prepareBrokerRuntime} = require('./pack-broker-runtime.cjs');
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--all')) throw Error('broker_runtime_prepare_arguments');
const targets = args[0] === '--all' ? ['darwin-arm64', 'win32-x64'] : [`${process.platform}-${process.arch}`];
for (const target of targets) {
const entry = targetEntry(target);
if (!entry) {
  console.log(JSON.stringify({target, qualified: false, reason: 'legacy_runtime_target'}));
} else {
  const cacheRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.artifacts', 'broker-runtimes');
  let exists = false;
  try { await import('node:fs/promises').then(fs => fs.lstat(join(cacheRoot, target))); exists = true; }
  catch (raw) { if (raw?.code !== 'ENOENT') throw raw; }
  if (exists) {
    verifyRuntimeDirectory(join(cacheRoot, target), target); // Invalid existing profiles never get overwritten.
    console.log(JSON.stringify({target, prepared: false, verified: true}));
  } else {
    await mkdir(cacheRoot, {recursive: true, mode: 0o700});
    const staging = await mkdtemp(join(cacheRoot, '.download-'));
    const archive = join(staging, entry.archive);
    const response = await fetch(`https://nodejs.org/dist/v24.19.0/${entry.archive}`, {redirect: 'error', signal: AbortSignal.timeout(120000)});
    if (!response.ok || !response.body) throw Error(`broker_runtime_download_http_${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > entry.archiveSize) throw Error('broker_runtime_download_size');
      chunks.push(Buffer.from(chunk));
    }
    if (size !== entry.archiveSize) throw Error('broker_runtime_download_size');
    await writeFile(archive, Buffer.concat(chunks), {flag: 'wx', mode: 0o400});
    prepareBrokerRuntime({archive, cacheRoot, target});
    // Only the successful, owned download directory is disposable.
    await rm(archive); await rm(staging, {recursive: true});
    console.log(JSON.stringify({target, prepared: true, verified: true}));
  }
}
}
