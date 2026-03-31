export function buildExternalDocsTarget(repoName: string): string {
  return `../mydocs/${repoName}`;
}

export function collectForbiddenDocsPaths(paths: string[]): string[] {
  return paths
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter((entry) => entry.startsWith('docs/'));
}
