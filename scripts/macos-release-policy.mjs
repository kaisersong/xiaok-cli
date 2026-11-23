import {lstatSync, readFileSync, writeFileSync} from 'node:fs';

export function withMacOSMinimumRelease(source) {
  const pattern = /^minimumSystemVersion:[^\r\n]*(?:\r?\n|$)/gm;
  const entries = [...source.matchAll(pattern)];
  if (entries.length > 1) throw Error('macos_release_minimum_duplicate');
  const policy = 'minimumSystemVersion: 22.6.0\n';
  return entries.length ? source.replace(pattern, policy) : source + (source.endsWith('\n') ? '' : '\n') + policy;
}

export function applyMacOSMinimumRelease(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('macos_release_manifest_unconfirmed');
  const source = readFileSync(file, 'utf8');
  const result = withMacOSMinimumRelease(source);
  if (source !== result) writeFileSync(file, result);
}
