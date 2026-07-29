import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Persists a failed session's raw material for human triage:
 * snapshot JSON, matched artifact copies, and an optional page screenshot.
 *
 * These directories may contain sensitive content — they stay LOCAL ONLY
 * (the run root is gitignored) and the session record stores only this
 * directory path, never the raw content itself.
 */
export async function captureFailure({
  runRoot,
  sessionKey,
  snapshot,
  signals,
  page,
}) {
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  const failureDir = join(runRoot, 'failures', safeKey);
  await mkdir(failureDir, { recursive: true });

  await writeFile(
    join(failureDir, 'snapshot.json'),
    JSON.stringify(snapshot ?? null, null, 2),
    'utf8',
  );

  for (const artifact of signals?.artifacts ?? []) {
    if (existsSync(artifact.filePath)) {
      await copyFile(
        artifact.filePath,
        join(failureDir, `artifact-${basename(artifact.filePath)}`),
      ).catch(() => {});
    }
  }

  if (page) {
    await page.screenshot({ path: join(failureDir, 'screenshot.png') })
      .catch(() => {});
  }

  return failureDir;
}
