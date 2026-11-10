import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, lstatSync, realpathSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export function brokerResourcePlan(platform) {
  return Object.freeze({ native: platform === 'darwin', portableSourceRuntime: true });
}
function main() {
  const source = dirname(fileURLToPath(import.meta.url)), repo = resolve(source, '../..'), args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--headers')) throw Error('BROKER_AUTHORITY_BUILD_ARGUMENT_INVALID');
  const plan = brokerResourcePlan(process.platform);
  const headers = plan.native ? realpathSync(args.length ? resolve(args[1]) : resolve(dirname(realpathSync(process.execPath)), '../include/node')) : '-';
  const parent = join(source, 'build'), output = join(parent, 'Release');
  mkdirSync(parent, { recursive: true });
  if (lstatSync(parent).isSymbolicLink()) throw Error('BROKER_AUTHORITY_BUILD_DIRECTORY_INVALID');
  if (existsSync(output)) {
    if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) throw Error('BROKER_AUTHORITY_BUILD_OUTPUT_INVALID');
    const old = JSON.parse(readFileSync(join(output, 'source-manifest.json'), 'utf8'));
    if (old.kind !== 'original_broker_authority_build_v1') throw Error('BROKER_AUTHORITY_BUILD_OUTPUT_NOT_OWNED');
  }
  const temporary = mkdtempSync(join(parent, '.broker-build-'));
  const p = spawnSync(process.execPath, [join(source, 'build.mjs'), headers, temporary], { cwd: repo, encoding: 'utf8', timeout: 120000 });
  const record = { pid: p.pid, status: p.status, signal: p.signal, stdout: p.stdout, stderr: p.stderr, temporary, qualification: false };
  writeFileSync(join(temporary, 'prepare-run.json'), JSON.stringify(record, null, 2) + '\n');
  if (p.error) throw p.error;
  if (p.status !== 0 || p.signal) throw Error('BROKER_AUTHORITY_DESKTOP_BUILD_FAILED: ' + (p.stderr || p.stdout));
  let previous;
  if (existsSync(output)) { previous = temporary + '-previous'; renameSync(output, previous); }
  try { renameSync(temporary, output); }
  catch (raw) { if (previous) renameSync(previous, output); throw raw; }
  if (previous) rmSync(previous, { recursive: true });
  console.log(JSON.stringify({ ...record, temporary: undefined, output, native: plan.native, installed: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
