import type { TestProject } from 'vitest/node';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import setupAccounts from '../../tests/support/profile-account.global.mjs';
import { selectRecipeManifestPath } from '../../src/runtime/sol-pi/recipe-environment-registration.js';

export default function setup(project: TestProject) {
  const root = join(homedir(), '.cache', 'xiaok', 'sol-pi', 'deepseek-recipe-0.1.1');
  if (process.platform !== 'darwin' || process.arch !== 'arm64'
    || !existsSync(selectRecipeManifestPath(root)) || !existsSync(join(root, 'environment.json'))) {
    throw Error('qualified_recipe_runtime_required: no registered machine-bound runtime; no integration cases were validated');
  }
  project.provide('nativeObservationAccountMode', 'real-native-readonly');
  return setupAccounts(project);
}
