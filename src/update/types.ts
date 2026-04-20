export type InstallSource =
  | { kind: 'git_repo'; repoRoot: string; binPath: string }
  | { kind: 'npm_link'; repoRoot: string; binPath: string }
  | { kind: 'npm_global'; packageRoot: string; binPath: string }
  | { kind: 'unsupported'; reason: string; binPath: string };

export interface DetectInstallSourceDeps {
  argv0: string;
  cwd: string;
  realpath(path: string): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  npmRootGlobal(): Promise<string>;
}
