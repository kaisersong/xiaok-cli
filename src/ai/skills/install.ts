import { parseFrontmatter } from './loader.js';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
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

function readSkillNameFromPath(sourcePath: string): ParsedSkillSource {
  const stats = statSync(sourcePath);
  if (stats.isDirectory()) {
    const skillPath = join(sourcePath, 'SKILL.md');
    if (!existsSync(skillPath)) {
      throw new Error('SKILL.md not found in selected skill directory.');
    }
    const parsed = parseFrontmatter(readFileSync(skillPath, 'utf-8'));
    if (!parsed) throw new Error('Skill frontmatter must include name and description.');
    return { name: parsed.name, kind: 'directory' };
  }

  const parsed = parseFrontmatter(readFileSync(sourcePath, 'utf-8'));
  if (!parsed) throw new Error('Skill frontmatter must include name and description.');
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(parsed.name) || parsed.name.endsWith('.')) {
    throw new Error('Invalid skill name: expected a simple directory name.');
  }
  const skillsRoot = join(configDir, 'skills');
  const destinationDir = join(skillsRoot, parsed.name);
  const destinationSkillPath = join(destinationDir, 'SKILL.md');

  if (existsSync(destinationDir)) {
    throw new Error(`Destination already exists: ${destinationDir}`);
  }

  mkdirSync(skillsRoot, { recursive: true });
  const tmpDir = mkdtempSync(join(skillsRoot, '.xiaok-install-'));

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
