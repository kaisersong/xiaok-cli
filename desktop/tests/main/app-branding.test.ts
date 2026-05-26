import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('desktop app branding', () => {
  it('packages and launches the app as xiaok', async () => {
    const desktopPackage = JSON.parse(await readFile(join(repoRoot, 'desktop', 'package.json'), 'utf8')) as {
      scripts?: {
        'build:main'?: string;
        'build:clean'?: string;
        'pack:dir'?: string;
        'pack:release'?: string;
      };
    };
    const builder = JSON.parse(await readFile(join(repoRoot, 'desktop', 'electron-builder.json'), 'utf8')) as {
      productName?: string;
      mac?: { icon?: string; target?: string[] };
      win?: { icon?: string };
      nsis?: {
        oneClick?: boolean;
        perMachine?: boolean;
        allowToChangeInstallationDirectory?: boolean;
        artifactName?: string;
      };
      portable?: { artifactName?: string };
    };
    const security = await readFile(join(repoRoot, 'desktop', 'electron', 'security.ts'), 'utf8');
    const indexHtml = await readFile(join(repoRoot, 'desktop', 'renderer', 'index.html'), 'utf8');
    const renderer = await readFile(join(repoRoot, 'desktop', 'renderer', 'src', 'main.tsx'), 'utf8');
    const launchScript = await readFile(join(repoRoot, 'scripts', 'desktop-launch.mjs'), 'utf8');
    const installScript = await readFile(join(repoRoot, 'scripts', 'desktop-install.mjs'), 'utf8');
    const mainProcess = await readFile(join(repoRoot, 'desktop', 'electron', 'main.ts'), 'utf8');

    expect(builder.productName).toBe('xiaok');
    expect(builder.mac?.icon).toBe('build/icon.icns');
    expect(builder.mac?.target).toContain('dir');
    expect(builder.win?.icon).toBe('build/icon.ico');
    expect(desktopPackage.scripts?.['build:main']).toContain('generate-desktop-service-overrides.mjs');
    expect(desktopPackage.scripts?.['build:main']).not.toContain("rmSync('dist/main'");
    expect(desktopPackage.scripts?.['build:main']).not.toContain("rmSync('.tsbuildinfo'");
    expect(desktopPackage.scripts?.['build:clean']).toContain("rmSync('dist'");
    expect(desktopPackage.scripts?.['build:clean']).toContain("rmSync('.tsbuildinfo'");
    expect(desktopPackage.scripts?.['pack:dir']).toContain('npm run build:clean');
    expect(desktopPackage.scripts?.['pack:release']).toContain('npm run build:clean');
    expect(desktopPackage.scripts?.['build:main']).toContain('dist/main/desktop/electron/main.js');
    expect(desktopPackage.scripts?.['build:main']).toContain('build/icon.png');
    expect(builder.nsis?.oneClick).toBe(false);
    expect(builder.nsis?.perMachine).toBe(false);
    expect(builder.nsis?.allowToChangeInstallationDirectory).toBe(true);
    expect(builder.nsis?.artifactName).toBe('${productName}-setup-${version}.${ext}');
    expect(builder.portable?.artifactName).toBe('${productName}-portable-${version}.${ext}');
    expect(security).toContain("title: 'xiaok'");
    expect(security).toContain('icon:');
    expect(indexHtml).toContain('<title>xiaok</title>');
    expect(renderer).not.toContain('<h1>xiaok</h1>');
    expect(mainProcess).toContain('removeWindowsWindowMenu');
    expect(mainProcess).toContain('attachCloseToMinimize');
    expect(mainProcess).toContain('resolveDesktopDockIconPath');
    expect(launchScript).toContain("'xiaok.app'");
    expect(installScript).toContain("'xiaok.app'");
    expect(installScript).toContain('LOCALAPPDATA');
    expect(installScript).toContain('xiaok-setup-${version}.exe');
    expect(installScript).toContain("'/CURRENTUSER'");
    expect(installScript).toContain("'/S'");
    expect(installScript).toContain("'Programs'");
    expect(installScript).toContain("'xiaok.exe'");
    expect(installScript).toContain('rmSync(targetAppPath');
    expect(launchScript).not.toContain('xiaok Desktop.app');
    expect(installScript).toContain('legacyTargetAppPath');
    expect(installScript).not.toContain("sourceAppPath = join(repoRoot, 'desktop', 'release', 'mac-arm64', 'xiaok Desktop.app')");
    expect(installScript).not.toContain("targetAppPath = join(installDir, 'xiaok Desktop.app')");
  });
});
