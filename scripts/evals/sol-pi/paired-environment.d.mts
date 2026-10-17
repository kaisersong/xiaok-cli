/** Public data declaration only; no native/SDK qualification is asserted here. */
export const recipeManifestSemanticSha256: 'a0e31c572efb0fbf2723ac56a6c65caf22efd931ac60458a7d38c1e255b21417';
export const recipeManifestFileSha256: '50117314e0001bac768e500792d951f9b80fef8b97204a7dc6cd857a9a2713dd';
export interface RecipeEnvironmentIdentity {
  environmentPath: string;
  manifestPath: string;
  environmentSha256: string;
  manifestFileSha256: string;
  manifestSemanticSha256: string;
}
export interface RecipeEnvironmentVerificationOptions {
  sourceRoot: string;
  registrationSourceRoot?: string;
  environmentPath: string;
  manifestPath: string;
  expected?: RecipeEnvironmentIdentity;
  loadProduction?: (file: string) => Promise<unknown>;
  capacityIdentity?: Record<string, unknown>;
  manifestSnapshotPath?: string;
}
export interface RecipeEnvironmentVerificationResult {
  identity: RecipeEnvironmentIdentity;
  environment: unknown;
  environmentManifest: unknown;
  /** Dynamic factory output is not a declaration-issued counter capability. */
  counter: unknown;
}
export function selectRegisteredRecipeManifest(options: {
  sourceRoot: string;
  environmentRoot: string;
}): Promise<string>;
export function verifyRecipeEnvironment(options: RecipeEnvironmentVerificationOptions): Promise<RecipeEnvironmentVerificationResult>;
