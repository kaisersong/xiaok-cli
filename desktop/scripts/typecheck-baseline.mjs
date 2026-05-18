import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const baselinePath = join(desktopRoot, 'typecheck-baseline.json');
const update = process.argv.includes('--update');

const commands = [
  {
    id: 'electron',
    requiredClean: true,
    args: ['-p', 'tsconfig.electron.json', '--noEmit'],
  },
  {
    id: 'renderer',
    requiredClean: false,
    args: ['-p', 'tsconfig.renderer.json', '--noEmit'],
  },
];

const results = commands.map(runTsc);
const electron = results.find((result) => result.id === 'electron');
if (electron && electron.exitCode !== 0) {
  process.stderr.write(electron.output);
  process.stderr.write('\nElectron typecheck must be clean; not covered by renderer baseline.\n');
  process.exit(1);
}

const renderer = results.find((result) => result.id === 'renderer');
const rendererDiagnostics = renderer?.diagnostics ?? [];

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: 'tsc -p tsconfig.renderer.json --noEmit',
    diagnostics: rendererDiagnostics,
  }, null, 2)}\n`, 'utf8');
  console.log(`Updated renderer typecheck baseline: ${relative(process.cwd(), baselinePath)} (${rendererDiagnostics.length} diagnostics)`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`Missing renderer typecheck baseline: ${baselinePath}`);
  console.error('Run: npm --prefix desktop run typecheck:update-baseline');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const known = new Set((baseline.diagnostics ?? []).map((diagnostic) => diagnostic.hash));
const current = new Set(rendererDiagnostics.map((diagnostic) => diagnostic.hash));
const newDiagnostics = rendererDiagnostics.filter((diagnostic) => !known.has(diagnostic.hash));
const resolvedDiagnostics = [...known].filter((hash) => !current.has(hash));

if (newDiagnostics.length > 0) {
  console.error(`Renderer typecheck introduced ${newDiagnostics.length} new diagnostics:`);
  for (const diagnostic of newDiagnostics.slice(0, 25)) {
    console.error(`- ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} TS${diagnostic.code} ${diagnostic.message}`);
  }
  if (newDiagnostics.length > 25) {
    console.error(`... and ${newDiagnostics.length - 25} more`);
  }
  process.exit(1);
}

console.log(`Electron typecheck clean. Renderer baseline gate clean: ${rendererDiagnostics.length} current diagnostics, ${resolvedDiagnostics.length} resolved since baseline.`);

function runTsc(command) {
  const tscPath = join(desktopRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const child = spawnSync(process.execPath, [tscPath, ...command.args], {
    cwd: desktopRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  return {
    id: command.id,
    exitCode: child.status ?? 1,
    output,
    diagnostics: parseDiagnostics(output),
  };
}

function parseDiagnostics(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseDiagnostic)
    .filter(Boolean);
}

function parseDiagnostic(line) {
  const match = line.match(/^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error TS(?<code>\d+): (?<message>.*)$/u);
  if (!match?.groups) return null;
  const diagnostic = {
    file: normalizeFile(match.groups.file),
    line: Number(match.groups.line),
    column: Number(match.groups.column),
    code: match.groups.code,
    message: normalizeMessage(match.groups.message),
  };
  return {
    ...diagnostic,
    hash: hashDiagnostic(diagnostic),
  };
}

function normalizeFile(file) {
  return file.replaceAll('\\', '/').replace(/^.*?renderer\//u, 'renderer/');
}

function normalizeMessage(message) {
  return message.replace(/\s+/gu, ' ').trim();
}

function hashDiagnostic(diagnostic) {
  return createHash('sha256')
    .update(`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:TS${diagnostic.code}:${diagnostic.message}`)
    .digest('hex');
}
