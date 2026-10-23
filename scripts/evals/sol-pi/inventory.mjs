import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMIT = 16 * 1024 * 1024;
const safeNumber = value => Number.isSafeInteger(value) && value >= 0;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const fileKeys = ['discovered', 'authorized', 'notAuthorized', 'missing', 'symlinks',
  'nonRegular', 'tooLarge', 'invalidUtf8', 'invalidJson', 'invalidSchema', 'identityMismatch',
  'unreadable', 'readChanged', 'journalPending', 'journals', 'accepted', 'sourceChangedSurfaces'];
const recordFields = ['sessionId', 'model', 'cacheRead', 'cacheWrite', 'createdAt', 'updatedAt',
  'requestIdentity', 'modelProtocol', 'repositorySha', 'initialSnapshot', 'originalAcceptance', 'allInCost', 'runDuration'];
const resultFields = ['invocationId', 'timestamp', 'complete', 'preTruncationBytes', 'providerPayloadBytes', 'duration'];
const counters = () => Object.fromEntries(fileKeys.map(key => [key, 0]));
const availability = () => ({
  records: Object.fromEntries(recordFields.map(key => [key, fieldCounter()])),
  results: Object.fromEntries(resultFields.map(key => [key, fieldCounter()])),
});
function fieldCounter() { return { present: 0, missing: 0, invalid: 0, schemaUnavailable: 0 }; }
function countField(counter, parent, key, valid, supported = true) {
  const state = !supported ? 'schemaUnavailable' : parent === undefined || !own(parent, key)
    ? (parent !== undefined && !object(parent) ? 'invalid' : 'missing')
    : valid(parent[key]) ? 'present' : 'invalid';
  counter[state]++;
}
function inside(parent, child) {
  const delta = relative(parent, child);
  return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`));
}
async function inputRoots(cliDir, desktopDir) {
  const result = {};
  for (const [name, dir] of [['cli', cliDir], ['desktop', desktopDir]]) {
    try {
      const stat = await fs.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
      result[name] = await fs.realpath(dir);
    } catch { throw new Error('input_directory'); }
  }
  if (inside(result.cli, result.desktop) || inside(result.desktop, result.cli)) throw new Error('input_directory_overlap');
  return result;
}
function validateScope(scope) {
  if (!object(scope) || Object.keys(scope).sort().join(',') !== 'cli,desktop,purpose,schemaVersion'
    || scope.schemaVersion !== 1 || scope.purpose !== 'sol-pi-p0a-local-metadata') throw new Error('scope_manifest');
  for (const name of ['cli', 'desktop']) {
    const entries = scope[name];
    if (!Array.isArray(entries) || new Set(entries).size !== entries.length || entries.some(entry =>
      typeof entry !== 'string' || !entry.endsWith('.json') || entry === '.json'
      || /[\\/:*?\[\]\x00-\x1f]/.test(entry) || basename(entry) !== entry)) throw new Error('scope_manifest');
  }
}
function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
}
async function directorySnapshot(dir) {
  const root = await fs.lstat(dir, { bigint: true });
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('changed');
  const names = (await fs.readdir(dir)).filter(name => name.endsWith('.json') || name.endsWith('.journal.jsonl')).sort();
  const entries = new Map();
  for (const name of names) entries.set(name, await fs.lstat(join(dir, name), { bigint: true }));
  // Root times also catch additions/removals that were not observed as directory entries.
  return { entries, fingerprint: `${identity(root)}\n${names.map(name => `${name}:${identity(entries.get(name))}`).join('\n')}` };
}

async function readBounded(file, before) {
  let handle;
  try {
    const stat = before ?? await fs.lstat(file, { bigint: true });
    if (stat.isSymbolicLink()) return { status: 'symlinks' };
    if (!stat.isFile()) return { status: 'nonRegular' };
    if (stat.size > BigInt(LIMIT)) return { status: 'tooLarge' };
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || identity(opened) !== identity(stat)) return { status: 'readChanged' };
    const chunks = []; let length = 0;
    while (length <= LIMIT) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, LIMIT + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead)); length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(file, { bigint: true });
    if (length > LIMIT || BigInt(length) !== stat.size || identity(after) !== identity(stat)
      || identity(pathAfter) !== identity(stat)) return { status: 'readChanged' };
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)); }
    catch { return { status: 'invalidUtf8' }; }
    try { return { status: 'parsed', value: JSON.parse(text) }; }
    catch { return { status: 'invalidJson' }; }
  } catch { return { status: 'unreadable' }; }
  finally { await handle?.close(); }
}

function usageFor(data, surface) {
  const usage = data.usage;
  if (!object(usage) || !safeNumber(usage.inputTokens) || !safeNumber(usage.outputTokens)
    || (surface === 'desktop' && usage.known !== true)) return { state: 'unknownRecords' };
  if (surface === 'desktop') {
    const events = data.events.filter(event => object(event) && event.type === 'usage_recorded');
    if (events.length > 0) {
      if (events.some(event => !safeNumber(event.inputTokens) || !safeNumber(event.outputTokens))) return { state: 'conflictingRecords' };
      const input = events.reduce((sum, event) => sum + BigInt(event.inputTokens), 0n);
      const output = events.reduce((sum, event) => sum + BigInt(event.outputTokens), 0n);
      if (input !== BigInt(usage.inputTokens) || output !== BigInt(usage.outputTokens)) return { state: 'conflictingRecords' };
    }
  }
  return { state: 'numericRecords', input: usage.inputTokens, output: usage.outputTokens };
}
function project(data, surface, filename) {
  const cli = surface === 'cli'; const id = cli ? data?.sessionId : data?.taskId;
  if (!object(data) || !nonempty(id) || !(cli ? Array.isArray(data.messages) : Array.isArray(data.events))
    || (cli ? data.schemaVersion !== 1 : own(data, 'schemaVersion') && data.schemaVersion !== 1)) return { status: 'invalidSchema' };
  if (filename !== `${id}.json`) return { status: 'identityMismatch' };
  const fields = availability(); const outputs = []; let malformedEntries = 0;
  for (const key of recordFields) {
    if (['sessionId', 'model', 'createdAt', 'updatedAt'].includes(key)) {
      countField(fields.records[key], data, key, ['createdAt', 'updatedAt'].includes(key) ? safeNumber : nonempty, key !== 'model' || cli);
    } else if (key === 'cacheRead' || key === 'cacheWrite') {
      countField(fields.records[key], data.usage, key === 'cacheRead' ? 'cacheReadInputTokens' : 'cacheCreationInputTokens', safeNumber, cli);
    } else countField(fields.records[key], undefined, '', nonempty, false);
  }
  const addOutput = (block, content, error) => {
    outputs.push({ bytes: typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : null,
      units: typeof content === 'string' ? content.length : null, error });
    for (const key of resultFields) {
      if (key === 'invocationId') countField(fields.results[key], block, cli ? 'tool_use_id' : 'toolUseId', nonempty);
      else if (key === 'timestamp') countField(fields.results[key], block, 'ts', safeNumber, !cli);
      else countField(fields.results[key], undefined, '', nonempty, false);
    }
  };
  if (cli) {
    for (const message of data.messages) {
      if (!object(message) || !Array.isArray(message.content)) { malformedEntries++; continue; }
      for (const block of message.content) {
        if (!object(block)) { malformedEntries++; continue; }
        if (block.type === 'tool_result') addOutput(block, block.content, block.is_error === true);
      }
    }
  } else {
    for (const event of data.events) {
      if (!object(event)) { malformedEntries++; continue; }
      if (event.type === 'canvas_tool_result') addOutput(event, event.response, event.ok === false);
    }
  }
  return { status: 'accepted', value: { messageCount: cli ? data.messages.length : 0,
    eventCount: cli ? 0 : data.events.length, malformedEntries, outputs, fields, usage: usageFor(data, surface) } };
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null, max: sorted.at(-1) ?? null };
}
function summarize(records, surface, coverage = 'checkpoint_metadata_only') {
  const outputs = records.flatMap(record => record.outputs);
  const lengths = outputs.filter(output => output.bytes !== null).map(output => output.bytes);
  const total = lengths.reduce((sum, bytes) => sum + BigInt(bytes), 0n);
  const overflow = total > BigInt(Number.MAX_SAFE_INTEGER); const size = distribution(lengths);
  const measured = records.filter(record => record.usage.state === 'numericRecords');
  const input = distribution(measured.map(record => record.usage.input));
  const output = distribution(measured.map(record => record.usage.output));
  const fields = availability();
  for (const record of records) for (const group of ['records', 'results']) {
    for (const key of Object.keys(fields[group])) for (const state of Object.keys(fields[group][key])) fields[group][key][state] += record.fields[group][key][state];
  }
  return { coverage, records: records.length,
    messageCount: records.reduce((sum, record) => sum + record.messageCount, 0),
    eventCount: records.reduce((sum, record) => sum + record.eventCount, 0),
    malformedEntries: records.reduce((sum, record) => sum + record.malformedEntries, 0),
    output: { textResults: lengths.length, unknownResults: outputs.length - lengths.length,
      errorResults: outputs.filter(output => output.error).length,
      checkpointEntriesOver50000Units: outputs.filter(output => output.units !== null && output.units > 50_000).length,
      totalBytes: overflow ? null : Number(total), overflow, p95Bytes: size.p95, maxBytes: size.max, preTruncationCompleteness: 'unknown' },
    usage: { numericRecords: measured.length, unknownRecords: records.filter(record => record.usage.state === 'unknownRecords').length,
      conflictingRecords: records.filter(record => record.usage.state === 'conflictingRecords').length,
      inputP95: input.p95, inputMax: input.max, outputP95: output.p95, outputMax: output.max,
      semantics: surface === 'cli' ? 'mixed_last_or_estimated' : 'checkpoint_cumulative_not_cost' },
    fieldAvailability: fields };
}
function changedSurface(surface) {
  return { files: { ...counters(), sourceChangedSurfaces: 1 }, summary: summarize([], surface, 'source_changed') };
}
async function scanSurface(dir, surface, selected, before) {
  const files = counters(); const records = [];
  const names = [...before.entries.keys()]; const selectedSet = new Set(selected);
  files.discovered = names.filter(name => name.endsWith('.json')).length;
  files.notAuthorized = names.filter(name => name.endsWith('.json') && !selectedSet.has(name)).length;
  files.journals = names.filter(name => name.endsWith('.journal.jsonl')).length;
  files.authorized = selected.length;
  for (const filename of [...selected].sort()) {
    const stat = before.entries.get(filename);
    if (!stat) { files.missing++; continue; }
    if (stat.isSymbolicLink()) { files.symlinks++; continue; }
    if (!stat.isFile()) { files.nonRegular++; continue; }
    if (surface === 'desktop' && before.entries.has(`${filename.slice(0, -5)}.journal.jsonl`)) { files.journalPending++; continue; }
    const result = await readBounded(join(dir, filename), stat);
    if (result.status !== 'parsed') { files[result.status]++; continue; }
    const projected = project(result.value, surface, filename);
    files[projected.status]++;
    if (projected.status === 'accepted') records.push(projected.value);
  }
  return { files, summary: summarize(records, surface) };
}

export async function inventory({ cliDir, desktopDir, authorization }) {
  validateScope(authorization);
  const roots = await inputRoots(cliDir, desktopDir);
  // Both surfaces must remain stable over the entire read phase, including
  // mutations to the first directory while the second directory is scanned.
  const before = {}; const scanned = {};
  for (const name of ['cli', 'desktop']) {
    try { before[name] = await directorySnapshot(roots[name]); } catch { before[name] = null; }
  }
  for (const name of ['cli', 'desktop']) {
    scanned[name] = before[name]
      ? await scanSurface(roots[name], name, authorization[name], before[name]) : changedSurface(name);
  }
  for (const name of ['cli', 'desktop']) {
    if (!before[name]) continue;
    try {
      if ((await directorySnapshot(roots[name])).fingerprint !== before[name].fingerprint) scanned[name] = changedSurface(name);
    } catch { scanned[name] = changedSurface(name); }
  }
  const files = counters(); const surfaces = {};
  for (const name of ['cli', 'desktop']) {
    surfaces[name] = scanned[name].summary;
    for (const key of fileKeys) files[key] += scanned[name].files[key];
  }
  return { schemaVersion: 1, admission: 'inconclusive', approvedCandidates: [], independentTaskCount: null,
    fileCountersScope: 'stable_surfaces_only', files, surfaces: { ...surfaces, managedChild: { coverage: 'not_measured' } },
    taskBuckets: [ ['desktop', 'short_qa'], ['desktop', 'code_and_verify'], ['desktop', 'long_log'], ['desktop', 'material_delivery'],
      ['managedChild', 'readonly_probe'], ['managedChild', 'log_diagnosis'], ['managedChild', 'artifact_handoff'], ['cli', 'control'] ]
      .map(([surface, bucket]) => ({ surface, bucket, status: 'unavailable', admission: 'inconclusive' })),
    opportunities: { repeated_provider_output: 'unavailable', edit_verify_roundtrips: 'unavailable', post_compaction_calls: 'unavailable', used_log_evidence: 'unavailable' } };
}
export async function writeReport({ cliDir, desktopDir, output, report }) {
  const roots = await inputRoots(cliDir, desktopDir);
  const target = join(await fs.realpath(dirname(resolve(output))), basename(output));
  if (inside(roots.cli, target) || inside(roots.desktop, target)) throw new Error('output_inside_input');
  const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
}
async function main(args) {
  const allowed = ['--cli-dir', '--desktop-dir', '--scope-manifest', '--out']; const values = new Map();
  if (args.length !== 8) throw new Error('arguments');
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
    values.set(args[i], args[i + 1]);
  }
  const scope = await readBounded(resolve(values.get('--scope-manifest')));
  if (scope.status !== 'parsed') throw new Error('scope_manifest');
  const options = { cliDir: values.get('--cli-dir'), desktopDir: values.get('--desktop-dir'), authorization: scope.value };
  const report = await inventory(options);
  await writeReport({ ...options, output: values.get('--out'), report });
  process.stdout.write('sol_pi_inventory_written\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => { process.stderr.write('sol_pi_inventory_failed\n'); process.exitCode = 1; });
}
