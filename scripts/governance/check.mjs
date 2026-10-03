#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkLint } from './lint.mjs';
import { checkArchitecture } from './architecture.mjs';
import { makeBaseline } from './baseline.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function changedFiles(base, repoRoot = root) { const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean); return [...new Set([...git(['diff', '--no-renames', '--name-only', '-z', base ?? 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard', '-z'])])]; }
export function main(argv = process.argv.slice(2)) {
const [kind, ...args] = argv;
try {
    if (!['lint', 'architecture'].includes(kind) || args.some(a => !['--changed', '--update-baseline'].includes(a) && !a.startsWith('--base=')))
        throw new Error('Usage: check.mjs lint|architecture [--changed] [--base=<git-ref>] [--update-baseline]');
    if ((kind === 'lint' && args.some(a => a === '--changed' || a.startsWith('--base='))) || (args.some(a => a.startsWith('--base=')) && !args.includes('--changed'))) throw new Error('Changed/base options require architecture --changed');
    if (args.includes('--changed') && args.includes('--update-baseline'))
        throw new Error('Baseline refresh requires full scan');
    const path = resolve(root, kind === 'lint' ? '.lint-baseline.json' : '.architecture-baseline.json');
    const update = args.includes('--update-baseline');
    const baseline = update ? undefined : JSON.parse(readFileSync(path, 'utf8'));
    const result = kind === 'lint' ? checkLint({ root, baseline }) : checkArchitecture({ root, policy: JSON.parse(readFileSync(resolve(root, 'architecture-policy.json'), 'utf8')), baseline, changedFiles: args.includes('--changed') ? changedFiles(args.find(a => a.startsWith('--base='))?.slice(7)) : undefined });
    if (update) {
        writeFileSync(path, JSON.stringify(makeBaseline(result.diagnostics, result.metadata), null, 2) + '\n');
        console.log(`[${kind}] baseline explicitly refreshed; review ${path}`);
    }
    else {
        console.log(`[${kind}] scanned ${typeof result.files === 'number' ? result.files : result.checkedFiles.length} files; ${result.diagnostics.length} current, ${result.newDiagnostics.length} new violations`);
        for (const d of result.newDiagnostics)
            console.error(`${d.path}:${d.line} ${d.rule}: ${d.message}`);
        process.exitCode = result.newDiagnostics.length ? 1 : 0;
    }
}
catch (error) {
    console.error(`[governance] ${error.message}`);
    process.exitCode = 1;
}

}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
