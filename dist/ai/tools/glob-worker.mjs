import { resolve as resolvePath } from 'node:path';
import { permitsSearchPath } from './search-scope.mjs';
import fg from 'fast-glob';
import { readdir, stat, lstat, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { getHeapStatistics } from 'node:v8';

async function search(input, limits) {
  let scannedEntries = 0;
  let directories = 0;
  let metadataCalls = 0;
  let pathBytes = 0;
  let stopped = false;
  const files = [];
  // Static/brace tasks bypass readdir and perform metadata lookups directly.
  const boundedMetadata = operation => (path, ...args) => {
    const callback = args.at(-1);
    if (stopped || ++metadataCalls > limits.maxEntries) {
      stopped = true; callback(new Error('glob_scan_limit')); return;
    }
    if (!permitsSearchPath(path, input.searchScope)) {
      callback(Object.assign(new Error('search_scope_denied'), { code: 'ENOENT' })); return;
    }
    operation(path, ...args);
  };
  // Count before fs.scandir allocates per-entry stat jobs and traversal queues.
  const boundedReaddir = (path, optionsOrCallback, suppliedCallback) => {
    const callback=typeof optionsOrCallback==='function'?optionsOrCallback:suppliedCallback;
    const options=typeof optionsOrCallback==='function'?{}:optionsOrCallback;
    if (stopped || ++directories > limits.maxDirectories) {
      callback(new Error('glob_scan_limit')); return;
    }
    if (!permitsSearchPath(path, input.searchScope)) { callback(null, []); return; }
    readdir(path, options, (error, names) => {
      if (error) {
        if (input.skipInaccessible && ['EACCES', 'EPERM', 'ENOENT'].includes(error.code ?? '')) callback(null, []);
        else callback(error);
        return;
      }
      scannedEntries += names.length;
      if (stopped || scannedEntries > limits.maxEntries) {
        stopped = true; callback(new Error('glob_scan_limit')); return;
      }
      callback(null, input.searchScope ? names.filter(name => permitsSearchPath(resolvePath(path, typeof name==='string'?name:Buffer.isBuffer(name)?name.toString():name.name), input.searchScope)) : names);
    });
  };
  if (input.grep?.directFile) {
    return grepFiles([{ path: input.cwd, mtimeMs: 0 }], input, limits);
  }
  await new Promise((resolve, reject) => {
    const stream = fg.stream(input.patterns, {
      cwd: input.cwd, absolute: true, stats: true,
      concurrency: 2, followSymbolicLinks: false,
      onlyFiles: (input.type ?? 'file') === 'file', onlyDirectories: input.type === 'directory',
      dot: input.dot ?? false, ignore: input.ignore ?? [],
      fs: { readdir: boundedReaddir, stat: boundedMetadata(stat), lstat: boundedMetadata(lstat) },
    });
    const fail = (error) => { stopped = true; stream.destroy(); reject(error); };
    stream.on('data', (entry) => {
      if (stopped || !permitsSearchPath(entry.path, input.searchScope)) return;
      pathBytes += Buffer.byteLength(entry.path);
      if (files.length >= limits.maxResults || pathBytes > limits.maxPathBytes) {
        fail(new Error('glob_result_limit')); return;
      }
      files.push({ path: entry.path, mtimeMs: entry.stats?.mtimeMs ?? 0 });
    });
    stream.once('error', fail);
    stream.once('end', resolve);
  });
  if (input.grep) return grepFiles(files, input, limits);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

function grepFiles(files, input, limits) {
  let matcher;
  try { matcher = new RegExp(input.grep.pattern); }
  catch { throw new Error('grep_invalid_regex'); }
  const result = [];
  let bytes = 0, outputBytes = 0;
  const add = (file, text) => {
    outputBytes += Buffer.byteLength(text);
    if (result.length >= limits.maxResults || outputBytes > limits.maxPathBytes) throw new Error('grep_result_limit');
    result.push({ path: file.path, mtimeMs: file.mtimeMs, text });
  };
  for (const file of files) {
    if (!permitsSearchPath(file.path, input.searchScope)) continue;
    const fd = openSync(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let data;
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) continue;
      if (info.size > 4 * 1024 * 1024 || bytes + info.size > 16 * 1024 * 1024) throw new Error('grep_scan_limit');
      const buffer = Buffer.alloc(info.size + 1);
      let used = 0;
      while (used < buffer.length) {
        const count = readSync(fd, buffer, used, buffer.length - used, used);
        if (!count) break;
        used += count;
      }
      if (used > info.size) throw new Error('grep_scan_limit');
      bytes += used; data = buffer.subarray(0, used);
    } finally { closeSync(fd); }
    if (data.includes(0)) continue;
    const lines = data.toString('utf8').split(/\r?\n/, 100001);
    if (lines.length > 100000) throw new Error('grep_scan_limit');
    const hits = [];
    for (let i = 0; i < lines.length; i++) if (matcher.test(lines[i])) hits.push(i);
    if (!hits.length) continue;
    if (input.grep.outputMode === 'files') { add(file, file.path); continue; }
    if (input.grep.outputMode === 'count') { add(file, file.path + ':' + hits.length); continue; }
    const selected = new Set();
    const context = Math.min(100, Math.max(0, Number.isFinite(input.grep.context) ? Math.floor(input.grep.context) : 0));
    for (const i of hits) for (let n = Math.max(0, i-context); n <= Math.min(lines.length-1, i+context); n++) selected.add(n);
    for (const n of [...selected].sort((a,b)=>a-b)) add(file, file.path + ':' + (n+1) + ':' + lines[n]);
  }
  return result;
}

try {
  // Node's process-level V8 flags can override resourceLimits. Fail closed if
  // the effective heap exceeds 96 MiB old + 8 MiB young and V8 internal space.
  if (getHeapStatistics().heap_size_limit > 128 * 1024 * 1024) throw new Error('glob_worker_heap_config');
  const { input, limits } = workerData;
  parentPort.postMessage({ ok: true, entries: await search(input, limits) });
} catch (error) {
  const code = error instanceof Error && ['glob_scan_limit', 'glob_result_limit', 'glob_worker_heap_config', 'grep_scan_limit', 'grep_result_limit', 'grep_invalid_regex'].includes(error.message)
    ? error.message : 'glob_search_failed';
  parentPort.postMessage({ ok: false, code });
} finally { parentPort.close(); }
