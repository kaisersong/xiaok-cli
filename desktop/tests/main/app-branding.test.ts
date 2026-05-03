import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('desktop app branding', () => {
  it('packages and launches the app as xiaok', async () => {
    const builder = JSON.parse(await readFile(join(repoRoot, 'desktop', 'electron-builder.json'), 'utf8')) as {
      productName?: string;
      mac?: { icon?: string };
    };
    const security = await readFile(join(repoRoot, 'desktop', 'electron', 'security.ts'), 'utf8');
    const indexHtml = await readFile(join(repoRoot, 'desktop', 'renderer', 'index.html'), 'utf8');
    const renderer = await readFile(join(repoRoot, 'desktop', 'renderer', 'src', 'main.tsx'), 'utf8');
    const launchScript = await readFile(join(repoRoot, 'scripts', 'desktop-launch.mjs'), 'utf8');
    const installScript = await readFile(join(repoRoot, 'scripts', 'desktop-install.mjs'), 'utf8');

    expect(builder.productName).toBe('xiaok');
    expect(builder.mac?.icon).toBe('build/icon.icns');
    expect(security).toContain("title: 'xiaok'");
    expect(indexHtml).toContain('<title>xiaok</title>');
    expect(renderer).not.toContain('<h1>xiaok</h1>');
    expect(launchScript).toContain("'xiaok.app'");
    expect(installScript).toContain("'xiaok.app'");
    expect(installScript).toContain('rmSync(targetAppPath');
    expect(launchScript).not.toContain('xiaok Desktop.app');
    expect(installScript).toContain('legacyTargetAppPath');
    expect(installScript).not.toContain("sourceAppPath = join(repoRoot, 'desktop', 'release', 'mac-arm64', 'xiaok Desktop.app')");
    expect(installScript).not.toContain("targetAppPath = join(installDir, 'xiaok Desktop.app')");
  });
});
