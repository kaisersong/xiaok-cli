import { rmSync } from 'node:fs';
import { isAbsolute, relative, resolve, parse } from 'node:path';

const root = resolve(process.cwd());

if (root === parse(root).root) {
  throw new Error(`Refusing to clean CLI build artifacts from filesystem root: ${root}`);
}

function removeBuildArtifact(relativePath) {
  const target = resolve(root, relativePath);
  const targetRelative = relative(root, target);

  if (!targetRelative || targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
    throw new Error(`Refusing to clean path outside package root: ${target}`);
  }

  rmSync(target, { recursive: true, force: true });
}

removeBuildArtifact('dist');
removeBuildArtifact('.tsbuildinfo');
