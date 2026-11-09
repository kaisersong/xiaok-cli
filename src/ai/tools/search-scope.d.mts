export interface SearchScope { allowedPaths: readonly string[]; deniedPaths: readonly string[] }
export function inside(path: string, root: string): boolean;
export function permitsSearchPath(path: string, scope?: SearchScope): boolean;
export function validateScopedPatterns(patterns: string | string[], scope?: SearchScope): void;
