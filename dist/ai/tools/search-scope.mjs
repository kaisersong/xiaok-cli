import { lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const normalized = path => process.platform === 'win32' ? path.toLowerCase() : path;
export function inside(path, root) {
  const rel = relative(normalized(root), normalized(path));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
/** Invoked before enumeration metadata as well as before file reads. Never follows links. */
export function permitsSearchPath(path, scope) {
  if (!scope) return true;
  const full = resolve(path);
  if (scope.deniedPaths.some(root => inside(full, root))) return false;
  if (scope.allowedPaths.length && !scope.allowedPaths.some(root => inside(full, root))) return false;
  // Ancestors are checked in order: never lstat a path through an untrusted symlink.
  const anchor = scope.allowedPaths.filter(root => inside(full, root)).sort((a, b) => b.length - a.length)[0];
  const parts = [];
  let current = full;
  while (true) {
    parts.unshift(current);
    if (anchor && normalized(current) === normalized(anchor)) break;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  for (const part of parts) {
    try { if (lstatSync(part).isSymbolicLink() || normalized(realpathSync(part))!==normalized(part)) return false; }
    catch { return false; }
  }
  return true;
}
export function validateScopedPatterns(patterns, scope) {
  if (!scope) return;
  for (const pattern of typeof patterns === 'string' ? [patterns] : patterns) {
    // Brace/extglob expansion cannot smuggle a parent segment or another root.
    if (isAbsolute(pattern) || /(?:^|[({,|])(?:[A-Za-z]:|[\\/])/.test(pattern)
      || pattern.split(/[\\/{}(),!|]/).includes('..')) throw new Error('search_scope_invalid_pattern');
  }
}
