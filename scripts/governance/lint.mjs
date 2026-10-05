import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeBaseline, compareBaseline, requireMatchingMetadata } from './baseline.mjs';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LINT_FLAGS = ['--disable-nested-config', '--no-ignore', '--ignore-pattern', '**/node_modules/**', '--ignore-pattern', '**/dist/**', '--ignore-pattern', '**/.generated/**'];
export const LINT_PATHS = ['src', 'desktop/electron', 'desktop/shared', 'desktop/renderer/src', 'scripts'];
export function lintMetadata(paths = LINT_PATHS, configPath = resolve(projectRoot, '.oxlintrc.json')) {
    return { tool: 'oxlint', version: JSON.parse(readFileSync(resolve(projectRoot, 'node_modules/oxlint/package.json'), 'utf8')).version, flags: LINT_FLAGS, configHash: createHash('sha256').update(readFileSync(configPath)).digest('hex'), paths };
}
export function lintDiagnostics(report, root, sourceLines) {
    if (!Array.isArray(report.diagnostics) || !report.number_of_files)
        throw new Error('Invalid/empty lint report');
    return report.diagnostics.map(d => {
        if (!d.code?.startsWith('eslint(') || !d.filename || !d.labels?.[0]?.span?.line)
            throw new Error('Lint parse/syntax or tool diagnostic: ' + d.message);
        const path = relative(root, resolve(root, d.filename)).replaceAll('\\', '/');
        const line = d.labels[0].span.line;
        const lines = sourceLines?.[d.filename] ?? readFileSync(resolve(root, d.filename), 'utf8').split(/\r?\n/);
        return { path, rule: d.code, message: d.message, source: lines[line - 1], line };
    });
}
export function checkLint({ root = projectRoot, paths = LINT_PATHS, baseline, configPath = resolve(projectRoot, '.oxlintrc.json') } = {}) {
    for (const p of paths)
        if (!existsSync(resolve(root, p)))
            throw new Error('Missing lint source root: ' + p);
    const metadata = lintMetadata(paths, configPath);
    requireMatchingMetadata(baseline, metadata);
    const result = spawnSync(process.execPath, [resolve(projectRoot, 'node_modules/oxlint/bin/oxlint'), '--config', configPath, '--format', 'json', ...LINT_FLAGS, ...paths], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (result.error || result.signal || ![0, 1].includes(result.status))
        throw new Error('Oxlint execution failed: ' + (result.error?.message ?? result.stderr));
    let report;
    try {
        report = JSON.parse(result.stdout);
    }
    catch {
        throw new Error('Invalid Oxlint JSON output: ' + result.stderr);
    }
    const diagnostics = lintDiagnostics(report, root);
    if (result.status !== 0 && diagnostics.length === 0)
        throw new Error('Oxlint failed without diagnostics');
    return { metadata, diagnostics, newDiagnostics: compareBaseline(diagnostics, baseline ?? makeBaseline([])), files: report.number_of_files };
}
