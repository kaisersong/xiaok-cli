import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('desktop launch contract', () => {
  it('exposes root-level scripts for one-command desktop install and launch', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['desktop:pack']).toBe('npm run pack:dir --prefix desktop');
    expect(pkg.scripts['desktop:launch']).toBe('node scripts/desktop-launch.mjs');
    expect(pkg.scripts['desktop:install']).toBe('npm run desktop:pack && node scripts/desktop-install.mjs');
  });

  it('keeps a Finder-clickable command launcher in the desktop folder', async () => {
    const launcherPath = join(repoRoot, 'desktop', 'start-xiaok-desktop.command');
    const launcher = await readFile(launcherPath, 'utf8');
    const mode = (await stat(launcherPath)).mode;

    expect(launcher).toContain('npm run desktop:launch');
    expect(launcher).toContain('cd "$REPO_ROOT"');
    expect(mode & 0o111).not.toBe(0);
  });

  it('launches the bundle executable so repeated opens route through the app single-instance handler', async () => {
    const launcher = await readFile(join(repoRoot, 'scripts', 'desktop-launch.mjs'), 'utf8');

    expect(launcher).toContain("'Contents', 'MacOS', 'xiaok'");
    expect(launcher).toContain('detached: true');
  });
});
