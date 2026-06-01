import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, lstatSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  deployBundledPlugins,
  ensureManagedPythonVenv,
  ensureReportRendererCssCompat,
  ensureSlideRendererWheelhouseCompat,
} from '../../electron/deploy-bundled-plugins.js';

// Mock electron app module
const mockIsPackaged = vi.fn(() => false);
const mockResourcesPath = vi.fn(() => '');
vi.mock('electron', () => ({
  app: {
    get isPackaged() { return mockIsPackaged(); },
    get resourcesPath() { return mockResourcesPath(); },
  } as unknown,
}));

// We need to test the core logic without actually calling electron
// So we extract and test the helpers directly

describe('deploy-bundled-plugins', () => {
  let rootDir: string;
  let pluginsDir: string;
  let bundledDir: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalPath = process.env.PATH;
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-deploy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    pluginsDir = join(rootDir, 'plugins');
    bundledDir = join(rootDir, 'bundled-plugins');
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(bundledDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.PATH = originalPath;
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;
    mockIsPackaged.mockReturnValue(false);
    mockResourcesPath.mockReturnValue('');
  });

  describe('semverGte', () => {
    // Import the function by loading the module
    // Since deploy-bundled-plugins uses electron, we test the logic inline
    function semverGte(a: string, b: string): boolean {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return true;
        if ((pa[i] || 0) < (pb[i] || 0)) return false;
      }
      return true;
    }

    it('equal versions return true', () => {
      expect(semverGte('1.0.0', '1.0.0')).toBe(true);
    });

    it('higher major returns true', () => {
      expect(semverGte('2.0.0', '1.9.9')).toBe(true);
    });

    it('lower major returns false', () => {
      expect(semverGte('1.9.9', '2.0.0')).toBe(false);
    });

    it('handles 0.9.0 vs 0.10.0 correctly (numeric comparison)', () => {
      expect(semverGte('0.10.0', '0.9.0')).toBe(true);
      expect(semverGte('0.9.0', '0.10.0')).toBe(false);
    });

    it('handles patch differences', () => {
      expect(semverGte('1.0.2', '1.0.1')).toBe(true);
      expect(semverGte('1.0.1', '1.0.2')).toBe(false);
    });

    it('handles missing patch (treated as 0)', () => {
      expect(semverGte('1.0', '1.0.0')).toBe(true);
      expect(semverGte('1.0.0', '1.0')).toBe(true);
    });
  });

  describe('plugin deployment logic', () => {
    function createPluginManifest(dir: string, manifest: Record<string, unknown>) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
    }

    function createPluginWithFiles(dir: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
      for (const [path, content] of Object.entries(files)) {
        const fullPath = join(dir, path);
        mkdirSync(join(fullPath, '..'), { recursive: true });
        writeFileSync(fullPath, content);
      }
    }

    // Simulate the deploy logic (same as deploy-bundled-plugins.ts core loop)
    function simulateDeploy(bundledDir: string, pluginsDir: string, pluginNames: string[]) {
      const { cpSync } = require('node:fs');
      const deployed: string[] = [];

      function semverGte(a: string, b: string): boolean {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] || 0) > (pb[i] || 0)) return true;
          if ((pa[i] || 0) < (pb[i] || 0)) return false;
        }
        return true;
      }

      for (const name of pluginNames) {
        const src = join(bundledDir, name);
        const dest = join(pluginsDir, name);
        if (!existsSync(src)) continue;

        const srcManifest = join(src, 'plugin.json');
        const destManifest = join(dest, 'plugin.json');

        if (existsSync(destManifest)) {
          try {
            const srcVer = JSON.parse(readFileSync(srcManifest, 'utf8')).version || '0.0.0';
            const destMeta = JSON.parse(readFileSync(destManifest, 'utf8'));
            const destVer = destMeta.version || '0.0.0';
            if (semverGte(destVer, srcVer) && destMeta.source !== 'bundled') continue;
            if (semverGte(destVer, srcVer)) continue;
          } catch {
            // parse error, overwrite
          }
        }

        cpSync(src, dest, { recursive: true });
        // Mark as bundled
        try {
          const manifest = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
          manifest.source = 'bundled';
          writeFileSync(join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2));
        } catch {}
        deployed.push(name);
      }

      return deployed;
    }

    it('deploys plugin when target does not exist', () => {
      createPluginWithFiles(join(bundledDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
      }, { 'skills/SKILL.md': '# Report' });

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-report-creator']);

      expect(deployed).toEqual(['kai-report-creator']);
      expect(existsSync(join(pluginsDir, 'kai-report-creator', 'plugin.json'))).toBe(true);
      expect(existsSync(join(pluginsDir, 'kai-report-creator', 'skills', 'SKILL.md'))).toBe(true);

      const manifest = JSON.parse(readFileSync(join(pluginsDir, 'kai-report-creator', 'plugin.json'), 'utf8'));
      expect(manifest.source).toBe('bundled');
      expect(manifest.version).toBe('2.0.0');
    });

    it('upgrades when bundled version is higher', () => {
      createPluginManifest(join(bundledDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '3.0.0',
      });
      createPluginManifest(join(pluginsDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
        source: 'bundled',
      });

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-report-creator']);

      expect(deployed).toEqual(['kai-report-creator']);
      const manifest = JSON.parse(readFileSync(join(pluginsDir, 'kai-report-creator', 'plugin.json'), 'utf8'));
      expect(manifest.version).toBe('3.0.0');
    });

    it('skips when installed version >= bundled (bundled-managed)', () => {
      createPluginManifest(join(bundledDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
      });
      createPluginManifest(join(pluginsDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
        source: 'bundled',
      });

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-report-creator']);

      expect(deployed).toEqual([]);
    });

    it('skips when user-installed version >= bundled', () => {
      createPluginManifest(join(bundledDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
      });
      // User installed, no "source" field
      createPluginManifest(join(pluginsDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.5.0',
      });

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-report-creator']);

      expect(deployed).toEqual([]);
    });

    it('handles 0.9.0 vs 0.10.0 correctly (does not treat as string)', () => {
      createPluginManifest(join(bundledDir, 'kai-slide-creator'), {
        name: 'kai-slide-creator',
        version: '0.10.0',
      });
      createPluginManifest(join(pluginsDir, 'kai-slide-creator'), {
        name: 'kai-slide-creator',
        version: '0.9.0',
        source: 'bundled',
      });

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-slide-creator']);

      expect(deployed).toEqual(['kai-slide-creator']);
    });

    it('deploys multiple plugins independently', () => {
      createPluginManifest(join(bundledDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
      });
      createPluginManifest(join(bundledDir, 'kai-slide-creator'), {
        name: 'kai-slide-creator',
        version: '3.0.0',
      });
      // Only report already installed at same version
      createPluginManifest(join(pluginsDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
        source: 'bundled',
      });

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-report-creator', 'kai-slide-creator']);

      expect(deployed).toEqual(['kai-slide-creator']);
    });

    it('skips non-existent bundled plugin gracefully', () => {
      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-nonexistent']);
      expect(deployed).toEqual([]);
    });

    it('overwrites when existing plugin.json is malformed', () => {
      createPluginManifest(join(bundledDir, 'kai-report-creator'), {
        name: 'kai-report-creator',
        version: '2.0.0',
      });
      // Create malformed plugin.json
      mkdirSync(join(pluginsDir, 'kai-report-creator'), { recursive: true });
      writeFileSync(join(pluginsDir, 'kai-report-creator', 'plugin.json'), 'not json{{{');

      const deployed = simulateDeploy(bundledDir, pluginsDir, ['kai-report-creator']);

      expect(deployed).toEqual(['kai-report-creator']);
    });

    it('creates dist/css compatibility files for the bundled report renderer', () => {
      const pluginDir = join(pluginsDir, 'kai-report-creator');
      mkdirSync(join(pluginDir, 'mcp-servers', 'report-renderer', 'dist', 'themes', 'css'), { recursive: true });
      writeFileSync(
        join(pluginDir, 'mcp-servers', 'report-renderer', 'dist', 'themes', 'css', 'corporate-blue.css'),
        'body { color: black; }',
      );

      ensureReportRendererCssCompat(pluginDir);

      expect(
        existsSync(join(pluginDir, 'mcp-servers', 'report-renderer', 'dist', 'css', 'corporate-blue.css')),
      ).toBe(true);
    });

    it('replaces stale same-version bundled slide wheels with current-platform wheels', () => {
      const installedPluginDir = join(pluginsDir, 'kai-slide-creator');
      const bundledPluginDir = join(bundledDir, 'kai-slide-creator');
      const installedWheelsDir = join(installedPluginDir, 'bundled-wheels');
      const bundledWheelsDir = join(bundledPluginDir, 'bundled-wheels');
      const compatibleNativeWheel = process.platform === 'win32'
        ? 'pydantic_core-2.46.4-cp314-cp314-win_amd64.whl'
        : process.platform === 'darwin'
          ? `pydantic_core-2.46.4-cp311-cp311-macosx_11_0_${process.arch === 'arm64' ? 'arm64' : 'x86_64'}.whl`
          : `pydantic_core-2.46.4-cp311-cp311-manylinux_2_17_${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}.whl`;
      const compatibleRpdsWheel = compatibleNativeWheel.replace('pydantic_core', 'rpds_py');
      const incompatibleNativeWheel = process.platform === 'win32'
        ? 'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl'
        : 'pydantic_core-2.46.4-cp314-cp314-win_amd64.whl';

      mkdirSync(installedWheelsDir, { recursive: true });
      writeFileSync(join(installedWheelsDir, incompatibleNativeWheel), '');
      writeFileSync(join(installedWheelsDir, compatibleNativeWheel), '');
      mkdirSync(bundledWheelsDir, { recursive: true });
      writeFileSync(join(bundledWheelsDir, compatibleNativeWheel), '');
      writeFileSync(join(bundledWheelsDir, compatibleRpdsWheel), '');

      ensureSlideRendererWheelhouseCompat(installedPluginDir, bundledPluginDir);

      expect(existsSync(join(installedWheelsDir, compatibleNativeWheel))).toBe(true);
      expect(existsSync(join(installedWheelsDir, compatibleRpdsWheel))).toBe(true);
      expect(existsSync(join(installedWheelsDir, incompatibleNativeWheel))).toBe(false);
    });

    it('does not replace installed slide wheels with same-platform wheels for a different Python ABI', () => {
      const installedPluginDir = join(pluginsDir, 'kai-slide-creator');
      const bundledPluginDir = join(bundledDir, 'kai-slide-creator');
      const installedWheelsDir = join(installedPluginDir, 'bundled-wheels');
      const bundledWheelsDir = join(bundledPluginDir, 'bundled-wheels');

      const platformTag = process.platform === 'win32'
        ? 'win_amd64'
        : process.platform === 'darwin'
          ? `macosx_11_0_${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`
          : `manylinux_2_17_${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
      const installedNativeWheel = `pydantic_core-2.46.4-cp311-cp311-${platformTag}.whl`;
      const installedRpdsWheel = `rpds_py-0.30.0-cp311-cp311-${platformTag}.whl`;
      const bundledNativeWheel = `pydantic_core-2.46.4-cp314-cp314-${platformTag}.whl`;
      const bundledRpdsWheel = `rpds_py-0.30.0-cp314-cp314-${platformTag}.whl`;

      mkdirSync(installedWheelsDir, { recursive: true });
      writeFileSync(join(installedWheelsDir, installedNativeWheel), '');
      writeFileSync(join(installedWheelsDir, installedRpdsWheel), '');
      mkdirSync(bundledWheelsDir, { recursive: true });
      writeFileSync(join(bundledWheelsDir, bundledNativeWheel), '');
      writeFileSync(join(bundledWheelsDir, bundledRpdsWheel), '');

      ensureSlideRendererWheelhouseCompat(installedPluginDir, bundledPluginDir, 'cp311');

      expect(existsSync(join(installedWheelsDir, installedNativeWheel))).toBe(true);
      expect(existsSync(join(installedWheelsDir, installedRpdsWheel))).toBe(true);
      expect(existsSync(join(installedWheelsDir, bundledNativeWheel))).toBe(false);
      expect(existsSync(join(installedWheelsDir, bundledRpdsWheel))).toBe(false);
    });

    it('reconciles report renderer css compatibility even when bundled-managed plugin is already current', async () => {
      process.env.HOME = rootDir;
      process.env.USERPROFILE = rootDir;
      process.env.PATH = '';
      mockIsPackaged.mockReturnValue(true);
      mockResourcesPath.mockReturnValue(rootDir);
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = rootDir;

      const bundledPluginDir = join(bundledDir, 'kai-report-creator');
      createPluginManifest(bundledPluginDir, {
        name: 'kai-report-creator',
        version: '2.0.0',
      });

      const installedPluginDir = join(rootDir, '.xiaok', 'plugins', 'kai-report-creator');
      createPluginManifest(installedPluginDir, {
        name: 'kai-report-creator',
        version: '2.0.0',
        source: 'bundled',
      });
      mkdirSync(join(installedPluginDir, 'mcp-servers', 'report-renderer', 'dist', 'themes', 'css'), { recursive: true });
      writeFileSync(
        join(installedPluginDir, 'mcp-servers', 'report-renderer', 'dist', 'themes', 'css', 'corporate-blue.css'),
        'body { color: black; }',
      );

      const result = await deployBundledPlugins();

      expect(result.deployed).toEqual([]);
      expect(
        existsSync(join(installedPluginDir, 'mcp-servers', 'report-renderer', 'dist', 'css', 'corporate-blue.css')),
      ).toBe(true);
    });

    it('replaces a stale symlinked bundled plugin with packaged resources', async () => {
      process.env.HOME = rootDir;
      process.env.USERPROFILE = rootDir;
      process.env.PATH = '';
      mockIsPackaged.mockReturnValue(true);
      mockResourcesPath.mockReturnValue(rootDir);
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = rootDir;

      const bundledPluginDir = join(bundledDir, 'kai-slide-creator');
      createPluginWithFiles(bundledPluginDir, {
        name: 'kai-slide-creator',
        version: '3.2.0',
      }, {
        'mcp-servers/slide-renderer/server.py': '# packaged',
        'bundled-wheels/pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl': '',
        'bundled-wheels/rpds_py-0.30.0-cp311-cp311-macosx_11_0_arm64.whl': '',
      });

      const stalePluginDir = join(rootDir, 'stale-slide-plugin');
      createPluginWithFiles(stalePluginDir, {
        name: 'kai-slide-creator',
        version: '3.2.0',
      }, {
        'mcp-servers/slide-renderer/server.py': '# stale',
        'bundled-wheels/pydantic_core-2.46.4-cp314-cp314-win_amd64.whl': '',
      });
      const installedPluginDir = join(rootDir, '.xiaok', 'plugins', 'kai-slide-creator');
      mkdirSync(dirname(installedPluginDir), { recursive: true });
      symlinkSync(stalePluginDir, installedPluginDir);

      const result = await deployBundledPlugins();

      expect(result.deployed).toContain('kai-slide-creator');
      expect(lstatSync(installedPluginDir).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(installedPluginDir, 'mcp-servers', 'slide-renderer', 'server.py'), 'utf8')).toBe('# packaged');
      expect(existsSync(join(installedPluginDir, 'bundled-wheels', 'pydantic_core-2.46.4-cp311-cp311-macosx_11_0_arm64.whl'))).toBe(true);
      const backups = readdirSync(join(rootDir, '.xiaok', '.symlink-backups'));
      expect(backups.some(name => name.startsWith('kai-slide-creator-'))).toBe(true);
    });

    it('deploys the bundled CUA computer-use plugin from packaged resources', async () => {
      process.env.HOME = rootDir;
      process.env.USERPROFILE = rootDir;
      process.env.PATH = '';
      mockIsPackaged.mockReturnValue(true);
      mockResourcesPath.mockReturnValue(rootDir);
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = rootDir;

      createPluginWithFiles(join(bundledDir, 'cua-computer-use'), {
        name: 'cua-computer-use',
        version: '0.1.0',
      }, {
        'skills/computer-use/SKILL.md': '# Computer Use',
      });

      const result = await deployBundledPlugins();

      expect(result.deployed).toContain('cua-computer-use');
      expect(existsSync(join(rootDir, '.xiaok', 'plugins', 'cua-computer-use', 'plugin.json'))).toBe(true);
      expect(existsSync(join(rootDir, '.xiaok', 'plugins', 'cua-computer-use', 'skills', 'computer-use', 'SKILL.md'))).toBe(true);
    });

    it('upgrades the bundled CUA plugin so v0.2 window tools replace stale v0.1 metadata', async () => {
      process.env.HOME = rootDir;
      process.env.USERPROFILE = rootDir;
      process.env.PATH = '';
      mockIsPackaged.mockReturnValue(true);
      mockResourcesPath.mockReturnValue(rootDir);
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = rootDir;

      createPluginWithFiles(join(bundledDir, 'cua-computer-use'), {
        name: 'cua-computer-use',
        version: '0.2.0',
        toolPolicy: {
          safeTools: ['get_window_state', 'list_windows', 'screenshot'],
          productWrapper: 'xiaok_computer_use',
        },
      }, {
        'skills/computer-use/SKILL.md': 'Use xiaok_computer_use.',
      });
      createPluginWithFiles(join(rootDir, '.xiaok', 'plugins', 'cua-computer-use'), {
        name: 'cua-computer-use',
        version: '0.1.0',
        source: 'bundled',
        toolPolicy: {
          safeTools: ['get_app_state', 'list_apps'],
          productWrapper: 'xiaok_computer_use',
        },
      }, {
        'skills/computer-use/SKILL.md': 'Old CUA skill.',
      });

      const result = await deployBundledPlugins();

      expect(result.deployed).toContain('cua-computer-use');
      const manifest = JSON.parse(readFileSync(join(rootDir, '.xiaok', 'plugins', 'cua-computer-use', 'plugin.json'), 'utf8'));
      const skill = readFileSync(join(rootDir, '.xiaok', 'plugins', 'cua-computer-use', 'skills', 'computer-use', 'SKILL.md'), 'utf8');
      expect(manifest.version).toBe('0.2.0');
      expect(manifest.toolPolicy.safeTools).toContain('get_window_state');
      expect(manifest.toolPolicy.safeTools).toContain('list_windows');
      expect(manifest.toolPolicy.safeTools).not.toContain('get_app_state');
      expect(skill).toContain('xiaok_computer_use');
    });
  });

  describe('managed Python venv creation', () => {
    it('uses normal venv creation when ensurepip works', async () => {
      const venvDir = join(rootDir, 'runtime', 'python-env');
      const venvPython = join(venvDir, 'Scripts', 'python.exe');
      const exec = vi.fn(async () => {
        mkdirSync(dirname(venvPython), { recursive: true });
        writeFileSync(venvPython, '');
      });

      await expect(ensureManagedPythonVenv({
        pythonCmd: 'python',
        venvDir,
        venvPython,
        exec,
      })).resolves.toBe(true);

      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith('python', ['-m', 'venv', venvDir], { timeout: 30_000 });
    });

    it('falls back to without-pip venv and global pip bootstrap when ensurepip is broken', async () => {
      const venvDir = join(rootDir, 'runtime', 'python-env');
      const venvPython = join(venvDir, 'Scripts', 'python.exe');
      const exec = vi
        .fn()
        .mockRejectedValueOnce(new Error('ensurepip failed'))
        .mockImplementationOnce(async () => {
          mkdirSync(dirname(venvPython), { recursive: true });
          writeFileSync(venvPython, '');
        })
        .mockResolvedValueOnce(undefined);

      await expect(ensureManagedPythonVenv({
        pythonCmd: 'python',
        venvDir,
        venvPython,
        exec,
      })).resolves.toBe(true);

      expect(exec).toHaveBeenNthCalledWith(2, 'python', ['-m', 'venv', '--without-pip', venvDir], { timeout: 30_000 });
      expect(exec).toHaveBeenNthCalledWith(3, 'python', [
        '-m', 'pip',
        '--python', venvPython,
        'install', 'pip',
        '--disable-pip-version-check',
      ], { timeout: 120_000 });
    });
  });
});
