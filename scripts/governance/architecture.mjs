import ts from 'typescript';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { makeBaseline, compareBaseline, requireMatchingMetadata } from './baseline.mjs';
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.mts', '.cts'];
const posix = p => p.replaceAll('\\', '/');
function collect(root, paths) { const files = []; const walk = p => { if (!existsSync(p))
    return; const s = statSync(p); if (s.isDirectory()) {
    for (const name of readdirSync(p).sort())
        if (!['node_modules', 'dist', '.generated'].includes(name))
            walk(resolve(p, name));
}
else if (extensions.includes(extname(p)))
    files.push(posix(relative(root, p))); }; for (const p of paths)
    walk(resolve(root, p)); return files; }
function layer(path, policy) { if (policy.preload.includes(path))
    return 'preload'; if (path.startsWith('desktop/renderer/src/'))
    return 'renderer'; if (path.startsWith('desktop/electron/') || path.startsWith('src/'))
    return 'main'; return 'shared'; }
function imports(source, path) {
    const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ['.tsx', '.jsx'].includes(extname(path)) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (sf.parseDiagnostics.length)
        throw new Error('Architecture syntax error in ' + path);
    const result = [];
    const add = (node, spec, typeOnly = false) => { result.push({ specifier: spec, typeOnly, source: node.getText(sf), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 }); };
    const walk = node => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const typeOnly = !!clause?.isTypeOnly || !!(bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.length && bindings.elements.every(e => e.isTypeOnly));
            add(node, node.moduleSpecifier.text, typeOnly);
        }
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            const typeOnly = node.isTypeOnly || !!(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(e => e.isTypeOnly));
            add(node, node.moduleSpecifier.text, typeOnly);
        }
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
            add(node, node.moduleReference.expression?.text, node.isTypeOnly);
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
            const arg = node.arguments[0];
            add(node, arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null);
        }
        ts.forEachChild(node, walk);
    };
    walk(sf);
    return result;
}
function resolveImport(root, from, spec, policy) {
    if (spec === null)
        return { dynamic: true };
    if (builtinModules.includes(spec.replace(/^node:/, '')) || spec === 'electron')
        return { host: true, external: spec };
    if (/\.(css|scss|sass|less|svg|png|jpe?g|webp|ico|woff2?)(\?.*)?$/.test(spec))
        return { asset: true };
    let target;
    if (spec.startsWith('.'))
        target = resolve(root, dirname(from), spec);
    else
        for (const [alias, values] of Object.entries(policy.aliases ?? {})) {
            const [prefix, suffix = ''] = alias.split('*');
            if (alias.includes('*') ? spec.startsWith(prefix) && spec.endsWith(suffix) : spec === alias) {
                const segment = alias.includes('*') ? spec.slice(prefix.length, suffix ? -suffix.length : undefined) : '';
                target = resolve(root, values[0].replace('*', segment));
                break;
            }
        }
    if (!target)
        return { external: spec };
    const stem = target.replace(/\.(js|jsx|mjs|cjs)$/, '');
    const candidates = [target, ...extensions.map(e => stem + e), ...extensions.map(e => resolve(target, 'index' + e))];
    const found = candidates.find(p => existsSync(p) && statSync(p).isFile());
    const fallback = extname(target) ? stem + '.ts' : target + '.ts';
    return { target: posix(relative(root, found ?? fallback)), unresolved: !found };
}
export function reverseImportClosure(changedFiles, edges) { const selected = new Set(changedFiles.map(posix)); const reverse = new Map(); for (const edge of edges)
    if (edge.target) {
        const callers = reverse.get(edge.target) ?? new Set();
        callers.add(edge.path);
        reverse.set(edge.target, callers);
    } const queue = [...selected]; for (let i = 0; i < queue.length; i++)
    for (const caller of reverse.get(queue[i]) ?? [])
        if (!selected.has(caller)) {
            selected.add(caller);
            queue.push(caller);
        } return selected; }
