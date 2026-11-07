import {stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
export async function expandSelectedMaterialPaths(paths: string[]): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    try {
      const entry = await stat(path);
      if (entry.isFile()) {
        files.add(path);
      } else if (entry.isDirectory()) {
        for (const file of await listFilesInDirectory(path)) files.add(file);
      }
    } catch {
      // Skip non-existent paths (e.g. pasted text that looks like a path)
    }
  }
  return [...files].sort();
}

async function listFilesInDirectory(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesInDirectory(path));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
