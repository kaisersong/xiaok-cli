import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import { builtinModules, createRequire, isBuiltin } from 'node:module';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SUPPORTED_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.json', '.node'];
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.startsWith('node:') ? name : `node:${name}`),
]);

function fail(code, details = '') {
  throw new Error(details ? `${code}: ${details}` : code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function within(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

function astLocation(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${start.line + 1}:${start.character + 1}`;
}

function literalValue(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function collectConstStrings(sourceFile) {
  const values = new Map();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      const value = literalValue(node.initializer);
      if (value !== null) {
        values.set(node.name.text, value);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return values;
}

function collectCreateRequireNames(sourceFile) {
  const names = new Set();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'createRequire'
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function collectRequireAliasNames(sourceFile) {
  const names = new Set(['require']);
  function containsNodeRequire(node) {
    if (ts.isIdentifier(node)) return names.has(node.text);
    if (ts.isParenthesizedExpression(node)) {
      return containsNodeRequire(node.expression);
    }
    if (ts.isConditionalExpression(node)) {
      return (
        containsNodeRequire(node.whenTrue)
        || containsNodeRequire(node.whenFalse)
      );
    }
    return false;
  }
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && containsNodeRequire(node.initializer)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

export async function inspectModuleEdges(importerPath) {
  const sourceBytes = await readFile(importerPath);
  const sourceText = sourceBytes.toString('utf8');
  if (
    /\bregisterHooks\s*\(/u.test(sourceText)
    || /\brequire\.extensions\b/u.test(sourceText)
    || /\bModule\._(?:load|resolveFilename)\b/u.test(sourceText)
  ) {
    fail('KIMI_D9_UNKNOWN_LOADER_HOOK', importerPath);
  }
  if (/\bprocess\.dlopen\s*\(/u.test(sourceText)) {
    fail('KIMI_D9_DLOPEN_NOT_ALLOWED', importerPath);
  }
  const scriptKind = importerPath.endsWith('.cjs')
    ? ts.ScriptKind.JS
    : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(
    importerPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const importerSha256 = sha256(sourceBytes);
  const constStrings = collectConstStrings(sourceFile);
  const createRequireNames = collectCreateRequireNames(sourceFile);
  const requireAliasNames = collectRequireAliasNames(sourceFile);
  const edges = [];

  function isNodeRequireShadowed(node) {
    let current = node.parent;
    while (current && current !== sourceFile) {
      if (
        ts.isFunctionLike(current)
        && current.parameters.some((parameter) =>
          ts.isIdentifier(parameter.name) && parameter.name.text === 'require')
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function isGuardedByTryCatch(node) {
    let current = node;
    while (current.parent && current.parent !== sourceFile) {
      if (
        ts.isTryStatement(current.parent)
        && current.parent.tryBlock === current
        && current.parent.catchClause
      ) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function addEdge(kind, argument, node) {
    const specifier = literalValue(argument);
    if (specifier !== null) {
      edges.push({
        kind,
        specifier,
        computed: false,
        optional: isGuardedByTryCatch(node),
        importerSha256,
        astLocation: astLocation(sourceFile, node),
      });
      return;
    }
    const runtimeTarget = ts.isIdentifier(argument)
      ? constStrings.get(argument.text)
      : undefined;
    edges.push({
      kind,
      computed: true,
      optional: isGuardedByTryCatch(node),
      importerSha256,
      astLocation: astLocation(sourceFile, node),
      pattern: node.getText(sourceFile),
      runtimeTargets: runtimeTarget === undefined ? null : [runtimeTarget],
    });
  }

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      edges.push({
        kind: ts.isImportDeclaration(node) ? 'import' : 'export',
        specifier: node.moduleSpecifier.text,
        computed: false,
        importerSha256,
        astLocation: astLocation(sourceFile, node),
      });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword) {
        addEdge('dynamic-import', node.arguments[0], node);
      } else if (
        ts.isIdentifier(expression)
        && requireAliasNames.has(expression.text)
        && (
          expression.text !== 'require'
          || !isNodeRequireShadowed(node)
        )
      ) {
        addEdge('require', node.arguments[0], node);
      } else if (ts.isIdentifier(expression) && createRequireNames.has(expression.text)) {
        addEdge('create-require', node.arguments[0], node);
      } else if (
        ts.isPropertyAccessExpression(expression)
        && expression.name.text === 'resolve'
        && ts.isIdentifier(expression.expression)
      ) {
        if (
          requireAliasNames.has(expression.expression.text)
          && (
            expression.expression.text !== 'require'
            || !isNodeRequireShadowed(node)
          )
        ) {
          addEdge('require-resolve', node.arguments[0], node);
        } else if (createRequireNames.has(expression.expression.text)) {
          addEdge('create-require-resolve', node.arguments[0], node);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return edges;
}

async function resolveFileCandidate(candidate) {
  for (const extension of SUPPORTED_EXTENSIONS) {
    const path = `${candidate}${extension}`;
    const metadata = await stat(path).catch(() => null);
    if (metadata?.isFile()) {
      return path;
    }
  }
  const directory = await stat(candidate).catch(() => null);
  if (directory?.isDirectory()) {
    const packageJsonPath = resolve(candidate, 'package.json');
    const packageJson = await readFile(packageJsonPath, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    const entry = packageJson?.exports && typeof packageJson.exports === 'string'
      ? packageJson.exports
      : packageJson?.main ?? 'index.js';
    return resolveFileCandidate(resolve(candidate, entry));
  }
  return null;
}

function parsePackageSpecifier(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    return {
      packageName: parts.slice(0, 2).join('/'),
      subpath: parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.',
    };
  }
  return {
    packageName: parts[0],
    subpath: parts.length > 1 ? `./${parts.slice(1).join('/')}` : '.',
  };
}

async function findPackageRoot(packageName, importerPath, closureRoot) {
  let current = dirname(importerPath);
  while (within(closureRoot, current)) {
    const candidate = resolve(current, 'node_modules', packageName);
    const packageJson = await stat(resolve(candidate, 'package.json')).catch(() => null);
    if (packageJson?.isFile()) {
      return candidate;
    }
    if (current === closureRoot) {
      break;
    }
    current = dirname(current);
  }
  return null;
}

async function findPackageScope(importerPath, closureRoot) {
  let current = dirname(importerPath);
  while (within(closureRoot, current)) {
    const packageJsonPath = resolve(current, 'package.json');
    const packageJsonMetadata = await stat(packageJsonPath).catch(() => null);
    if (packageJsonMetadata?.isFile()) {
      return {
        root: current,
        packageJson: JSON.parse(await readFile(packageJsonPath, 'utf8')),
      };
    }
    if (current === closureRoot) {
      break;
    }
    current = dirname(current);
  }
  return null;
}

function selectConditionalTarget(value, conditions, subpath) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const selected = selectConditionalTarget(candidate, conditions, subpath);
      if (selected) {
        return selected;
      }
    }
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const keys = Object.keys(value);
  const isSubpathMap = keys.some((key) => key.startsWith('.'));
  if (isSubpathMap) {
    if (Object.hasOwn(value, subpath)) {
      return selectConditionalTarget(value[subpath], conditions, subpath);
    }
    const patterns = keys
      .filter(key => key.startsWith('.') && key.includes('*'))
      .sort((left, right) => right.length - left.length);
    for (const pattern of patterns) {
      const wildcardIndex = pattern.indexOf('*');
      const prefix = pattern.slice(0, wildcardIndex);
      const suffix = pattern.slice(wildcardIndex + 1);
      if (
        !subpath.startsWith(prefix)
        || !subpath.endsWith(suffix)
        || subpath.length < prefix.length + suffix.length
      ) {
        continue;
      }
      const wildcard = subpath.slice(
        prefix.length,
        subpath.length - suffix.length,
      );
      const selected = selectConditionalTarget(
        value[pattern],
        conditions,
        subpath,
      );
      if (selected) {
        return selected.replaceAll('*', wildcard);
      }
    }
    return null;
  }
  for (const [condition, target] of Object.entries(value)) {
    if (condition === 'default' || conditions.has(condition)) {
      const selected = selectConditionalTarget(target, conditions, subpath);
      if (selected) {
        return selected;
      }
    }
  }
  return null;
}

async function resolveBarePackage(specifier, importerPath, closureRoot, edgeKind) {
  const { packageName, subpath } = parsePackageSpecifier(specifier);
  const packageRoot = await findPackageRoot(packageName, importerPath, closureRoot);
  if (!packageRoot) {
    return null;
  }
  const packageJson = JSON.parse(
    await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
  );
  if (packageJson.exports !== undefined) {
    const esm = ['import', 'export', 'dynamic-import'].includes(edgeKind);
    const conditions = new Set(['node', esm ? 'import' : 'require', 'default']);
    const target = selectConditionalTarget(packageJson.exports, conditions, subpath);
    if (!target || !target.startsWith('./')) {
      fail('KIMI_D9_PACKAGE_EXPORTS_UNRESOLVED', specifier);
    }
    return resolveFileCandidate(resolve(packageRoot, target));
  }
  if (subpath !== '.') {
    return resolveFileCandidate(resolve(packageRoot, subpath.slice(2)));
  }
  return resolveFileCandidate(resolve(packageRoot, packageJson.main ?? 'index.js'));
}

async function resolvePackageImport(specifier, importerPath, closureRoot, edgeKind) {
  const scope = await findPackageScope(importerPath, closureRoot);
  const mapping = scope?.packageJson?.imports?.[specifier];
  if (mapping === undefined) {
    fail('KIMI_D9_PACKAGE_IMPORTS_UNRESOLVED', specifier);
  }
  const esm = ['import', 'export', 'dynamic-import'].includes(edgeKind);
  const target = selectConditionalTarget(
    mapping,
    new Set(['node', esm ? 'import' : 'require', 'default']),
    specifier,
  );
  if (!target || !target.startsWith('./')) {
    fail('KIMI_D9_PACKAGE_IMPORTS_UNRESOLVED', specifier);
  }
  const resolvedTarget = await resolveFileCandidate(resolve(scope.root, target));
  if (!resolvedTarget) {
    fail('KIMI_D9_MISSING_MODULE', target);
  }
  return resolvedTarget;
}

async function resolveSpecifier(specifier, importerPath, closureRoot, edgeKind) {
  if (isBuiltin(specifier) || BUILTINS.has(specifier)) {
    return { builtin: true, resolvedPath: specifier };
  }
  try {
    if (specifier.startsWith('file:')) {
      return { builtin: false, resolvedPath: fileURLToPath(specifier) };
    }
    if (isAbsolute(specifier)) {
      return { builtin: false, resolvedPath: specifier };
    }
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const candidate = await resolveFileCandidate(resolve(dirname(importerPath), specifier));
      if (!candidate) {
        fail('KIMI_D9_MISSING_MODULE', specifier);
      }
      return { builtin: false, resolvedPath: candidate };
    }
    if (specifier.startsWith('#')) {
      return {
        builtin: false,
        resolvedPath: await resolvePackageImport(
          specifier,
          importerPath,
          closureRoot,
          edgeKind,
        ),
      };
    }
    const packageTarget = await resolveBarePackage(
      specifier,
      importerPath,
      closureRoot,
      edgeKind,
    );
    if (packageTarget) {
      return { builtin: false, resolvedPath: packageTarget };
    }
    const resolver = createRequire(pathToFileURL(importerPath));
    return { builtin: false, resolvedPath: resolver.resolve(specifier) };
  } catch (error) {
    if (String(error?.message ?? error).includes('KIMI_D9_')) {
      throw error;
    }
    fail('KIMI_D9_MISSING_MODULE', `${specifier} from ${importerPath}`);
  }
}

function findComputedAllowlist(edge, allowlist) {
  return allowlist.find((candidate) =>
    candidate.importerSha256 === edge.importerSha256
    && candidate.astLocation === edge.astLocation
    && candidate.pattern === edge.pattern);
}

function sameTargets(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function buildReachableResolutionGraph(input) {
  const closureRoot = await realpath(resolve(input.closureRoot)).catch(() =>
    fail('KIMI_D9_CLOSURE_MISSING'));
  const entryPath = resolve(closureRoot, input.entryRelativePath ?? 'dist/index.js');
  const entryRealpath = await realpath(entryPath).catch(() =>
    fail('KIMI_D9_MISSING_MODULE', entryPath));
  if (!within(closureRoot, entryRealpath)) {
    fail('KIMI_D9_RESOLUTION_ESCAPE', entryRealpath);
  }

  const queue = [entryRealpath];
  const visited = new Set();
  const edges = [];
  while (queue.length > 0) {
    const importer = queue.shift();
    if (visited.has(importer)) {
      continue;
    }
    visited.add(importer);
    if (['.json', '.node'].includes(extname(importer))) {
      continue;
    }
    for (const edge of await inspectModuleEdges(importer)) {
      const specifiers = [];
      if (edge.computed) {
        const allowed = findComputedAllowlist(
          edge,
          input.computedEdgeAllowlist ?? [],
        );
        if (!allowed || !Array.isArray(allowed.targets) || allowed.targets.length === 0) {
          fail(
            'KIMI_D9_COMPUTED_EDGE_NOT_ALLOWED',
            `${importer} ${edge.astLocation} ${edge.pattern}`,
          );
        }
        if (
          edge.runtimeTargets
          && !sameTargets(edge.runtimeTargets, allowed.targets)
        ) {
          fail('KIMI_D9_COMPUTED_EDGE_RUNTIME_TARGET_MISMATCH', edge.pattern);
        }
        specifiers.push(...allowed.targets);
      } else {
        specifiers.push(edge.specifier);
      }

      for (const specifier of specifiers) {
        let resolution;
        try {
          resolution = await resolveSpecifier(
            specifier,
            importer,
            closureRoot,
            edge.kind,
          );
        } catch (error) {
          if (
            edge.optional
            && String(error?.message ?? error)
              .startsWith('KIMI_D9_MISSING_MODULE:')
          ) {
            edges.push({
              ...edge,
              specifier,
              importerRelativePath: toPosix(
                relative(closureRoot, importer),
              ),
              builtin: false,
              optionalMissing: true,
            });
            continue;
          }
          throw error;
        }
        if (resolution.builtin) {
          edges.push({
            ...edge,
            specifier,
            importerRelativePath: toPosix(relative(closureRoot, importer)),
            builtin: true,
            resolved: resolution.resolvedPath,
          });
          continue;
        }
        const resolvedRealpath = await realpath(resolution.resolvedPath).catch(() =>
          fail('KIMI_D9_MISSING_MODULE', resolution.resolvedPath));
        if (!within(closureRoot, resolvedRealpath)) {
          fail('KIMI_D9_RESOLUTION_ESCAPE', resolvedRealpath);
        }
        const metadata = await lstat(resolution.resolvedPath);
        if (metadata.isSymbolicLink() && !within(closureRoot, resolvedRealpath)) {
          fail('KIMI_D9_RESOLUTION_ESCAPE', resolution.resolvedPath);
        }
        edges.push({
          ...edge,
          specifier,
          importerRelativePath: toPosix(relative(closureRoot, importer)),
          builtin: false,
          resolvedRelativePath: toPosix(relative(closureRoot, resolvedRealpath)),
        });
        if (!visited.has(resolvedRealpath)) {
          queue.push(resolvedRealpath);
        }
      }
    }
  }

  return {
    entryRelativePath: toPosix(relative(closureRoot, entryRealpath)),
    modules: [...visited].map((path) => toPosix(relative(closureRoot, path))).sort(),
    edges: edges.sort((left, right) =>
      `${left.importerRelativePath}:${left.astLocation}:${left.specifier}`
        .localeCompare(`${right.importerRelativePath}:${right.astLocation}:${right.specifier}`)),
  };
}
