export interface BuildMetadata {
  version: string | null;
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
  sourceDate: string | null;
  builtAt: string | null;
  buildType: 'normal' | 'release' | 'rollback' | null;
  node: string | null;
  platform: string | null;
  arch: string | null;
}
