export function buildExternalDocsTarget(repoName) {
    return `../mydocs/${repoName}`;
}
export function collectForbiddenDocsPaths(paths) {
    return paths
        .map((entry) => entry.replaceAll('\\', '/'))
        .filter((entry) => entry.startsWith('docs/'));
}
