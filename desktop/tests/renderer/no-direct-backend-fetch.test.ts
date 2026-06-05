import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER_SRC = join(__dirname, '../../renderer/src');

const FORBIDDEN_PATTERNS = [
  /127\.0\.0\.1:(4400|14242)/,
  /\bBASE_URL\b/,
  /\bWS_URL\b/,
  /\bKSWARM_BASE_URL\b/,
  /\bQUALITY_BASE_URL\b/,
  /\bNOWLEDGE_LOCAL_URL\b/,
  /new\s+WebSocket\b/,
  /fetch\([^)]*\$\{[^}]+\}\/healthz/,
];

const ALLOWED_FILES = [
  'src/locales/zh.ts',
  'src/locales/en.ts',
  'src/components/settings/AdvancedSettings.tsx',
];

const ALLOWED_OCCURRENCES = [
  { file: 'src/components/settings/MemoryConfigModal.tsx', line: 432, reason: 'NOWLEDGE_LOCAL_URL const default (string value, not fetch)' },
  { file: 'src/components/settings/MemoryConfigModal.tsx', line: 449, reason: 'connectionHealth IPC arg' },
  { file: 'src/components/settings/MemoryConfigModal.tsx', line: 453, reason: 'onDetected callback arg (string value)' },
  { file: 'src/components/settings/MemoryConfigModal.tsx', line: 616, reason: 'connectionHealth IPC arg' },
  { file: 'src/components/settings/MemoryConfigModal.tsx', line: 619, reason: 'setNowledgeDraft baseUrl assignment (string value)' },
  { file: 'src/components/settings/MemoryConfigModal.tsx', line: 871, reason: 'placeholder text' },
  { file: 'src/components/settings/MemorySettings.tsx', line: 994, reason: 'connectionHealth arg (IPC, not direct fetch)' },
  { file: 'src/components/settings/MemorySettings.tsx', line: 997, reason: 'string assignment from IPC result' },
  { file: 'src/components/projects/artifactActions.ts', line: 4, reason: 'getKswarmBaseUrl return value (used for URL construction, fetched via IPC proxy)' },
  { file: 'src/components/projects/ArtifactPreviewModal.tsx', line: 46, reason: 'comparison string to route through IPC proxy' },
];

function collectFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectFiles(full, files);
    } else if (/\.(ts|tsx)$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

describe('no-direct-backend-fetch', () => {
  it('renderer has no direct backend fetch to KSwarm/Nowledge/healthz (MOD-002a)', () => {
    const files = collectFiles(RENDERER_SRC);
    const violations: string[] = [];

    for (const file of files) {
      const relative = file.slice(RENDERER_SRC.length + 1);
      if (ALLOWED_FILES.some(af => relative.endsWith(af.replace('src/', '')))) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];

        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            const isAllowed = ALLOWED_OCCURRENCES.some(
              ao => relative.endsWith(ao.file.replace('src/', '')) && ao.line === lineNum
            );
            if (!isAllowed) {
              violations.push(`${relative}:${lineNum} matches ${pattern}`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
