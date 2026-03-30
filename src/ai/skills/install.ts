import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export interface InstallSkillResult {
  name: string;
  destinationDir: string;
  destinationSkillPath: string;
}

interface ParsedSkillSource {
  name: string;
  kind: 'directory' | 'file';
}

function parseFrontmatter(raw: string): { name: string; description: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Skill frontmatter is required.');
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }

  if (!fields.name || !fields.description) {
    throw new Error('Skill frontmatter must include name and description.');
  }

  return { name: fields.name, description: fields.description };
}

function readSkillNameFromPath(sourcePath: string): ParsedSkillSource {
  const stats = statSync(sourcePath);
  if (stats.isDirectory()) {
    const skillPath = join(sourcePath, 'SKILL.md');
    if (!existsSync(skillPath)) {
      throw new Error('SKILL.md not found in selected skill directory.');
    }
    const parsed = parseFrontmatter(readFileSync(skillPath, 'utf-8'));
    return { name: parsed.name, kind: 'directory' };
  }

  const parsed = parseFrontmatter(readFileSync(sourcePath, 'utf-8'));
  return { name: parsed.name, kind: 'file' };
}

export async function installSkillFromLocalPath(
  source: string,
  configDir: string,
): Promise<InstallSkillResult> {
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath)) {
    throw new Error(`Skill source not found: ${sourcePath}`);
  }

  const parsed = readSkillNameFromPath(sourcePath);
  const skillsRoot = join(configDir, 'skills');
  const destinationDir = join(skillsRoot, parsed.name);
  const destinationSkillPath = join(destinationDir, 'SKILL.md');

  if (existsSync(destinationDir)) {
    throw new Error(`Destination already exists: ${destinationDir}`);
  }

  mkdirSync(skillsRoot, { recursive: true });
  const tmpDir = `${destinationDir}.tmp-${Date.now()}`;

  try {
    if (parsed.kind === 'directory') {
      cpSync(sourcePath, tmpDir, { recursive: true });
    } else {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(join(tmpDir, 'SKILL.md'), readFileSync(sourcePath, 'utf-8'), 'utf-8');
    }

    renameSync(tmpDir, destinationDir);
  } catch (error) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }

  return {
    name: parsed.name,
    destinationDir,
    destinationSkillPath,
  };
}
