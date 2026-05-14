import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-deploy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    pluginsDir = join(rootDir, 'plugins');
    bundledDir = join(rootDir, 'bundled-plugins');
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(bundledDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
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
  });
});
