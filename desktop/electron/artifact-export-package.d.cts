declare const artifactExportPackage: {
  installArtifactExportPackage(repoRoot: string, target: string, resourcesRoot: string): {executable: string};
  resolveInstalledArtifactExportHelper(resourcesRoot: string, platform: string, arch: string): string;
  resolveDevelopmentArtifactExportHelper(repoRoot: string, platform: string, arch: string): string;
};
export = artifactExportPackage;
