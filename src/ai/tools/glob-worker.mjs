import fg from 'fast-glob';
import { readdir, stat, lstat } from 'node:fs';
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
    operation(path, ...args);
  };
  // Count before fs.scandir allocates per-entry stat jobs and traversal queues.
  const boundedReaddir = (path, callback) => {
    if (stopped || ++directories > limits.maxDirectories) {
      callback(new Error('glob_scan_limit')); return;
    }
    readdir(path, (error, names) => {
      if (error) {
        if (input.skipInaccessible && ['EACCES', 'EPERM', 'ENOENT'].includes(error.code ?? '')) callback(null, []);
        else callback(error);
        return;
      }
      scannedEntries += names.length;
      if (stopped || scannedEntries > limits.maxEntries) {
        stopped = true; callback(new Error('glob_scan_limit')); return;
      }
      callback(null, names);
    });
  };
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
      if (stopped) return;
      pathBytes += Buffer.byteLength(entry.path);
      if (files.length >= limits.maxResults || pathBytes > limits.maxPathBytes) {
        fail(new Error('glob_result_limit')); return;
      }
      files.push({ path: entry.path, mtimeMs: entry.stats?.mtimeMs ?? 0 });
    });
    stream.once('error', fail);
    stream.once('end', resolve);
  });
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
}

try {
  // Node's process-level V8 flags can override resourceLimits. Fail closed if
  // the effective heap exceeds 96 MiB old + 8 MiB young and V8 internal space.
  if (getHeapStatistics().heap_size_limit > 128 * 1024 * 1024) throw new Error('glob_worker_heap_config');
  const { input, limits } = workerData;
  parentPort.postMessage({ ok: true, entries: await search(input, limits) });
} catch (error) {
  const code = error instanceof Error && ['glob_scan_limit', 'glob_result_limit', 'glob_worker_heap_config'].includes(error.message)
    ? error.message : 'glob_search_failed';
  parentPort.postMessage({ ok: false, code });
} finally { parentPort.close(); }
