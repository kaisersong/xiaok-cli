import { existsSync, readFileSync } from 'node:fs';
import { selectArtifacts } from './select-artifact.mjs';

function countSections(content) {
  const markdownHeadings = content.match(/^#{1,6}\s+\S/gm) ?? [];
  const htmlHeadings = content.match(/<h[1-6][\s>]/gi) ?? [];
  return markdownHeadings.length + htmlHeadings.length;
}

/**
 * Structural report scorer. This measures STRUCTURAL PASS, not delivery
 * quality: thresholds are weak proxies by design (see the design doc §4).
 */
export function scoreReport({
  task,
  signals,
  fileExists = existsSync,
  readTextFile = path => readFileSync(path, 'utf8'),
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

  let content;
  try {
    content = readTextFile(existing.filePath);
  } catch {
    reasons.push('artifact-unreadable');
    return Object.freeze({ passed: false, artifactPath: existing.filePath, reasons });
  }

  const checks = {
    sectionCount: countSections(content),
    chars: content.length,
  };
  if (Number.isSafeInteger(structure.minSections)
    && checks.sectionCount < structure.minSections) {
    reasons.push(`sections: ${checks.sectionCount} < ${structure.minSections}`);
  }
  if (Array.isArray(structure.requiredSectionKeywords)) {
    for (const keyword of structure.requiredSectionKeywords) {
      if (!content.includes(keyword)) {
        reasons.push(`keyword-missing: ${keyword}`);
      }
    }
  }
  if (Number.isSafeInteger(structure.minChars) && checks.chars < structure.minChars) {
    reasons.push(`chars: ${checks.chars} < ${structure.minChars}`);
  }

  return Object.freeze({
    passed: reasons.length === 0,
    artifactPath: existing.filePath,
    checks,
    reasons,
  });
}
