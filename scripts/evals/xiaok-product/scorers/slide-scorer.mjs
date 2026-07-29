import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { selectArtifacts } from './select-artifact.mjs';

const BINARY_EXTENSIONS = new Set(['.pptx', '.pdf', '.key']);
const DEFAULT_SLIDE_COUNT_REGEX = '<section[\\s>]';

/**
 * Structural slide scorer. Text-based decks (html/json manifests) are scored
 * by slide-marker count; binary decks (.pptx etc.) by existence + minimum
 * size, since parsing them is out of MVP scope.
 */
export function scoreSlide({
  task,
  signals,
  fileExists = existsSync,
  readTextFile = path => readFileSync(path, 'utf8'),
  fileSizeBytes = path => statSync(path).size,
}) {
  const reasons = [];
  const structure = task.expectations?.structure ?? {};
  const candidates = selectArtifacts(signals, task.expectations?.artifactMatch);
  const existing = candidates.find(artifact => fileExists(artifact.filePath));

  if (!existing) {
    reasons.push(candidates.length === 0
      ? 'artifact-missing: no artifact matched kind/extension'
      : 'artifact-missing: matched artifact file does not exist on disk');
    return Object.freeze({ passed: false, artifactPath: null, reasons });
  }

  const ext = extname(existing.filePath).toLowerCase();
  const isBinary = existing.kind === 'pptx' || BINARY_EXTENSIONS.has(ext);

  if (isBinary) {
    const minBytes = Number.isSafeInteger(structure.minBytes) ? structure.minBytes : 1;
    let size = 0;
    try {
      size = fileSizeBytes(existing.filePath);
    } catch {
      reasons.push('artifact-unreadable');
    }
    if (reasons.length === 0 && size < minBytes) {
      reasons.push(`bytes: ${size} < ${minBytes}`);
    }
    return Object.freeze({
      passed: reasons.length === 0,
      artifactPath: existing.filePath,
      checks: { bytes: size },
      reasons,
    });
  }

  let content;
  try {
    content = readTextFile(existing.filePath);
  } catch {
    reasons.push('artifact-unreadable');
    return Object.freeze({ passed: false, artifactPath: existing.filePath, reasons });
  }
  const pattern = typeof structure.slideCountRegex === 'string'
    ? structure.slideCountRegex
    : DEFAULT_SLIDE_COUNT_REGEX;
  const slideCount = (content.match(new RegExp(pattern, 'gi')) ?? []).length;
  if (Number.isSafeInteger(structure.minSlides) && slideCount < structure.minSlides) {
    reasons.push(`slides: ${slideCount} < ${structure.minSlides}`);
  }
  return Object.freeze({
    passed: reasons.length === 0,
    artifactPath: existing.filePath,
    checks: { slideCount },
    reasons,
  });
}
