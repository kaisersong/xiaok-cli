// Declaration-only candidate, verified against scripts/check-repo-hygiene.js exports.
export interface StatusPorcelainEntry { code: string; path: string; }
export interface RepoHealthResult { ok: boolean; issues: string[]; warnings: string[]; }
export interface RepoHealthInput {
  repoRoot: string; branch: string; ahead: number; behind: number;
  entries: StatusPorcelainEntry[]; globalXiaokTarget?: string;
  defaultBranch?: string; reference?: string;
}
export interface WorkspaceRepositoryHealth extends RepoHealthResult {
  name: string; repoRoot: string; fetchSucceeded: boolean | null; freshnessVerified: boolean;
  branch?: string; defaultBranch?: string; reference?: string; ahead?: number; behind?: number;
  upstream?: { reference: string; ahead: number; behind: number };
}
export interface WorkspaceHealthResult { ok: boolean; freshnessVerified: boolean; repositories: WorkspaceRepositoryHealth[]; }
export function parseStatusPorcelain(output: string): StatusPorcelainEntry[];
export function evaluateRepoHealth(input: RepoHealthInput): RepoHealthResult;
export function collectWorkspaceHealth(options?: { cwd?: string; fetch?: boolean; globalXiaokTarget?: string }): WorkspaceHealthResult;
export function main(args?: string[]): WorkspaceHealthResult;
