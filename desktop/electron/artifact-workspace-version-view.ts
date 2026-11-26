import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { ArtifactLineage, ArtifactWorkspacePreview, ArtifactWorkspaceVersion, ArtifactWorkspaceVersionView } from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceError } from '../shared/artifact-workspace-types.js';
import { ArtifactWorkspaceFileManager } from './artifact-workspace-files.js';

export function toVersionView(fileManager: ArtifactWorkspaceFileManager, version: ArtifactWorkspaceVersion, lineages: ArtifactLineage[]): ArtifactWorkspaceVersionView {
  const { fileRef: _fileRef, entryRef: _entryRef, packageManifestRef: _manifestRef, ...safe } = version;
  const available = version.status === 'ready' && fileManager.verifyManagedArtifact(version, 'stat');
  return {
    ...safe,
    status: available ? version.status : 'missing',
    preferred: lineages.some((lineage) => lineage.id === version.lineageId && lineage.preferredVersionId === version.id),
    preview: {
      available,
      title: basename(version.entryRef ?? version.fileRef),
      contentKind: version.storageKind === 'sealed_package' ? 'package_manifest' : version.kind === 'image' ? 'data_url' : 'text',
    },
  };
}

export function readVersionPreview(fileManager: ArtifactWorkspaceFileManager, version: ArtifactWorkspaceVersion): ArtifactWorkspacePreview {
  if (version.status !== 'ready') throw new ArtifactWorkspaceError('artifact_missing', 'artifact version is missing');
  const path = fileManager.resolveManagedRef(version.fileRef);
  if (!fileManager.verifyManagedArtifact(version, 'stat')) throw new ArtifactWorkspaceError('artifact_missing', 'artifact bytes are missing');
  const title = basename(version.entryRef ?? version.fileRef);
  if (version.storageKind === 'sealed_package') {
    const manifestPath = fileManager.resolveManagedRef(`${version.fileRef}/${version.packageManifestRef}`);
    return {
      versionId: version.id,
      kind: version.kind,
      mimeType: version.mimeType,
      title,
      contentKind: 'package_manifest',
      content: { entryRef: version.entryRef ?? '', files: JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? [] },
    };
  }
  const bytes = readFileSync(path);
  if (version.kind === 'image') {
    return {
      versionId: version.id, kind: version.kind, mimeType: version.mimeType, title,
      contentKind: 'data_url', content: `data:${version.mimeType ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`,
    };
  }
  return {
    versionId: version.id, kind: version.kind, mimeType: version.mimeType, title,
    contentKind: 'text', content: bytes.toString('utf8'),
  };
}
