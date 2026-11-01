import type { ArtifactSummary, TaskResult } from '../../../shared/task-types';
import { fileBasename, filePathIdentity, normalizeClipboardFilePath } from './file-path';

interface GeneratedFile { filePath: string; name: string }

function identity(value: string): string {
  return filePathIdentity(normalizeClipboardFilePath(value));
}

function finalReferences(text: string): Set<string> {
  // Code examples are execution details, not links to the delivered files.
  const prose = text.replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, '\n');
  const refs = new Set<string>();
  for (const match of prose.matchAll(/`([^`\n]+)`|\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s]+?))(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
    refs.add(identity(match[1] ?? match[2] ?? match[3]));
  }
  for (const match of prose.matchAll(/(?:^|[\s(])((?:file:\/\/|[A-Za-z]:[\\/]|\\\\|\/)[^\s`<>"']+)/g)) {
    refs.add(identity(match[1].replace(/[),;.!?，。；]+$/, '')));
  }
  return refs;
}

const LEGACY_DOCUMENT = /\.(?:pdf|pptx?|docx?|xlsx?|html?|md|txt|csv|png|jpe?g|gif|webp|svg|mp[34]|wav|zip)$/i;

/** A read-only chat presentation projection; recorded artifact facts stay intact. */
export function projectFinalDeliverables(
  result: TaskResult | null,
  generatedFiles: GeneratedFile[],
  assistantText: string,
  isInlineArtifact: (artifact: ArtifactSummary) => boolean,
) {
  const artifacts = result?.artifacts ?? [];
  const refs = finalReferences(`${result?.summary ?? ''}\n${assistantText}`);
  const pathsByName = new Map<string, Set<string>>();
  for (const file of [...artifacts, ...generatedFiles]) {
    if (!file.filePath) continue;
    const path = identity(file.filePath);
    const name = fileBasename(path);
    const paths = pathsByName.get(name) ?? new Set<string>();
    paths.add(path);
    pathsByName.set(name, paths);
  }
  const referenced = (filePath: string) => {
    const path = identity(filePath);
    if (refs.has(path)) return true;
    const name = fileBasename(path);
    const windows = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
    return pathsByName.get(name)?.size === 1
      && (refs.has(name) || (windows && [...refs].some(ref => ref.toLowerCase() === name)));
  };
  const visibleArtifact = (artifact: ArtifactSummary) => {
    if (isInlineArtifact(artifact)) return true;
    if (!artifact.filePath) return true;
    if (artifact.creator && !/^(?:agent|tool:(?:write|edit))$/i.test(artifact.creator)) return true;
    if (!artifact.creator && LEGACY_DOCUMENT.test(artifact.filePath)) return true;
    return referenced(artifact.filePath);
  };
  return {
    result: result ? { ...result, artifacts: artifacts.filter(visibleArtifact) } : null,
    generatedFiles: generatedFiles.filter(file => referenced(file.filePath)),
  };
}
