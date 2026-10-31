import { inject } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { selectRecipeManifestPath } from '../../../src/runtime/sol-pi/recipe-environment-registration.js';

/** Availability only. Existing-but-invalid manifests must reach production and fail. */
export function recipeRuntimeUnavailable(): boolean {
  if (inject('nativeObservationAccountMode') === 'real-native-readonly') return false;
  const root = join(homedir(), '.cache', 'xiaok', 'sol-pi', 'deepseek-recipe-0.1.1');
  const unavailable = process.platform !== 'darwin' || process.arch !== 'arm64'
    || !existsSync(selectRecipeManifestPath(root));
  if (unavailable) console.info('[qualified-recipe] unavailable registered machine-bound runtime; run npm run test:qualified-runtime on a qualified host. Integration behavior is NOT verified.');
  return unavailable;
}