export function checkArchitecture({ root, policy, baseline, changedFiles } = {}) {
    if (policy?.version !== 1 || !policy.roots?.length || !Array.isArray(policy.preload) || !Array.isArray(policy.publicTypeContracts))
        throw new Error('Invalid architecture policy');
    const metadata = { tool: 'typescript-architecture', version: ts.version, policyHash: createHash('sha256').update(JSON.stringify(policy)).digest('hex') };
    requireMatchingMetadata(baseline, metadata);
    for (const path of policy.roots)
        if (!existsSync(resolve(root, path)) || !statSync(resolve(root, path)).isDirectory())
            throw new Error('Missing architecture source root: ' + path);
    const files = collect(root, policy.roots);
    if (!files.length)
        throw new Error('Empty architecture scan');
    const edges = [];
    for (const path of files)
        for (const item of imports(readFileSync(resolve(root, path), 'utf8'), path))
            edges.push({ path, ...item, ...resolveImport(root, path, item.specifier, policy) });
    const allSelected = changedFiles?.some(p => ['architecture-policy.json', '.architecture-baseline.json', 'scripts/governance/architecture.mjs'].includes(posix(p)));
    const selected = !changedFiles || allSelected ? new Set(files) : reverseImportClosure(changedFiles, edges);
    const outgoing = new Map();
    for (const edge of edges) {
        const list = outgoing.get(edge.path) ?? [];
        list.push(edge);
        outgoing.set(edge.path, list);
    }
    const reachesHost = (start) => { const visited = new Set(); const queue = [start]; for (let i = 0; i < queue.length; i++) {
        if (visited.has(queue[i]))
            continue;
        visited.add(queue[i]);
        for (const e of outgoing.get(queue[i]) ?? []) {
            if (e.typeOnly)
                continue;
            if (e.host || e.dynamic || (e.target && layer(e.target, policy) === 'main'))
                return true;
            if (e.target)
                queue.push(e.target);
        }
    } return false; };
    const reachesRenderer = (start) => { const visited = new Set(); const queue = [start]; for (let i = 0; i < queue.length; i++) {
        if (visited.has(queue[i]))
            continue;
        visited.add(queue[i]);
        for (const e of outgoing.get(queue[i]) ?? []) {
            if (e.target && layer(e.target, policy) === 'renderer')
                return true;
            if (e.target)
                queue.push(e.target);
        }
    } return false; };
    const diagnostics = [];
    for (const e of edges) {
        if (!selected.has(e.path))
            continue;
        const from = layer(e.path, policy), to = e.target ? layer(e.target, policy) : null;
        let rule;
        if (e.unresolved)
            rule = 'unresolved-import';
        else if (e.dynamic && ['renderer', 'preload'].includes(from))
            rule = 'dynamic-import';
        else if (e.host && !e.typeOnly && from === 'renderer')
            rule = 'renderer-host-runtime';
        else if (e.external && !e.typeOnly && from === 'preload' && e.external !== 'electron' && e.external !== 'os' && e.external !== 'node:os')
            rule = 'preload-host-runtime';
        else if (from === 'main' && to === 'renderer')
            rule = 'main-to-renderer';
        else if (from === 'main' && to === 'shared' && reachesRenderer(e.target))
            rule = 'renderer-through-shared';
        else if (['renderer', 'preload'].includes(from) && to && to !== from && to !== 'shared') {
            if (!(e.typeOnly && policy.publicTypeContracts.includes(e.target)))
                rule = 'cross-layer-private-import';
        }
        else if (['renderer', 'preload'].includes(from) && to === 'shared' && !e.typeOnly && reachesHost(e.target))
            rule = 'host-through-shared';
        if (rule)
            diagnostics.push({ path: e.path, rule, source: e.source, message: rule + ': ' + (e.specifier ?? '<dynamic>'), line: e.line });
    }
    return { metadata, files, edges, checkedFiles: [...selected].filter(p => files.includes(p)).sort(), diagnostics, newDiagnostics: compareBaseline(diagnostics, baseline ?? makeBaseline([])) };
}
